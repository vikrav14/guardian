/**
 * This fleet operates only in Mauritius (Southern Hemisphere) -- there is no
 * legitimate reading where a genuine satellite fix's latitude is positive.
 * Confirmed against real hardware (2026-07-28): every "A" (GPS-valid) fix
 * from both deployed units reported the wrong hemisphere letter, while the
 * same device's WiFi/cell-resolved fallback position (computed independently
 * via Google's Geolocation API, not from this NMEA field) was correctly
 * negative every time -- a repeatable firmware defect, not sensor noise.
 *
 * Deliberately kept out of gt06.js: that decoder is protocol-generic (its
 * own tests use the vendor's own non-Mauritius example coordinates), so this
 * deployment-specific correction lives in its own module instead, applied
 * only to genuine satellite fixes (accuracySource 'gps'), never to the
 * already-correct WiFi/LBS-resolved fallback path.
 */
function correctFleetHemisphere(locEvent) {
  if (!locEvent || locEvent.accuracySource !== 'gps' || !locEvent.location) {
    return locEvent;
  }
  const { lat } = locEvent.location;
  if (typeof lat !== 'number' || lat <= 0) return locEvent;
  return { ...locEvent, location: { ...locEvent.location, lat: -lat } };
}

module.exports = { correctFleetHemisphere };
