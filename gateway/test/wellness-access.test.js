'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { wellnessWindow, wellnessDayStart, wellnessRecordInWindow } = require('../src/wellness-access');
const { evaluateSubscription } = require('../src/entitlements');
const now = new Date('2026-09-14T20:00:00Z'); // Mauritius midnight on the 15th.
const context = (plan) => evaluateSubscription({ version: 1, managedBy: 'guardian_admin', plan, status: 'active' }, { now });
test('edition windows use Mauritius midnight and include today', () => {
  assert.equal(wellnessDayStart(now).toISOString(), '2026-09-14T20:00:00.000Z');
  assert.equal(wellnessDayStart(new Date(now - 1)).toISOString(), '2026-09-13T20:00:00.000Z');
  for (const [plan, days] of [['essential', 1], ['family', 7], ['care', 31]]) {
    const window = wellnessWindow(context(plan), { now, days: 100 });
    assert.equal(window.days, days);
    assert.equal(window.end.toISOString(), '2026-09-15T20:00:00.000Z');
    assert.equal(wellnessRecordInWindow(new Date(window.start - 1), window, now), false);
    assert.equal(wellnessRecordInWindow(window.start, window, now), true);
    assert.equal(wellnessRecordInWindow(new Date(+now + 1), window, now), false);
  }
});
test('inactive and unknown plans cannot acquire a wellness query window', () => {
  assert.equal(wellnessWindow({ serviceActive: false, plan: 'care' }), null);
  assert.equal(wellnessWindow({ serviceActive: true, plan: 'invented' }), null);
  assert.equal(wellnessWindow(context('essential'), { now, minimumPlan: 'family' }), null);
  assert.ok(wellnessWindow(context('family'), { now, minimumPlan: 'family' }));
  assert.ok(wellnessWindow(context('care'), { now, minimumPlan: 'family' }));
});
