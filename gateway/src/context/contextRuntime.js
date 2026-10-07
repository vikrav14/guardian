const ContextService = require('./contextService');
const { CapAlertProvider } = require('./capAlertProvider');
const { DefiMediaRssProvider } = require('./defiMediaRssProvider');
const { startPriorityUpdateScheduler } = require('./priorityUpdateScheduler');
const { startContextScheduler } = require('./contextScheduler');
const {
  startContextSourceScheduler,
  stopContextSourceSchedulerForTests,
} = require('./contextSourceScheduler');
const {
  startDefiMediaRssScheduler,
  stopDefiMediaRssSchedulerForTests,
} = require('./defiMediaRssScheduler');

let runtime = null;

/** One service instance owns the weather cache and shadow observation log. */
function initializeContextRuntime({ config, llmProvider, db }) {
  if (runtime) return runtime;
  const capAlertProvider = new CapAlertProvider(config);
  const defiMediaRssProvider = new DefiMediaRssProvider(config);
  const service = new ContextService(config.openWeatherMapKey, llmProvider, config, {
    capAlertProvider,
    db,
  });
  const scheduler = startContextScheduler({ db, contextService: service, config });
  const sourceScheduler = startContextSourceScheduler({
    db,
    provider: capAlertProvider,
    contextService: service,
    config,
  });
  const defiMediaRssScheduler = startDefiMediaRssScheduler({
    db,
    provider: defiMediaRssProvider,
    config,
  });
  const priorityUpdateScheduler = startPriorityUpdateScheduler({ db, config,
    mediaProvider: defiMediaRssProvider, capProvider: capAlertProvider });
  runtime = {
    service,
    scheduler,
    sourceScheduler,
    capAlertProvider,
    defiMediaRssProvider,
    defiMediaRssScheduler,
    priorityUpdateScheduler,
  };
  return runtime;
}

function getContextRuntime() {
  return runtime;
}

function stopContextRuntimeForTests() {
  runtime?.scheduler?.stop?.();
  runtime?.sourceScheduler?.stop?.();
  runtime?.defiMediaRssScheduler?.stop?.();
  runtime?.priorityUpdateScheduler?.stop?.();
  stopContextSourceSchedulerForTests();
  stopDefiMediaRssSchedulerForTests();
  runtime = null;
}

module.exports = {
  initializeContextRuntime,
  getContextRuntime,
  stopContextRuntimeForTests,
};
