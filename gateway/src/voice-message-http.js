'use strict';
const admin = require('firebase-admin');
const {
  VoiceError,
  voiceRuntime,
  authorizeVoice,
  sendRequest,
  publicMessage,
} = require('./voice-message-policy');
const { createVoiceStore } = require('./voice-message-store');
const { voiceTransport } = require('./voice-message-transport');
const { convertVoice, validatePcm, wav } = require('./voice-message-audio');
const { inspectVoice, MAX_SECONDS } = require('./voice-message-codec');
async function readJson(req) {
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 641000) throw new VoiceError('request_too_large', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new VoiceError('invalid_request', 400);
  }
}
async function sendVoice({
  access,
  request,
  store,
  transport,
  authorizeAgain,
  convert = convertVoice,
  now = Date.now,
}) {
  const value = sendRequest(request, now());
  // Bound the original intent, including conversion and database waits. A slow
  // authorization or transaction must never grant a fresh dispatch window.
  const dispatchUntilMs = Math.min(now() + 30000, value.createdAt + 90000);
  let pcm, audio;
  try {
    pcm = validatePcm(Buffer.from(value.pcm, 'base64'));
    audio = await convert(pcm, 'encode');
  } catch {
    throw new VoiceError('recording_processing_failed', 400);
  }
  await authorizeAgain();
  if (now() >= dispatchUntilMs) throw new VoiceError('send_expired');
  const claim = await store.put({
    access,
    id: value.id,
    direction: 'outgoing',
    dispatchUntilMs,
    pcm,
    audio,
    durationMs: inspectVoice(audio).durationMs,
  });
  if (claim.replay) return publicMessage(claim.row, access.uid, now());
  let attempted = false;
  try {
    const bound = transport.bind(access.imei, claim.row);
    // Persist ambiguity before any bytes can leave the process. No background retry.
    await store.update(claim.row, 'sending');
    await authorizeAgain();
    const pending = bound.send(audio);
    attempted = true;
    const result = await pending;
    return publicMessage(
      await store.update(claim.row, result.status, result.reason),
      access.uid,
      now(),
    );
  } catch (error) {
    return publicMessage(
      await store.update(
        claim.row,
        attempted ? 'unconfirmed' : 'not_sent',
        error instanceof VoiceError ? error.code : 'gateway_interrupted',
      ),
      access.uid,
      now(),
    );
  }
}
function createVoiceHandler({
  getDb,
  runtime = voiceRuntime(),
  transport = voiceTransport,
  verifyToken = (token) => admin.auth().verifyIdToken(token, true),
  storeFactory = createVoiceStore,
  authorize = authorizeVoice,
} = {}) {
  const active = new Set();
  return async (req, res, url) => {
    if (
      ![
        '/app/voice-messages',
        '/app/voice-messages/audio',
        '/app/voice-messages/played',
        '/app/voice-messages/delete',
      ].includes(url.pathname)
    )
      return false;
    const headers = {
      'Cache-Control': 'no-store, private',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
    };
    const reply = (status, value) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    let key;
    try {
      if (!runtime.enabled) throw new VoiceError('feature_unavailable', 403);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) throw new VoiceError('sign_in_required', 401);
      let token;
      try {
        token = await verifyToken(bearer[1]);
      } catch {
        throw new VoiceError('sign_in_required', 401);
      }
      const db = getDb();
      if (!db) throw new VoiceError('gateway_unavailable', 503);
      const imei = url.searchParams.get('imei') || '',
        id = url.searchParams.get('id') || '';
      const authorizeAgain = () =>
        authorize({ db, uid: token.uid, imei, runtime });
      const access = await authorizeAgain(),
        store = storeFactory(db);
      if (url.pathname === '/app/voice-messages') {
        if (req.method === 'GET') {
          const inbox = await store.list(access);
          await authorizeAgain();
          reply(200, {
            ...inbox,
            connected: transport.connected(imei),
            maxSeconds: MAX_SECONDS,
          });
        } else if (req.method === 'POST') {
          if (active.has(imei)) throw new VoiceError('message_in_progress');
          key = imei;
          active.add(imei);
          reply(200, {
            message: await sendVoice({
              access,
              request: await readJson(req),
              store,
              transport,
              authorizeAgain,
            }),
          });
        } else throw new VoiceError('method_not_allowed', 405);
      } else {
        if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
          throw new VoiceError('invalid_request', 400);
        if (url.pathname.endsWith('/audio')) {
          if (req.method !== 'GET')
            throw new VoiceError('method_not_allowed', 405);
          const bytes = wav(await store.audio(access, id));
          await authorizeAgain();
          res.writeHead(200, {
            ...headers,
            'Content-Type': 'audio/wav',
            'Content-Length': bytes.length,
          });
          res.end(bytes);
        } else {
          if (req.method !== 'POST')
            throw new VoiceError('method_not_allowed', 405);
          if (url.pathname.endsWith('/played'))
            await store.markPlayed(access, id);
          else await store.remove(access, id);
          reply(200, { ok: true });
        }
      }
    } catch (error) {
      reply(error instanceof VoiceError ? error.status : 503, {
        error: error instanceof VoiceError ? error.code : 'gateway_unavailable',
      });
    } finally {
      if (key) active.delete(key);
    }
    return true;
  };
}
module.exports = { createVoiceHandler, sendVoice, readJson };
