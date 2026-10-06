'use strict';
const test = require('node:test'),
  assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const { randomUUID } = require('node:crypto');
const {
  buildVoiceFrame,
  decodeVoiceFrame,
  isVoiceFrame,
  inspectVoice,
} = require('../src/voice-message-codec');
const { convertVoice, wav } = require('../src/voice-message-audio');
const { createVoiceTransport } = require('../src/voice-message-transport');
const { createVoiceReceiver } = require('../src/voice-message-runtime');
const { notifyIncomingVoice } = require('../src/voice-message-notify');
const { createVoiceStore } = require('../src/voice-message-store');
const { sendVoice, createVoiceHandler } = require('../src/voice-message-http');
const {
  voiceRuntime,
  authorizeVoice,
  publicMessage,
  RETENTION_MS,
} = require('../src/voice-message-policy');
const { extractFrames, buildAckFrame } = require('../src/protocol/gt06');
const { createCommandCoordinator } = require('../src/command-coordinator');
const imei = '999999999999999',
  protocolId = '9999999999',
  uid = 'voice-test-owner',
  access = { imei, uid, ownerUid: uid },
  runtime = { enabled: true, imei, uid };
const synthetic = (n = 50) => {
  const b = Buffer.alloc(6 + n * 32);
  b.write('#!AMR\n');
  for (let i = 6; i < b.length; i += 32) {
    b[i] = 0x3c;
    Buffer.from([0x7d, 0x5b, 0x5d, 0x2c, 0x2a, 0xff]).copy(b, i + 1);
  }
  return b;
};
function memoryDb() {
  const rows = new Map();
  let queue = Promise.resolve();
  const snapshot = (key) => ({
    id: key.split('/')[1],
    ref: doc(key),
    exists: rows.has(key),
    data: () => rows.get(key),
  });
  const doc = (key) => ({
    key,
    id: key.split('/')[1],
    get: async () => snapshot(key),
  });
  function query(name, filters = [], order = null, max = Infinity) {
    return {
      where: (k, op, v) => query(name, [...filters, [k, op, v]], order, max),
      orderBy: (k, d) => query(name, filters, [k, d], max),
      limit: (n) => query(name, filters, order, n),
      get: async () => {
        let keys = [...rows.keys()].filter(
          (k) =>
            k.startsWith(name + '/') &&
            filters.every(([f, o, v]) =>
              o === '==' ? rows.get(k)[f] === v : rows.get(k)[f] <= v,
            ),
        );
        if (order)
          keys.sort(
            (a, b) =>
              (rows.get(a)[order[0]] - rows.get(b)[order[0]]) *
              (order[1] === 'desc' ? -1 : 1),
          );
        return { docs: keys.slice(0, max).map(snapshot) };
      },
    };
  }
  function writer() {
    const writes = [];
    return {
      get: (r) => r.get(),
      set: (r, v, o) =>
        writes.push(() =>
          rows.set(r.key, o?.merge ? { ...rows.get(r.key), ...v } : v),
        ),
      delete: (r) => writes.push(() => rows.delete(r.key)),
      commit: async () => {
        writes.forEach((f) => f());
      },
    };
  }
  const db = {
    collection: (n) => ({ ...query(n), doc: (id) => doc(n + '/' + id) }),
    batch: writer,
    runTransaction: (run) => {
      const job = queue.then(async () => {
        const tx = writer(),
          value = await run(tx);
        await tx.commit();
        return value;
      });
      queue = job.catch(() => {});
      return job;
    },
  };
  rows.set('users/' + uid, { linkedImeis: [imei] });
  rows.set('serviceSubscriptions/' + uid, {
    version: 1,
    managedBy: 'guardian_admin',
    plan: 'family',
    status: 'active',
  });
  return { db, rows };
}
function fixture({
  timeoutMs = 20,
  coordinator = createCommandCoordinator(),
} = {}) {
  const socket = new EventEmitter(),
    session = { imei, protocolId, lastPacketAt: Date.now() };
  socket.writable = true;
  socket.frames = [];
  socket.write = (f, cb) => {
    socket.frames.push(f);
    cb?.();
    return true;
  };
  let targets = [{ socket, session }];
  const transport = createVoiceTransport({
    find: () => targets,
    timeoutMs,
    coordinator,
    note: () => {},
  });
  return {
    socket,
    session,
    transport,
    coordinator,
    replace: (v) => {
      targets = v;
    },
    reply: (result = 1, s = socket) =>
      transport.observe({ kind: 'result', protocolId, result }, s, session),
  };
}
const until = () => Date.now() + 30000;

