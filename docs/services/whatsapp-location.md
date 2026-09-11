# WhatsApp location replies

## Reported problem

An indoor location request received a definite statement that the wearer was
at a named road, plus a map pin. It gave no positioning source, uncertainty
radius or GPS recording age. The screenshot confirms misleading wording; it
does not establish whether that particular runtime fix came from Wi-Fi or LBS.

The ordinary WhatsApp location tool used a different selection rule from the
app map and SOS. Once the time between retained GPS and a network observation
exceeded 30 minutes, it selected the network coordinates. Generated replies
were not required to disclose that the result was approximate. Restarting the
gateway or replacing the Meta access token did not change either rule.

## Current behavior

| Available evidence | WhatsApp reply and map |
| --- | --- |
| Explicit private Home display pilot with a fresh validated router match and saved Home pin | Show **Home Wi-Fi detected — at or near Home**, its detection age, and one saved-Home map link. Keep the retained GPS age separate. Expired/revoked radio evidence or conflicting/uncertain fresh GPS returns to the rules below. V2 GPS at Home preserves the radio overlay without renewing its timestamp; legacy v1 keeps newer/equal-GPS precedence. See the shared Home/GPS contract in `wifi-home.md`. |
| GPS followed by Wi-Fi or cellular observations | Keep the GPS pin as **last known**, with its own recording time and age. State that the current position is unconfirmed. Describe the approximate observation separately, including its age and radius when available. |
| Latest observation is GPS | Show the latest recorded GPS fix. Fixes older than ten minutes, or without a recording time, are explicitly last known. |
| Wi-Fi or cellular estimate only | Label the location and map **approximate**, name the source and show its recording age and estimated radius when available. Do not claim a confirmed current position. |
| Coordinates with an unknown source or age | State what is unknown; never infer a GPS fix or fresh timestamp. |
| Missing, invalid, GPS-invalid or future-only coordinates | Say no usable recorded location is available and omit the map. Retain other valid prior evidence when available. |

The primary pin's place label, timestamp and accuracy all belong to the same
observation. A newer heartbeat or network estimate cannot refresh an older GPS
timestamp. Watch check-in and last-reported battery information have their own
ages. Replies contain one map link, corresponding to the selected location.

Ordinary location questions such as `location?` and `Where is Alex?` are rendered
directly from the authorized location tool result before any model call. The
existing registered-caller, linked-watch, Family/Care entitlement and wearer
selection checks still apply. Emergency-contact membership alone does not
grant location access. No watch command is sent by a location read.

The tool reuses the read-only selection calculation already tested against the
app and SOS. It creates no alert or persisted snapshot. The generic 30-minute
selector remains unchanged for its other consumers, including weather and
fall handling. Approved SOS templates and the incident delivery flow are
unchanged, as are journey generation and raw observations.

## Home Wi-Fi is a separate source of evidence

Wi-Fi geolocation estimates coordinates from visible access points. It is not
proof that the watch recognised an enrolled Home router. A network estimate
must not be relabelled `Home` because GPS is unavailable or because it is near
the saved Home pin.

At review on 7 September 2026, [PR #116](https://github.com/vikrav14/guardian/pull/116)
remains draft and unmerged. Near-router recognition passed for one V52/radio
pair; a separately opt-in private display pilot now implements the previously
specified “Home Wi-Fi detected — at or near Home” behavior. See
[the Home display setup and expiry contract](wifi-home.md#enable-the-private-home-display).
General customer activation and wider physical acceptance remain pending.
The display uses a saved pin and its own detection time, not an exact indoor
GPS fix. Loss of router evidence never creates a trip or departure, and this
ordinary reply overlay never changes accepted SOS template/snapshot selection.

## Verification and QA acceptance

Automated tests execute the real chat handler, caller resolution, plan gates,
wearer selection and location tool using synthetic data and no network sends.
They cover the reported indefinite-position wording, the 30-minute boundary,
two-hour and two-day GPS retention, Wi-Fi/LBS-only replies, missing and invalid
evidence, separate battery/check-in times, multiple linked wearers, restricted
callers and read/tool failures. Shared app/SOS selection fixtures are also
exercised through the WhatsApp tool data. No wearer identity, SIM, device ID or
actual home coordinates from the report are included in the fixtures.

The full gateway suite includes SOS, journey, weather and fall regressions.
Release gates also run Flutter analysis/tests/Web build and Firestore
authorization checks.

After pulling the branch, restart the gateway. Meta template approval is not
required for an ordinary text reply. The separate Home display pilot also
requires a Flutter restart/rebuild to load its new app model and map labels.

1. While indoors with retained GPS and a newer network estimate, ask
   `location?`. Confirm the reply names the GPS fix as last known, gives its
   own age and states that current position is unconfirmed.
2. Open its map. It must match the retained app GPS pin; the newer approximate
   reading must not provide a second, conflicting map link.
3. With a newly obtained valid outdoor GPS fix, ask again. Confirm the reply
   uses that new fix and recording time.
4. On a synthetic test device with no retained GPS, check Wi-Fi-only and
   cellular-only replies. Both must remain visibly approximate.

These physical WhatsApp checks remain pending until results are recorded.
