const ContextService = require('./contextService');
const { CapAlertProvider } = require('./capAlertProvider');
const { startContextScheduler } = require('./contextScheduler');
const {
  startContextSourceScheduler,
  stopContextSourceSchedulerForTests,
} = require('./contextSourceScheduler');

let runtime = null;

/** One service instance owns the weather cache and shadow observation log. */
function initializeContextRuntime({ config, llmProvider, db }) {
  if (runtime) return runtime;
  const capAlertProvider = new CapAlertProvider(config);
  const service = new ContextService(config.openWeatherMapKey, llmProvider, config, {
    capAlertProvider,
  });
  const scheduler = startContextScheduler({ db, contextService: service, config });
  const sourceScheduler = startContextSourceScheduler({
    db,
    provider: capAlertProvider,
    contextService: service,
    config,
  });
  runtime = { service, scheduler, sourceScheduler, capAlertProvider };
  return runtime;
}

function getContextRuntime() {
  return runtime;
}

function stopContextRuntimeForTests() {
  runtime?.scheduler?.stop?.();
  runtime?.sourceScheduler?.stop?.();
  stopContextSourceSchedulerForTests();
  runtime = null;
}

module.exports = {
  initializeContextRuntime,
  getContextRuntime,
  stopContextRuntimeForTests,
};