test('slow authorization cannot renew the original send intent or dispatch after its deadline', async () => {
  let time = Date.now();
  const { db } = memoryDb(),
    store = createVoiceStore(db, () => time),
    f = fixture();
  await assert.rejects(
    sendVoice({
      access,
      request: {
        id: randomUUID(),
        createdAt: time,
        pcm: Buffer.alloc(16000).toString('base64'),
      },
      store,
      transport: f.transport,
      authorizeAgain: async () => {
        time += 31000;
      },
      convert: async () => synthetic(),
      now: () => time,
    }),
    /send_expired/,
  );
  assert.equal(f.socket.frames.length, 0);
  assert.equal((await store.list(access)).messages.length, 0);
  await assert.rejects(
    store.put({
      access,
      id: randomUUID(),
      direction: 'outgoing',
      audio: synthetic(),
      pcm: Buffer.alloc(16000),
      durationMs: 1000,
      dispatchUntilMs: time - 1,
    }),
    /send_expired/,
  );
});

test('voice lease bounds routine work while calls, replies, location and incident capture stay prompt', async () => {
  let time = Date.now();
  const coordinator = createCommandCoordinator({ now: () => time });
  const socket = { writable: true, destroyed: false };
  assert(
    coordinator.beginVoice({
      imei,
      id: 'voice',
      socket,
      expiresAt: time + 30000,
    }).ok,
  );
  assert.equal(
    coordinator.decide(imei, 'TAKEPILLS,12:00-1-1,1,text,').error,
    'voice_busy',
  );
  assert.equal(coordinator.decide(imei, 'UPLOAD,600').error, 'voice_busy');
  for (const command of [
    'CALL,123',
    'CR',
    'RCAPTURE',
    'TAKEPILLS,12:00-0-1,1,text,',
  ])
    assert(coordinator.decide(imei, command).ok);
  assert(coordinator.decide(imei, 'TK,1', { protocolReply: true }).ok);
  assert(
    coordinator.beginCapture({
      imei,
      id: 'photo',
      socket,
      expiresAt: time + 30000,
    }).ok,
  );
  coordinator.finishCapture(imei, 'photo');
  time += 10001;
  assert(coordinator.decide(imei, 'UPLOAD,600').ok);
});

