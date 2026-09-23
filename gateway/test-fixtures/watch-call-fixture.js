'use strict';

const imei = '861397000000000', protocolId = '9700000000', phone = '0023050000000';
function capturedFrames() {
  const frames = [`[3G*${protocolId}*0013*ACALL,${phone}]`, `[3G*${protocolId}*0005*ACALL]`,
    `[3G*${protocolId}*000c*APPLOCK,JT-0]`, `[3G*${protocolId}*0007*ACALL,0]`,
    `[3G*${protocolId}*0007*APPLOCK]`, `[3G*${protocolId}*0005*ACALL]`];
  return frames.map((frame, i) => ({ event: 'private_answer_frame', at: new Date(Date.UTC(2026, 8, 23, 17, 4, i)).toISOString(),
    session: i < 2 ? 1 : 2, direction: [0, 2, 3].includes(i) ? 'server_to_watch' : 'watch_to_server',
    command: i === 2 || i === 4 ? 'APPLOCK' : 'ACALL', prefix: '3G', lengthField: frame.split('*')[2],
    frameHex: Buffer.from(frame).toString('hex'), appliedStateVerified: false }));
}
function callRequest(mode = 'auto', now = Date.now()) {
  return { imei, mode, requestedBy: 'owner', createdAt: new Date(now - 1000),
    expiresAt: new Date(now + 60000), status: 'pending', consentAccepted: mode === 'auto', policyRevision: 'revision-1' };
}
function callPolicy() {
  return { version: 1, managedBy: 'guardian_admin', protocolId, revision: 'revision-1', autoEnabled: true, capture: capturedFrames() };
}
module.exports = { imei, protocolId, phone, capturedFrames, callRequest, callPolicy };
