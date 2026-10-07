'use strict';

// Observation only: never abandon an in-flight job or unlock it on a timer.
// A late transaction/transport result must not race a replacement worker.
function createPhotoProgress({ name, now, log, slowMs = 60_000 }) {
  let running = false, stage = 'idle', startedAt = null, stageStartedAt = null;
  let lastCompletedAt = null, lastFailureStage = null, warned = false;
  let skippedRuns = 0;
  const iso = date => date?.toISOString() || null;
  function getStatus() {
    const elapsedMs = stageStartedAt ? Math.max(0, now() - stageStartedAt) : null;
    return { running, stage, startedAt: iso(startedAt), stageStartedAt: iso(stageStartedAt),
      elapsedMs, operationSlow: running && elapsedMs >= slowMs,
      lastCompletedAt: iso(lastCompletedAt), lastFailureStage, skippedRuns };
  }
  function check() {
    const status = getStatus();
    if (status.operationSlow && !warned) {
      warned = true;
      log(`[incident-photos] ${JSON.stringify({ outcome: 'worker_operation_slow',
        worker: name, stage, elapsedMs: status.elapsedMs })}`);
    }
  }
  function begin() {
    if (running) { skippedRuns++; check(); return false; }
    running = true; startedAt = now(); return true;
  }
  async function step(nextStage, work) {
    stage = nextStage; stageStartedAt = now(); warned = false;
    try { return await work(); }
    catch (error) { lastFailureStage = stage; throw error; }
  }
  function finish() {
    running = false; stage = 'idle'; stageStartedAt = null; lastCompletedAt = now();
  }
  return { begin, step, finish, check, getStatus };
}

module.exports = { createPhotoProgress };