test('TK binary profile round trips every escape; results and bare TK cannot become audio', () => {
  const audio = synthetic(),
    frame = buildVoiceFrame(protocolId, audio),
    decoded = decodeVoiceFrame(frame);
  assert.equal(decoded.durationMs, 1000);
  assert.deepEqual(decoded.audio, audio);
  assert.equal(
    frame.length,
    21 + parseInt(frame.subarray(15, 19).toString(), 16),
  );
  for (const result of [0, 1])
    assert.equal(
      decodeVoiceFrame(buildAckFrame(protocolId, 'TK,' + result)).result,
      result,
    );
  assert.equal(decodeVoiceFrame(buildAckFrame(protocolId, 'TK')).kind, 'bare');
  assert.equal(isVoiceFrame(buildAckFrame(protocolId, 'TKQ')), false);
  const invalid = Buffer.from(frame);
  invalid[15] = 48;
  invalid[16] = 48;
  invalid[17] = 48;
  invalid[18] = 49;
  assert.throws(() => decodeVoiceFrame(invalid));
  assert.throws(() => decodeVoiceFrame(buildAckFrame(protocolId, 'TK,}\x06')));
  assert.throws(() => buildVoiceFrame(protocolId, synthetic(1501)));
  assert.throws(() => buildVoiceFrame('1', audio));
  assert.throws(() => inspectVoice(Buffer.from('#!AMR\n')));
});
test('split/coalesced TK media preserves complete bytes and following emergency packets', () => {
  const frame = buildVoiceFrame(protocolId, synthetic()),
    alarm = buildAckFrame(protocolId, 'AL_LTE,test');
  for (const cut of [1, 19, 20, 21, 24, frame.length - 1]) {
    const first = extractFrames(frame.subarray(0, cut));
    assert.equal(first.frames.length, 0);
    const last = extractFrames(
      Buffer.concat([first.rest, frame.subarray(cut), alarm]),
    );
    assert.deepEqual(last.frames, [frame, alarm]);
    assert.equal(last.rest.length, 0);
  }
  assert(extractFrames(Buffer.alloc(100000, 1)).rest.length <= 65556);
});
test('bounded conversion yields complete AMR and audible-range PCM without changing medication limits', async () => {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < 8000; i++)
    pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 9000), i * 2);
  const amr = await convertVoice(pcm, 'encode'),
    back = await convertVoice(amr, 'decode');
  assert.equal(inspectVoice(amr).frameCount, 50);
  assert.equal(back.length, pcm.length);
  assert(back.some((v) => v !== 0));
  assert.equal(wav(back).readUInt32LE(24), 8000);
  const thirty = await convertVoice(Buffer.alloc(480000), 'encode');
  assert.equal(inspectVoice(thirty).durationMs, 30000);
  await assert.rejects(convertVoice(Buffer.alloc(480002), 'encode'));
  await assert.rejects(convertVoice(Buffer.alloc(1), 'decode'));
});
test('voice waits behind camera admission; emergency/protocol replies stay prompt', async () => {
  const f = fixture();
  f.coordinator.beginCapture({
    imei,
    id: 'photo',
    socket: f.socket,
    expiresAt: Date.now() + 10000,
  });
  assert.throws(
    () => f.transport.bind(imei, { dispatchUntilMs: until() }),
    /camera_busy/,
  );
  assert(f.coordinator.decide(imei, 'CR').ok);
  assert(f.coordinator.decide(imei, '', { protocolReply: true }).ok);
  f.coordinator.finishCapture(imei, 'photo');
  const pending = f.transport
    .bind(imei, { dispatchUntilMs: until() })
    .send(synthetic());
  f.reply();
  assert.equal((await pending).status, 'reply_observed');
  assert.equal(f.socket.frames.length, 1);
});
test('only matching connection reply counts; missing result quarantines later sends', async () => {
  const f = fixture(),
    pending = f.transport
      .bind(imei, { dispatchUntilMs: until() })
      .send(synthetic());
  f.reply(1, new EventEmitter());
  assert.equal((await pending).status, 'unconfirmed');
  f.reply();
  assert.throws(
    () => f.transport.bind(imei, { dispatchUntilMs: until() }),
    /delivery_unconfirmed/,
  );
  assert.equal(f.socket.frames.length, 1);
  const g = fixture(),
    bound = g.transport.bind(imei, { dispatchUntilMs: until() });
  g.replace([{ socket: new EventEmitter(), session: g.session }]);
  assert.throws(() => bound.send(synthetic()), /session_changed/);
});
test('write failure and disconnect remain unconfirmed, with no replay', async () => {
  const f = fixture();
  f.socket.write = () => {
    throw Error('private socket details');
  };
  assert.equal(
    (
      await f.transport
        .bind(imei, { dispatchUntilMs: until() })
        .send(synthetic())
    ).status,
    'unconfirmed',
  );
  const g = fixture(),
    pending = g.transport
      .bind(imei, { dispatchUntilMs: until() })
      .send(synthetic());
  g.socket.emit('close');
  assert.equal((await pending).status, 'unconfirmed');
});
test('private storage enforces ownership, duplicates, unread, deletion and hard audio expiry', async () => {
  let time = 100000;
  const { db, rows } = memoryDb(),
    store = createVoiceStore(db, () => time),
    audio = synthetic(),
    pcm = Buffer.alloc(16000);
  const id = store.incomingId(imei, audio),
    args = { access, id, direction: 'incoming', audio, pcm, durationMs: 1000 };
  assert.equal((await store.put(args)).replay, false);
  assert.equal((await store.put(args)).replay, true);
  assert.equal(rows.get('voiceMessageDevices/' + imei).count, 1);
  assert.equal((await store.list(access)).messages[0].played, false);
  await store.markPlayed(access, id);
  assert.equal((await store.list(access)).messages[0].played, true);
  await assert.rejects(store.audio({ ...access, uid: 'another' }, id));
  await assert.rejects(store.audio({ ...access, imei: '111111111111111' }, id));
  time += RETENTION_MS;
  await assert.rejects(store.audio(access, id));
  await store.cleanup();
  assert.equal(rows.has('voiceMessagePrivate/' + id), false);
  const id2 = store.incomingId(imei, audio);
  assert.notEqual(id2, id);
  await store.put({ ...args, id: id2 });
  await store.remove(access, id2);
  assert.equal(rows.has('voiceMessagePrivate/' + id2), false);
  assert.equal((await store.list(access)).messages.length, 0);
});
test('durable dispatch latch survives restart, expiry and late HTTP retry; explicit success releases it', async () => {
  let time = Date.now();
  const { db, rows } = memoryDb(),
    store = createVoiceStore(db, () => time),
    audio = synthetic(),
    pcm = Buffer.alloc(16000),
    id = randomUUID();
  const args = {
    access,
    id,
    direction: 'outgoing',
    audio,
    pcm,
    durationMs: 1000,
  };
  const { row } = await store.put(args);
  await store.update(row, 'sending');
  time += 60000;
  assert.equal(
    publicMessage(rows.get('voiceMessages/' + id), uid, time).status,
    'unconfirmed',
  );
  await assert.rejects(
    createVoiceStore(db, () => time).put({ ...args, id: randomUUID() }),
    /delivery_unconfirmed/,
  );
  assert((await store.put(args)).replay);
  await store.update(row, 'reply_observed');
  assert.equal(rows.get('voiceMessageDevices/' + imei).pendingId, null);
});
test('idempotent send performs one write and rechecks authorization before dispatch', async () => {
  const { db } = memoryDb(),
    store = createVoiceStore(db),
    f = fixture(),
    audio = synthetic(),
    request = {
      id: randomUUID(),
      createdAt: Date.now(),
      pcm: Buffer.alloc(16000).toString('base64'),
    };
  f.socket.write = (frame) => {
    f.socket.frames.push(frame);
    queueMicrotask(() => f.reply());
    return true;
  };
  let checks = 0;
  const args = {
    access,
    request,
    store,
    transport: f.transport,
    authorizeAgain: async () => {
      checks++;
    },
    convert: async () => audio,
  };
  assert.equal((await sendVoice(args)).status, 'reply_observed');
  assert.equal((await sendVoice(args)).status, 'reply_observed');
  assert.equal(f.socket.frames.length, 1);
  assert(checks >= 3);
});
test('receiver stores privately before ACK, rejects failed storage and never ACKs result/bare loops', async () => {
  const f = fixture(),
    audio = synthetic();
  let release,
    puts = 0;
  const durable = new Promise((r) => {
    release = r;
  });
  const receiver = createVoiceReceiver({
    getDb: () => ({}),
    runtime,
    transport: f.transport,
    authorize: async () => access,
    convert: async () => Buffer.alloc(16000),
    storeFactory: () => ({
      incomingId: () => 'incoming',
      put: async () => {
        puts++;
        await durable;
      },
    }),
    note: () => {},
  });
  assert(
    receiver.observe(buildVoiceFrame(protocolId, audio), f.socket, f.session),
  );
  await new Promise(setImmediate);
  assert.equal(puts, 1);
  assert.equal(f.socket.frames.length, 0);
  release();
  await new Promise(setImmediate);
  assert.equal(
    f.socket.frames[0].toString(),
    buildAckFrame(protocolId, 'TK,1').toString(),
  );
  receiver.observe(buildAckFrame(protocolId, 'TK'), f.socket, f.session);
  receiver.observe(buildAckFrame(protocolId, 'TK,1'), f.socket, f.session);
  assert.equal(f.socket.frames.length, 1);
  const failed = createVoiceReceiver({
    getDb: () => ({}),
    runtime,
    authorize: async () => {
      throw Error('no access');
    },
    note: () => {},
  });
  failed.observe(buildVoiceFrame(protocolId, audio), f.socket, f.session);
  await new Promise(setImmediate);
  assert.equal(
    f.socket.frames.at(-1).toString(),
    buildAckFrame(protocolId, 'TK,0').toString(),
  );
});
test('disabled or mismatched receiver never leaks binary media to text decoder or stores/sends', () => {
  const f = fixture(),
    r = createVoiceReceiver({
      getDb: () => {
        throw Error('must not read');
      },
      runtime: { enabled: false },
    });
  assert(
    r.observe(buildVoiceFrame(protocolId, synthetic()), f.socket, f.session),
  );
  assert.equal(f.socket.frames.length, 0);
});

