'use strict';

// A one-shot server snapshot with a public cancellation mechanism. Unlike an
// abandoned get() promise, unsubscribing cancels the listener on timeout/stop,
// so a disconnected backend cannot accumulate outstanding retries.
function readFirstSnapshot(reference, signal) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    let settled = false;
    const finish = (error, snapshot) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      unsubscribe?.();
      if (error) reject(error); else resolve(snapshot);
    };
    const abort = () => finish(signal.reason || new Error('home_binding_cancelled'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      unsubscribe = reference.onSnapshot(snapshot => finish(null, snapshot), error => finish(error));
      // Also support synchronous callbacks in adapters/tests.
      if (settled) unsubscribe();
    } catch (error) { finish(error); }
  });
}

module.exports = { readFirstSnapshot };
