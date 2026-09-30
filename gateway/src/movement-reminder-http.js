'use strict';

const admin = require('firebase-admin');
const { MovementError, movementRuntime, authorizeMovement, movementSettings,
  movementAction, movementCommands } = require('./movement-reminder-policy');
const { createMovementStore } = require('./movement-reminder-store');
const { movementTransport } = require('./movement-reminder-transport');

async function executeMovement({ access, payload, store, transport, authorizeAgain = async () => {} }) {
  if (payload && !Object.hasOwn(payload, 'action')) throw new MovementError('app_update_required', 400);
  if (!payload || Object.keys(payload).sort().join(',') !== 'action,expectedVersion,requestId,settings'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(payload.requestId || '')
      || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion < 0) {
    throw new MovementError('invalid_request', 400);
  }
  const settings = movementSettings(payload.settings);
  const action = movementAction(payload.action);
  const claimed = await store.claim({ ...access, requestId: payload.requestId,
    expectedVersion: payload.expectedVersion, settings, action });
  if (claimed.replay) return claimed.state;
  const evidence = [];
  const identity = { imei: access.imei, requestId: payload.requestId };
  let writeAttempted = false;
  let status = 'not_sent';
  let reason = null;
  try {
    const bound = transport.bind(access.imei);
    for (const command of movementCommands(settings, action)) {
      // Recheck linkage/subscription immediately before the explicit action.
      await authorizeAgain();
      await store.update({ ...identity, patch: { nextCommand: command, evidence: [...evidence] } });
      writeAttempted = true;
      const result = await bound.send(command);
      evidence.push(result);
      await store.update({ ...identity, patch: { nextCommand: null, evidence: [...evidence] } });
      if (!result.replyObserved) throw new MovementError(result.reason || 'reply_timeout');
    }
    status = 'replies_observed';
  } catch (error) {
    status = writeAttempted ? 'unconfirmed' : 'not_sent';
    reason = error instanceof MovementError ? error.code : 'operation_interrupted';
  }
  // If this fails, the durable sending record expires to unconfirmed. Never
  // replace it with success or resend a possibly delivered enable.
  return store.update({ ...identity, patch: { status, reason, evidence,
    nextCommand: null, finishedAt: new Date().toISOString() } });
}

async function readSmallJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) throw new MovementError('request_too_large', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new MovementError('invalid_json', 400); }
}

function createMovementHandler({ getDb, runtime = movementRuntime(), transport = movementTransport,
  verifyToken = token => admin.auth().verifyIdToken(token, true),
  storeFactory = createMovementStore } = {}) {
  return async function handle(req, res, url) {
    if (url.pathname !== '/app/movement-reminders') return false;
    const reply = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      res.end(JSON.stringify(value));
    };
    try {
      if (!['GET', 'POST'].includes(req.method)) throw new MovementError('method_not_allowed', 405);
      if (!runtime.enabled) throw new MovementError('pilot_not_available', 403);
      const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
      if (!bearer) throw new MovementError('sign_in_required', 401);
      let token;
      try { token = await verifyToken(bearer[1]); }
      catch { throw new MovementError('sign_in_required', 401); }
      const db = getDb();
      if (!db) throw new MovementError('gateway_unavailable', 503);
      const imei = url.searchParams.get('imei') || '';
      const authorizeAgain = () => authorizeMovement({ db, uid: token.uid, imei, runtime });
      const access = await authorizeAgain();
      const store = storeFactory(db);
      const state = req.method === 'GET' ? await store.read(imei)
        : await executeMovement({ access, payload: await readSmallJson(req), store, transport, authorizeAgain });
      reply(200, { ...state, pilot: true, connected: transport.connected(imei) });
    } catch (error) {
      reply(error instanceof MovementError ? error.status : 503,
        { error: error instanceof MovementError ? error.code : 'gateway_unavailable' });
    }
    return true;
  };
}

module.exports = { executeMovement, createMovementHandler, readSmallJson };
