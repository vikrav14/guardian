const ContextService = require('./contextService');
const { startContextScheduler } = require('./contextScheduler');

let runtime = null;

/** One service instance owns the weather cache and shadow observation log. */
function initializeContextRuntime({ config, llmProvider, db }) {
  if (runtime) return runtime;
  const service = new ContextService(config.openWeatherMapKey, llmProvider, config);
  const scheduler = startContextScheduler({ db, contextService: service, config });
  runtime = { service, scheduler };
  return runtime;
}

function getContextRuntime() {
  return runtime;
}

function stopContextRuntimeForTests() {
  runtime?.scheduler?.stop?.();
  runtime = null;
}

module.exports = {
  initializeContextRuntime,
  getContextRuntime,
  stopContextRuntimeForTests,
};
