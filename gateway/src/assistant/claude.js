'use strict';
// Compatibility entry point for the development chat script. Production and
// development use the same authorised, metered intelligence service.
const config = require('../config');
const { createLlmProvider } = require('../providers');
const { createIntelligenceService } = require('../intelligence-core/service');
async function answerWithAssistant(db, ctx, userText) {
  if (!ctx?.uid || ctx.devices?.length !== 1) return { reply: 'Select one authorised watch in the Guardian app first.' };
  try {
    const answer = await createIntelligenceService({ db, provider: createLlmProvider(config) }).answer({
      uid: ctx.uid, imei: ctx.devices[0].imei, question: userText });
    return { reply: answer.message || answer.facts.map(fact => fact.text).join('\n'), toolsUsed: [] };
  } catch { return { reply: 'Guardian AI is unavailable. Recorded information remains available in the app.' }; }
}
module.exports = { answerWithAssistant };
