'use strict';

// Set once when authorizing a NEW request. Never extend a persisted deadline.
// A 60-second reporting policy probes packet silence after 180 seconds. The
// 2 October trace saw a photo frame at 187.553 seconds, after the old 120-second
// deadline. Four minutes allows that observed delay without another capture.
// This bounds waiting; it does not guarantee camera readiness or correlation.
const MANUAL_CAPTURE_WINDOW_MS = 120_000;
const INCIDENT_CAPTURE_WINDOW_MS = 240_000;
const MAX_CAPTURE_WINDOW_MS = INCIDENT_CAPTURE_WINDOW_MS;

module.exports = { MANUAL_CAPTURE_WINDOW_MS, INCIDENT_CAPTURE_WINDOW_MS, MAX_CAPTURE_WINDOW_MS };
