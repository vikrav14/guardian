'use strict';

const DEFAULT_POLICY = Object.freeze({
  actionableMinutes: 180,
  impactRadiusMeters: 2000,
  approachRadiusMeters: 12_000,
});

const EVENT_POLICIES = Object.freeze({
  public_safety: Object.freeze({
    actionableMinutes: 90,
    impactRadiusMeters: 2000,
    approachRadiusMeters: 12_000,
  }),
  road_disruption: Object.freeze({
    actionableMinutes: 180,
    impactRadiusMeters: 1500,
    approachRadiusMeters: 12_000,
  }),
  fire: Object.freeze({
    actionableMinutes: 180,
    impactRadiusMeters: 2500,
    approachRadiusMeters: 12_000,
  }),
  flood_or_landslide: Object.freeze({
    actionableMinutes: 360,
    impactRadiusMeters: 5000,
    approachRadiusMeters: 15_000,
  }),
  school_disruption: Object.freeze({
    actionableMinutes: 360,
    impactRadiusMeters: 2000,
    approachRadiusMeters: 10_000,
  }),
  infrastructure_disruption: Object.freeze({
    actionableMinutes: 360,
    impactRadiusMeters: 3000,
    approachRadiusMeters: 12_000,
  }),
  health_hazard: Object.freeze({
    actionableMinutes: 24 * 60,
    impactRadiusMeters: 10_000,
    approachRadiusMeters: 15_000,
  }),
  missing_vulnerable_person: Object.freeze({
    actionableMinutes: 24 * 60,
    impactRadiusMeters: 5000,
    approachRadiusMeters: 12_000,
  }),
});

function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === 'function') return asDate(value.toDate());
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function policyForEvent(eventType) {
  return EVENT_POLICIES[String(eventType || '')] || DEFAULT_POLICY;
}

function actionableUntilFor(item, { maxAgeHours = 24 } = {}) {
  const publishedAt = asDate(item?.publishedAt);
  if (!publishedAt) return null;
  const policyMinutes = policyForEvent(item?.eventType).actionableMinutes;
  const configuredMinutes = Math.max(1, Number(maxAgeHours || 24)) * 60;
  return new Date(
    publishedAt.getTime() + Math.min(policyMinutes, configuredMinutes) * 60_000,
  );
}

function isActionableNewsItem(item, now = new Date()) {
  if (item?.safetyCandidate !== true) return false;
  const observedAt = asDate(now);
  const publishedAt = asDate(item.publishedAt);
  const actionableUntil = asDate(item.actionableUntil);
  if (!observedAt || !publishedAt || !actionableUntil) return false;
  const futureToleranceMs = 2 * 60_000;
  return publishedAt.getTime() <= observedAt.getTime() + futureToleranceMs
    && actionableUntil.getTime() >= observedAt.getTime();
}

module.exports = {
  DEFAULT_POLICY,
  EVENT_POLICIES,
  actionableUntilFor,
  asDate,
  isActionableNewsItem,
  policyForEvent,
};
