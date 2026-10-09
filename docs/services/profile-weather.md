# Profile weather

The family overview replaces its Guardian Help shortcut with area weather for the selected watch. The existing help service remains available through its other entry points. Weather is independent of watch connectivity, wearing status and wellness checks.

## Display

The atmospheric header uses bundled 3D artwork for clear skies, partly cloudy skies, clouds, rain, thunderstorms, mist, snow and clear-night conditions. Wind supplements the reported condition, with speed and optional gusts in km/h. A wind illustration appears at 30 km/h; this is a presentation threshold, not an official warning classification.

The panel shows temperature, the named area and the weather observation age. When the latest usable location is at least an hour old, it shows fresh weather for the **last known area**, explicitly labelled with the location's age. This does not claim that the wearer is still there. The fallback lasts at most 24 hours after the actual location observation. Details keep the location observation, weather observation and fetch times separate. Missing, expired, unsupported or failed data shows `Weather unavailable`, with no sunny/cloudy illustration suggesting known conditions.

## Data and access

- Gateway-owned document: `devices/{imei}/weather/current` (schema version 1).
- Authenticated guardians may read the current document only while linked to that watch. All client writes are denied.
- The gateway uses the existing `OPEN_WEATHER_MAP_KEY`; credentials never reach the app.
- For recent location evidence, weather uses the existing reliable-location selection and independently verifies actual coordinates and `recordedAt`. When no valid location is under an hour old, the profile panel uses the newest valid GPS/Wi-Fi/LBS observation under 24 hours old. An older GPS fix cannot displace a newer area observation in this fallback. Heartbeats cannot refresh location evidence.
- Provider weather data and fetch time must remain under 60 minutes old. Location evidence has its own 24-hour maximum, with a one-minute future-clock tolerance. `locationBasis` is `recent` or `last_known`; it never changes the location timestamp. The client also expires the panel locally, even without another Firestore update.
- The extended last-known-area display applies to the profile panel. WhatsApp's current-location weather answer retains its existing one-hour location limit.
- The provider's `dt` is the weather data calculation time. `fetchedAt` describes the HTTP fetch; a cached result retains its original times.
- Each five-minute sweep processes at most 100 devices, rotating through larger fleets. Requests share a ten-minute geographic-cell cache with bounded concurrency and request timeouts. Larger fleets take multiple sweeps.
- Projection documents are replaced in full. Errors cannot retain an old temperature alongside a new unavailable state.

The feature does not send a watch command, enable removal detection, run a vital measurement, alter a wellness routine or generate a weather alert. It displays reported area conditions rather than weather measured by the watch.

Provider reference: [current weather fields](https://old.openweathermap.org/current) and [condition codes](https://old.openweathermap.org/weather-conditions).

## Rollout

1. Pull `feat/v52-care-wellbeing`.
2. From the repository root, deploy the updated rules: `firebase deploy --only firestore:rules --project guardian-fbadd`.
3. Restart the existing gateway once. With its weather key configured, the first projection sweep starts automatically.
4. Hot restart Flutter. Existing missing-key or unavailable-location cases display the unavailable state.

## Verification

If the panel shows `Weather unavailable`, run `npm run weather:check` from `gateway` (or add `-- --imei=<15 digits>`). This read-only command reports each stored location's source and actual age, the selected location and rejection reason, plus the gateway's current weather record. It prints only whether a weather key is configured, never its value. The command's environment and selection belong to the current checkout; restart the gateway after code changes to apply them to the running service.

An unavailable record with `location_stale_or_undated` means the weather service ran but rejected its selected location; it does not establish an API-key or provider failure. A dated location between one and 24 hours old may now support clearly labelled last-known-area weather. If every recorded location is at least 24 hours old or undated, fresh check-ins alone do not restore weather availability. A stored record can reflect the prior one-hour policy until the updated gateway restarts.

Automated coverage includes separate one-hour weather and 24-hour location expiry, last-known-area selection and labelling, missing and future timestamps, condition mapping, wind conversion, request failures/timeouts, cache coalescing, failed-write retries, linked/unlinked authorization, denied client writes, profile switching, local expiry and removal of the header shortcut while preserving the other actions.

The dashboard UI workflow renders synthetic desktop, mobile, dark, night, unavailable and 320px enlarged-text previews from the production widgets. Field QA should confirm a named area appears for Jesh, observe updates after a genuine location change, and verify expiry rather than treating a fresh heartbeat as a new position.
