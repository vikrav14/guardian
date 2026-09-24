const test = require('node:test');
const assert = require('node:assert/strict');
const { extractFrames, decodeFrame, handlePacket, buildAckFrame } = require('../src/protocol/gt06');

function receive(content) {
  const length = Buffer.byteLength(content, 'ascii').toString(16).padStart(4, '0');
  const wire = Buffer.from(`[3G*9700000000*${length}*${content}]`, 'ascii');
  const { frames, rest } = extractFrames(wire);
  assert.equal(rest.length, 0);
  assert.equal(frames.length, 1);
  const { acks, events } = handlePacket(decodeFrame(frames[0]), {});
  assert.equal(acks.length, 0, 'a command reply must not start an ACK loop');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'command_echo');
  assert.equal(events[0].args, undefined, 'arbitrary raw arguments must not reach the generic logger');
  return events[0];
}

test('APPLOCK distinguishes a bare reply from returned mode or status tokens without asserting success', () => {
  const bare = receive('APPLOCK').replyEvidence;
  assert.equal(bare.kind, 'bare');
  assert.equal(bare.argumentCount, 0);
  assert.deepEqual(bare.arguments, []);
  assert.equal(bare.truncated, false);
  assert.equal(bare.appliedStateVerified, false);

  for (const token of ['JT-0', 'JT-1', 'OK', 'ERROR', 'FAIL', '0', '1']) {
    const evidence = receive(`APPLOCK,${token}`).replyEvidence;
    assert.equal(evidence.kind, 'parameterized');
    assert.equal(evidence.argumentCount, 1);
    assert.deepEqual(evidence.arguments, [token]);
    assert.equal(evidence.appliedStateVerified, false);
  }
});

test('APPLOCK preserves empty parameter presence and redacts unknown, contact and control data', () => {
  const args = ['', '+15550123456', 'PH-1', 'JT-2', 'JT-0\nforged-log', 'secret-token', 'JT-0'];
  const event = receive(`APPLOCK,${args.join(',')}`);
  assert.equal(event.replyEvidence.kind, 'parameterized');
  assert.equal(event.replyEvidence.argumentCount, args.length);
  assert.deepEqual(event.replyEvidence.arguments, [
    '[redacted]', '[redacted]', '[redacted]', '[redacted]', '[redacted]', '[redacted]', 'JT-0',
  ]);
  const rendered = JSON.stringify(event);
  for (const privateValue of args.slice(1, 6)) assert.ok(!rendered.includes(privateValue));
});

test('APPLOCK bounds diagnostic size even for oversized or many arguments', () => {
  const event = receive(`APPLOCK,${'x'.repeat(4096)},${Array(50).fill('JT-0').join(',')}`);
  assert.equal(event.replyEvidence.argumentCount, 51);
  assert.equal(event.replyEvidence.arguments.length, 8);
  assert.equal(event.replyEvidence.arguments[0], '[redacted]');
  assert.equal(event.replyEvidence.truncated, true);
  assert.ok(JSON.stringify(event).length < 500);
  assert.equal(event.replyEvidence.appliedStateVerified, false);
});

test('APPLOCK diagnostics leave other command replies unchanged', () => {
  const event = receive('profile,3');
  assert.equal(event.replyEvidence, undefined);
});

test('documented APPLOCK commands use the live protocol ID and twelve-byte payload', () => {
  for (const value of ['0', '1']) {
    assert.equal(buildAckFrame('9700000000', `APPLOCK,JT-${value}`).toString('ascii'),
      `[SG*9700000000*000C*APPLOCK,JT-${value}]`);
  }
});

test('CONFIG JT observation is bounded, passive, and never asserted to be an applied answer mode', () => {
  for (const [payload, jtField, reportedJt] of [
    ['JT:0,PHONE:+15550123456,PW:secret', 'valid', 0],
    ['JT:1', 'valid', 1],
    ['BT:2', 'missing', null],
    ['JT:0,JT:1', 'duplicate', null],
    ['JT:+15550123456', 'invalid', null],
    ['JT:2', 'invalid', null],
  ]) {
    const content = `CONFIG,${payload}`;
    const length = Buffer.byteLength(content).toString(16).padStart(4, '0');
    const { acks, events } = handlePacket(decodeFrame(Buffer.from(`[3G*9700000000*${length}*${content}]`)), {});
    assert.equal(acks.length, 1);
    assert.equal(acks[0].toString('ascii'), '[SG*9700000000*0008*CONFIG,1]');
    const event = events.find(value => value.type === 'answer_mode_config');
    assert.deepEqual(event.evidence, { jtField, reportedJt, meaningVerified: false, appliedStateVerified: false });
    assert.ok(!JSON.stringify(event).includes('+15550123456'));
    assert.ok(!JSON.stringify(event).includes('secret'));
  }
});
