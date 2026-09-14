'use strict';
const { ingestRemovalObservation } = require('./removal-alert-store');
const { wearAt } = require('./wear-evidence');

// Supplementary removal persistence/delivery never joins the SOS or GPS queue.
// Coalesce while busy: dropping an intermediate sample delays confirmation; it
// cannot fabricate removal. The shared quality observer still sees every packet.
function createRemovalDispatcher({ db, config = {}, createAlert, onError = () => {}, now = () => new Date() }) {
  const pending = new Map();
  function observe(event, receivedAt) {
    if (!config.removalAlertsIngestEnabled || !event.imei || !event.wearEvidence) return;
    const work = pending.get(event.imei) || { next: null, running: false };
    work.next = { ...event, observedAt: receivedAt };
    work.latest = work.next; pending.set(event.imei, work);
    if (work.running) return;
    work.running = true;
    void (async () => {
      try {
        while (work.next) {
          const next = work.next; work.next = null;
          const outcome = await ingestRemovalObservation(db, next, {
            enabled: true, mode: config.removalAlertsDeviceMode,
            customerEnabled: config.removalAlertsCustomerEnabled,
          });
          if (outcome.transition?.notify && wearAt(work.latest.wearEvidence, now()).state === 'removed') await createAlert(next.imei, {
            type: 'watch_removed', severity: 'warning',
            message: 'The watch may have been removed. Please check with the wearer.',
            eventAt: outcome.transition.at,
            payload: { source: 'v52_removal_policy', quiet: false },
          });
        }
      } catch (error) { onError(error); }
      finally { pending.delete(event.imei); }
    })();
  }
  return { observe };
}
module.exports = { createRemovalDispatcher };
