'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const preload = path.resolve(__dirname, '../scripts/trial-sedentary-framing-preload.cjs');
const realProtocol = path.resolve(__dirname, '../src/protocol/gt06.js');
const id = '1234567890';
function run(t, body, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardian-sedentary-frame-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'src/protocol'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/protocol/gt06.js'), options.protocol ||
    `module.exports = require(${JSON.stringify(realProtocol)});`);
  const entry = options.entry || 'src/server.js';
  fs.writeFileSync(path.join(dir, entry), `const assert = require('node:assert/strict');\n` +
    `const { buildAckFrame: frame } = require('./protocol/gt06');\n${body}`);
  const env = { ...process.env, GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID: id };
  delete env.NODE_OPTIONS;
  if (options.missingId) delete env.GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID;
  if (options.id !== undefined) env.GUARDIAN_SEDENTARY_FRAME_TRIAL_PROTOCOL_ID = options.id;
  return spawnSync(process.execPath, ['--require', preload, entry], {
    cwd: dir, env, encoding: 'utf8', timeout: 10000,
  });
}
function passed(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /"event":"sedentary_frame_trial_ready"/);
}
test('real gateway builder reproduces captured on/off bytes; all other frames unchanged', t => {
  const result = run(t, `
    assert.equal(frame('${id}', 'SEDENTARY,1,20').toString(), '[3G*${id}*000e*SEDENTARY,1,20]');
    assert.equal(frame('${id}', 'SEDENTARY,0,20').toString(), '[3G*${id}*000e*SEDENTARY,0,20]');
    for (const command of ['CR', 'LK', 'SEDENTARY', 'SEDENTARY,1,26', 'SEDENTARYWORKTIME,21:00-23:59,-', 'rcapture', 'CALL,1234']) {
      const length = command.length.toString(16).toUpperCase().padStart(4, '0');
      assert.equal(frame('${id}', command).toString(), '[SG*${id}*' + length + '*' + command + ']');
    }
    assert.equal(frame('9999999999', 'SEDENTARY,1,20').toString(), '[SG*9999999999*000E*SEDENTARY,1,20]');
  `);
  passed(result);
});
test('duplicate enable is blocked before another frame is built; off remains available', t => {
  const result = run(t, `
    frame('${id}', 'SEDENTARY,1,20');
    assert.throws(() => frame('${id}', 'SEDENTARY,1,20'), /enable_already_attempted/);
    assert.equal(frame('${id}', 'SEDENTARY,0,20').toString(), '[3G*${id}*000e*SEDENTARY,0,20]');
  `);
  passed(result);
  assert.equal((result.stdout.match(/"event":"sedentary_trial_frame_built"/g) || []).length, 2);
});
test('expired enable is blocked without returning the old SG frame; cleanup still works', t => {
  const result = run(t, `
    Date.now = () => Number.MAX_SAFE_INTEGER;
    assert.throws(() => frame('${id}', 'SEDENTARY,1,20'), /enable_window_expired/);
    assert.equal(frame('${id}', 'SEDENTARY,0,20').toString(), '[3G*${id}*000e*SEDENTARY,0,20]');
  `);
  passed(result);
});
test('missing or invalid pilot ID aborts before the server entry runs', t => {
  for (const options of [{ missingId: true }, { id: '../123' }, { id: '861397052547492' }]) {
    const result = run(t, `throw Error('ENTRY_RAN');`, options);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /exact pilot protocol ID/);
    assert.doesNotMatch(result.stderr, /ENTRY_RAN/);
  }
});
test('wrong entry and changed base framing abort rather than silently running unmodified', t => {
  const wrongEntry = run(t, `throw Error('ENTRY_RAN');`, { entry: 'src/other.js' });
  assert.notEqual(wrongEntry.status, 0);
  assert.match(wrongEntry.stderr, /Run from gateway/);
  const changed = run(t, `throw Error('ENTRY_RAN');`, {
    protocol: `exports.buildAckFrame = () => Buffer.from('different');`,
  });
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /Gateway framing changed/);
  assert.doesNotMatch(changed.stderr, /ENTRY_RAN/);
});
test('loading the helper builds no trial frame and sends no automatic command', t => {
  const result = run(t, `assert.equal(typeof frame, 'function');`);
  passed(result);
  assert.doesNotMatch(result.stdout, /"event":"sedentary_trial_frame_built"/);
  assert.match(result.stdout, /"automaticCommands":false/);
});
test('existing downlink sends captured bytes once, leaves CR unchanged and permits cleanup', t => {
  const downlinkPath = path.resolve(__dirname, '../src/downlink.js');
  const sessionsPath = path.resolve(__dirname, '../src/sessions.js');
  const wifiPath = path.resolve(__dirname, '../src/wifi-fence-runtime.js');
  const result = run(t, `
    const writes = [];
    let connected = false;
    require.cache[${JSON.stringify(sessionsPath)}] = { exports: {
      findSocketsForDevice: () => connected ? [{
        session: { protocolId: '${id}' },
        socket: { write: bytes => writes.push(bytes.toString('ascii')) }
      }] : []
    }};
    require.cache[${JSON.stringify(wifiPath)}] = { exports: { noteWifiFenceDownlink() {} } };
    const { sendDownlinkCommand: send } = require(${JSON.stringify(downlinkPath)});
    assert.equal(send('${id}', 'SEDENTARY,1,20').ok, false);
    assert.equal(writes.length, 0);
    connected = true;
    const on = send('${id}', 'SEDENTARY,1,20');
    assert.equal(on.ok, true);
    assert.equal(on.frame, '[3G*${id}*000e*SEDENTARY,1,20]');
    assert.throws(() => send('${id}', 'SEDENTARY,1,20'), /enable_already_attempted/);
    send('${id}', 'CR');
    send('${id}', 'SEDENTARY,0,20');
    assert.deepEqual(writes, [
      '[3G*${id}*000e*SEDENTARY,1,20]',
      '[SG*${id}*0002*CR]',
      '[3G*${id}*000e*SEDENTARY,0,20]'
    ]);
  `);
  passed(result);
});