test('incoming notification is private, authorized and claimed once across duplicate attempts', async () => {
  const { db, rows } = memoryDb();
  rows.get('users/' + uid).fcmTokens = ['token-a', 'token-a', 'token-b'];
  const store = createVoiceStore(db), audio = synthetic();
  const stored = await store.put({ access, id: store.incomingId(imei, audio), direction: 'incoming', audio, pcm: Buffer.alloc(16000), durationMs: 1000 });
  const sent = [];
  const args = { db, access, row: stored.row, runtime, messaging: () => ({ sendEachForMulticast: async message => {
    sent.push(message); return { successCount: 2, failureCount: 0 };
  } }) };
  await Promise.all([notifyIncomingVoice(args), notifyIncomingVoice(args)]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].tokens, ['token-a', 'token-b']);
  assert.deepEqual(sent[0].notification, { title: 'New voice message', body: 'Open Guardian to listen and reply.' });
  assert.equal(sent[0].data.recipientUid, uid);
  assert.equal(sent[0].android.notification.channelId, 'guardian_messages');
  assert.equal(sent[0].android.notification.visibility, 'private');
  assert.equal(rows.get('voiceMessages/' + stored.row.id).notification.accepted, 2);
  assert(!JSON.stringify(sent[0]).includes(audio.toString('base64')));
});

