'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { createLedger } = require('./ledger');
const { fail, policy } = require('./policy');
const scopes = new AsyncLocalStorage();
function runAiScope(context, work) {
  if (!context?.db || typeof context.authorize !== 'function') fail('ai_scope_required');
  return scopes.run({ ...context, attempt: 0, limits: context.limits || policy() }, work);
}
function currentScope() { return scopes.getStore() || fail('ai_scope_required'); }
async function meteredCall({ model, inputTokens, maxTokens, feature, perform }) {
  const scope = currentScope();
  await scope.authorize();
  const ledger = createLedger(scope.db, { now: scope.now || Date.now, limits: scope.limits });
  const claim = await ledger.reserve({ ...scope, attempt: ++scope.attempt, model, inputTokens, maxTokens, feature: feature || scope.feature });
  let result;
  try {
    await scope.authorize();
    result = await perform();
  } catch (error) {
    // A timeout does not imply the provider did no work. Never refund or retry
    // an ambiguous request automatically, even across gateway restarts.
    await ledger.settle(claim, error.usage || null, 'failed');
    throw error;
  }
  await ledger.settle(claim, result.usage || null);
  await scope.authorize();
  return result;
}
module.exports = { runAiScope, currentScope, meteredCall };
