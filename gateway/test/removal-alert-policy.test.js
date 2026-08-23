'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeRemovalSettings,
  normalizeRemovalObservation,
  reduceRemovalState,
} = require('../src/removal-alert-policy');

function observation(removed, seconds = 0) {
  return normalizeRemovalObservation({
    imei: '000000000000001',
    braceletRemoved: removed,
    observedAt: new Date(Date.UTC(2026, 7, 23, 10, 0, seconds)),
    source: 'v52_tracker_state',
  });
}

test('removal settings fail closed and bound debounce windows', () => {
  assert.deepEqual(normalizeRemovalSettings({}), {
    enabled: false,
    debounceSeconds: 60,
    restoreDebounceSeconds: 60,
    quietStart: null,
    quietEnd: null,
    timeZone: 'Indian/Mauritius',
  });
  assert.equal(normalizeRemovalSettings({ debounceSeconds: 2 }).debounceSeconds, 30);
  assert.equal(normalizeRemovalSettings({ debounceSeconds: 900 }).debounceSeconds, 600);
});

test('one removal observation never creates a customer alert', () => {
  const result = reduceRemovalState(null, observation(true), { enabled: true }, {
    mode: 'accepted',
    customerEnabled: true,
  });
  assert.equal(result.state.state, 'unknown');
  assert.equal(result.state.candidateState, 'removed');
  assert.equal(result.transition, null);
});

test('sustained removal confirms only after debounce', () => {
  const settings = { enabled: true, debounceSeconds: 30 };
  let result = reduceRemovalState(null, observation(false), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(true, 1), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  assert.equal(result.transition, null);
  result = reduceRemovalState(result.state, observation(true, 31), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  assert.equal(result.state.state, 'removed');
  assert.equal(result.transition.type, 'watch_removed');
  assert.equal(result.transition.notify, true);
});

test('unverified mode records transition but cannot notify', () => {
  const settings = { enabled: true, debounceSeconds: 30 };
  let result = reduceRemovalState(null, observation(false), settings);
  result = reduceRemovalState(result.state, observation(true, 1), settings);
  result = reduceRemovalState(result.state, observation(true, 31), settings);
  assert.equal(result.transition.type, 'watch_removed');
  assert.equal(result.transition.notify, false);
  assert.equal(result.state.displayable, false);
});

test('clear observation cancels an unconfirmed removal', () => {
  let result = reduceRemovalState(null, observation(false), {});
  result = reduceRemovalState(result.state, observation(true, 1), {});
  result = reduceRemovalState(result.state, observation(false, 2), {});
  assert.equal(result.state.state, 'worn');
  assert.equal(result.state.candidateState, null);
  assert.equal(result.transition, null);
});

test('restoration is independently debounced and deduplicated', () => {
  const settings = {
    enabled: true,
    debounceSeconds: 30,
    restoreDebounceSeconds: 30,
  };
  let result = reduceRemovalState(null, observation(false), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(true, 1), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(true, 31), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(false, 32), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  assert.equal(result.transition, null);
  result = reduceRemovalState(result.state, observation(false, 62), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  assert.equal(result.transition.type, 'watch_restored');
  assert.equal(result.transition.notify, false);
  assert.equal(result.state.state, 'worn');
});

test('quiet period suppresses delivery without suppressing transition evidence', () => {
  const settings = {
    enabled: true,
    debounceSeconds: 30,
    quietStart: '13:00',
    quietEnd: '15:00',
  };
  let result = reduceRemovalState(null, observation(false), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(true, 1), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  result = reduceRemovalState(result.state, observation(true, 31), settings, {
    mode: 'accepted', customerEnabled: true,
  });
  assert.equal(result.transition.type, 'watch_removed');
  assert.equal(result.transition.quiet, true);
  assert.equal(result.transition.notify, false);
});