test('notification skips missing tokens, revoked access and deleted/expired audio', async () => {
  for (const condition of ['no_tokens', 'revoked', 'deleted', 'expired']) {
    const { db, rows } = memoryDb(), store = createVoiceStore(db), audio = synthetic();
    if (condition !== 'no_tokens') rows.get('users/' + uid).fcmTokens = ['token'];
    const { row } = await store.put({ access, id: store.incomingId(imei, audio), direction: 'incoming', audio, pcm: Buffer.alloc(16000), durationMs: 1000 });
    if (condition === 'revoked') rows.get('users/' + uid).linkedImeis = [];
    if (condition === 'deleted') rows.get('voiceMessages/' + row.id).deletedAtMs = Date.now();
    if (condition === 'expired') rows.get('voiceMessages/' + row.id).expiresAtMs = Date.now() - 1;
    let sends = 0;
    await notifyIncomingVoice({ db, access, row, runtime, messaging: () => ({ sendEachForMulticast: async () => { sends++; } }) });
    assert.equal(sends, 0, condition);
  }
});

test('push uncertainty never retries and does not alter received audio', async () => {
  const { db, rows } = memoryDb(), store = createVoiceStore(db), audio = synthetic();
  rows.get('users/' + uid).fcmTokens = ['token'];
  const { row } = await store.put({ access, id: store.incomingId(imei, audio), direction: 'incoming', audio, pcm: Buffer.alloc(16000), durationMs: 1000 });
  let sends = 0;
  const args = { db, access, row, runtime, timeoutMs: 5, messaging: () => ({ sendEachForMulticast: () => { sends++; return new Promise(() => {}); } }) };
  await notifyIncomingVoice(args);
  await notifyIncomingVoice(args);
  assert.equal(sends, 1);
  assert.equal(rows.get('voiceMessages/' + row.id).notification.status, 'unconfirmed');
  assert.equal(rows.get('voiceMessages/' + row.id).status, 'received');
  assert(rows.has('voiceMessagePrivate/' + row.id));
});

test('receiver acknowledges durable clip independently of push failure and does not push duplicates', async () => {
  const f = fixture(), { db } = memoryDb(), store = createVoiceStore(db);
  let attempts = 0;
  const receiver = createVoiceReceiver({ getDb: () => db, runtime,
    storeFactory: () => store, convert: async () => Buffer.alloc(16000), note: () => {},
    notify: async () => { attempts++; assert.equal(f.socket.frames.at(-1).toString(), buildAckFrame(protocolId, 'TK,1').toString()); throw Error('push failed'); },
  });
  receiver.observe(buildVoiceFrame(protocolId, synthetic()), f.socket, f.session);
  await new Promise(setImmediate);
  receiver.observe(buildVoiceFrame(protocolId, synthetic()), f.socket, f.session);
  await new Promise(setImmediate);
  assert.equal(attempts, 1);
  assert.equal(f.socket.frames.length, 2);
  assert(f.socket.frames.every(frame => frame.toString() === buildAckFrame(protocolId, 'TK,1').toString()));
});
test('live authorization requires explicit gate, exact pilot, current family link and active service', async () => {
  const { db, rows } = memoryDb();
  assert.equal(voiceRuntime({}).enabled, false);
  assert.equal((await authorizeVoice({ db, uid, imei, runtime })).uid, uid);
  for (const patch of [
    { uid: 'other' },
    { imei: '111111111111111' },
    { runtime: { ...runtime, enabled: false } },
  ])
    await assert.rejects(authorizeVoice({ db, uid, imei, runtime, ...patch }));
  rows.set('users/' + uid, { linkedImeis: [] });
  await assert.rejects(
    authorizeVoice({ db, uid, imei, runtime }),
    /device_not_linked/,
  );
});
test('HTTP verifies Firebase token; forged admin headers cannot read private media', async () => {
  const { db } = memoryDb();
  const handler = createVoiceHandler({
    getDb: () => db,
    runtime,
    verifyToken: async () => {
      throw Error('bad token');
    },
  });
  for (const headers of [
    {},
    { authorization: 'Bearer fake' },
    { 'x-admin-key': 'fake' },
  ]) {
    const req = Readable.from([]);
    req.method = 'GET';
    req.headers = headers;
    let status, body;
    const res = {
      writeHead: (s) => {
        status = s;
      },
      end: (b) => {
        body = JSON.parse(b);
      },
    };
    assert(
      await handler(
        req,
        res,
        new URL('http://local/app/voice-messages/audio?imei=' + imei + '&id=a'),
      ),
    );
    assert.equal(status, 401);
    assert.equal(body.error, 'sign_in_required');
  }
});

test('revocation immediately before dispatch leaves a definite not-sent result and zero writes', async () => {
  const { db } = memoryDb(),
    store = createVoiceStore(db),
    f = fixture();
  let checks = 0;
  const result = await sendVoice({
    access,
    request: {
      id: randomUUID(),
      createdAt: Date.now(),
      pcm: Buffer.alloc(16000).toString('base64'),
    },
    store,
    transport: f.transport,
    authorizeAgain: async () => {
      if (++checks === 2) throw Error('revoked');
    },
    convert: async () => synthetic(),
  });
  assert.equal(result.status, 'not_sent');
  assert.equal(f.socket.frames.length, 0);
  assert.equal((await store.list(access)).sendingBlocked, false);
});

test('malformed TK headers remain private; bounded escapes and request envelope reject invalid media', () => {
  const bad = Buffer.from(buildVoiceFrame(protocolId, synthetic()));
  bad.write('zzzz', 15);
  assert(isVoiceFrame(bad));
  assert.throws(() => decodeVoiceFrame(bad), /voice_invalid_header/);
  const { sendRequest } = require('../src/voice-message-policy');
  for (const value of [
    {},
    { id: randomUUID(), createdAt: Date.now() - 91000, pcm: 'AAAA' },
    { id: randomUUID(), createdAt: Date.now(), pcm: '?===' },
  ])
    assert.throws(() => sendRequest(value));
  const audio = synthetic(1500);
  audio.fill(0x7d);
  audio.write('#!AMR\n');
  for (let i = 6; i < audio.length; i += 32) {
    audio[i] = 0x3c;
    audio[i + 31] = 0x70;
  }
  assert.throws(
    () => buildVoiceFrame(protocolId, audio),
    /voice_wire_too_large/,
  );
});

test('daily cap, send spacing and id conflicts are enforced independently of UI', async () => {
  let time = Date.now();
  const { db, rows } = memoryDb(),
    store = createVoiceStore(db, () => time),
    args = {
      access,
      id: randomUUID(),
      direction: 'outgoing',
      audio: synthetic(),
      pcm: Buffer.alloc(16000),
      durationMs: 1000,
    };
  const first = await store.put(args);
  await store.update(first.row, 'reply_observed');
  await assert.rejects(
    store.put({ ...args, id: randomUUID() }),
    /send_cooldown/,
  );
  await assert.rejects(
    store.put({ ...args, audio: synthetic(60) }),
    /request_id_conflict/,
  );
  time += 60000;
  rows.set('voiceMessageDevices/' + imei, {
    day: Math.floor(time / RETENTION_MS),
    count: 120,
  });
  await assert.rejects(
    store.put({ ...args, id: randomUUID() }),
    /daily_message_limit/,
  );
});

test('final persistence failure cannot permit an automatic second send', async () => {
  const { db } = memoryDb(),
    store = createVoiceStore(db),
    f = fixture();
  f.socket.write = (frame) => {
    f.socket.frames.push(frame);
    queueMicrotask(() => f.reply());
    return true;
  };
  const failing = {
    ...store,
    update: async (row, status, ...args) => {
      if (status !== 'sending') throw Error('database unavailable');
      return store.update(row, status, ...args);
    },
  };
  await assert.rejects(
    sendVoice({
      access,
      request: {
        id: randomUUID(),
        createdAt: Date.now(),
        pcm: Buffer.alloc(16000).toString('base64'),
      },
      store: failing,
      transport: f.transport,
      authorizeAgain: async () => {},
      convert: async () => synthetic(),
    }),
  );
  assert.equal(f.socket.frames.length, 1);
  assert.equal((await createVoiceStore(db).list(access)).sendingBlocked, true);
});
