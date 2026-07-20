#!/usr/bin/env bash
# Sets up a feature-tracking system on GitHub Issues for Guardian.
# Run this from inside your cloned guardian repo, with `gh` installed and
# authenticated (`gh auth login` — same auth Claude Code would use).
#
# This list is evidence-based: it comes from an audit of the actual code
# (mobile screens/services/models, gateway protocol/commands/notify/assistant,
# Firestore schema, docs) rather than a roadmap guess. It's split in two:
#   1. Feature backlog — every real, independently QA-testable product
#      feature, labeled by status/tier/area. Pure internal plumbing (frame
#      parsing, CRC checks, health endpoints, dev tooling, etc.) is
#      deliberately left out — it's not something QA tests directly.
#   2. Bugs — things the audit found that look built/working but aren't,
#      or behave inconsistently. Labeled type:bug, no tier.
#
# What this does:
#   1. Creates a label taxonomy (status + plan tier + area + type:bug)
#   2. Creates one issue per feature/bug, pre-labeled
#
# Safe to re-run — `gh label create --force` updates existing labels
# instead of failing, and issue creation is skipped if an issue with the
# same title already exists (open or closed).

set -e

echo "Creating labels..."

# Status labels — where the feature actually stands right now
gh label create "status:built"           --color 0F9D6C --force --description "Live and working"
gh label create "status:hardware-ready"  --color 378ADD --force --description "Pendant supports it, not wired into app/gateway yet"
gh label create "status:designed"        --color 9333EA --force --description "UI/logic designed, not built"
gh label create "status:concept"         --color 6B6A65 --force --description "Idea only, not designed"

# Plan tier — fill in / change these as you decide
gh label create "tier:basic"   --color FBBF24 --force --description "Every plan includes this"
gh label create "tier:family"  --color F97316 --force --description "Family bundle and above"
gh label create "tier:care"    --color EC4899 --force --description "Elderly-care tier candidate"
gh label create "tier:tbd"     --color E5E5E5 --force --description "Not yet assigned to a tier"

# Area — for filtering the backlog by part of the system
gh label create "area:tracking"      --color 60A5FA --force
gh label create "area:safety"        --color EF4444 --force
gh label create "area:ai"            --color A855F7 --force
gh label create "area:communication" --color 22C55E --force
gh label create "area:family"        --color F59E0B --force
gh label create "area:admin"         --color 9CA3AF --force

# Type — separate dimension for real defects found during the audit
gh label create "type:bug" --color D73A4A --force --description "Real defect found during feature audit, not a roadmap gap"

echo "Creating issues..."

issue_exists() {
  local title="$1"
  gh issue list --state all --search "\"$title\" in:title" --json title --jq '.[].title' 2>/dev/null \
    | grep -Fxq "$title"
}

create_issue() {
  local title="$1"
  local body="$2"
  local labels="$3"
  if issue_exists "$title"; then
    echo "  skip (already exists): $title"
    return 0
  fi
  gh issue create --title "$title" --body "$body" --label "$labels"
}

# =====================================================================
# FEATURE BACKLOG
# =====================================================================

# ---- Tracking ----
create_issue "Live GPS location on map" \
  "Show current pendant location on the map screen. Full pipeline: GT06 frame decode -> Firestore -> live map markers." \
  "status:built,tier:basic,area:tracking"

create_issue "Battery, speed, and location-source indicator" \
  "Show battery %, speed, and GPS-vs-LBS accuracy source on the map dashboard. Accuracy source is currently a coarse single-bit guess, not real multi-source positioning." \
  "status:built,tier:basic,area:tracking"

create_issue "Device online/offline status" \
  "Reflect whether the pendant is currently connected." \
  "status:built,tier:basic,area:tracking"

create_issue "Multi-device selector on map" \
  "Switch between linked pendants via a chip row on the map dashboard; tapping recenters the map." \
  "status:built,tier:basic,area:tracking"

create_issue "Rename device" \
  "Let a user rename a pendant from the device detail sheet." \
  "status:built,tier:basic,area:tracking"

create_issue "Call pendant directly from app" \
  "Tap-to-call the pendant's SIM number from the map dashboard (requires simNumber set in device settings)." \
  "status:built,tier:basic,area:tracking"

create_issue "Route history / day-by-day playback" \
  "Full UI exists for scrubbing through a day's location history, but the gateway only writes history when WRITE_LOCATION_HISTORY=true, which defaults to false — see the linked bug about empty history in production." \
  "status:built,tier:tbd,area:tracking"

create_issue "Device command: check pendant status" \
  "App can queue a 'check_status' command (SMS ts# to the device) via account settings; result surfacing back into the app UI hasn't been verified end-to-end." \
  "status:designed,tier:tbd,area:tracking"

create_issue "Improve GPS/LBS/WiFi positioning accuracy reporting" \
  "Accuracy source is decoded from a single status bit (gps vs lbs) with no real LBS cell-tower or WiFi-scan payload decoding — worth a real accuracy pipeline." \
  "status:hardware-ready,tier:tbd,area:tracking"

create_issue "Device provisioning via ICCID/IMEI (real onboarding)" \
  "No pairing flow exists today — every new account auto-links to one hardcoded demo IMEI. Needed before this can support real customers with their own pendants." \
  "status:concept,tier:tbd,area:tracking"

create_issue "Positioning interval configuration" \
  "No command builder exists for this in the gateway; would need to be built from the vendor's SMS command reference." \
  "status:concept,tier:tbd,area:tracking"

create_issue "Step count / pedometer" \
  "No evidence this pendant hardware/protocol reports steps at all. Verify against actual device firmware before committing to this — may not be feasible." \
  "status:concept,tier:tbd,area:tracking"

# ---- Safety ----
create_issue "Create/edit/delete safe zones" \
  "Radius-based safe zone creation with a map picker, pause/activate toggle, and delete (no undo/confirmation)." \
  "status:built,tier:basic,area:safety"

create_issue "Safe zone circle overlay on map" \
  "Render active safe zones as circles on the map dashboard." \
  "status:built,tier:basic,area:safety"

create_issue "Server-side GPS-radius enter/exit alerting" \
  "Haversine-based geofence evaluation with a cooldown to prevent alert flapping and first-sample seeding to avoid false alerts on reconnect." \
  "status:built,tier:basic,area:safety"

create_issue "Pendant-side (firmware) geofence enter/exit alarm" \
  "Distinct from the gateway's own lat/lng geofencing — this is the pendant's own configured geofence, reported as an alarm bit." \
  "status:designed,tier:tbd,area:safety"

create_issue "SOS alarm (physical device button)" \
  "Decode -> Firestore alert -> push -> SMS/WhatsApp pipeline is wired, but has zero direct test coverage." \
  "status:designed,tier:basic,area:safety"

create_issue "In-app manual SOS (Send help button)" \
  "Rides the same alert/notification pipeline as device-originated alarms." \
  "status:built,tier:basic,area:safety"

create_issue "Fall detection alarm" \
  "Alarm code itself is firmware-uncertain per the gateway's own code comments and is untested. No confidence-scoring or review-card UI exists — the alerts page just shows a plain danger-styled card. Elderly-care tier candidate." \
  "status:designed,tier:tbd,area:safety"

create_issue "Low battery alarm" \
  "Pushed to the app; excluded from SMS/WhatsApp by design." \
  "status:designed,tier:basic,area:safety"

create_issue "Surface currently-dead alarm codes (overspeed, movement, power-cut, antenna-cut, tamper/vibration)" \
  "All five are decoded by the protocol but bucketed as generic 'other' and excluded from every notification path — an alert record is created but nobody is ever told. Includes the closest existing signal to a 'removal' alert (tamper/vibration), which currently goes nowhere." \
  "status:hardware-ready,tier:tbd,area:safety"

create_issue "Alerts feed (list, severity, resolve)" \
  "Browse alerts with severity styling and mark resolved." \
  "status:built,tier:basic,area:safety"

create_issue "Emergency contacts management" \
  "Add/remove contacts with an optional WhatsApp field; no edit-in-place." \
  "status:built,tier:basic,area:safety"

create_issue "Mauritius emergency numbers quick-dial" \
  "Hardcoded Police/SAMU/Fire numbers with localized labels. Not configurable for other regions." \
  "status:built,tier:basic,area:safety"

create_issue "Voice monitoring (silent listen-in)" \
  "Built and tested, but the SMS command syntax is only documented for a related hardware model (RF-V28), not confirmed against this pendant's actual firmware (V28C) — verify on real hardware. Also worth a privacy/consent review: this enables silent audio monitoring with no on-device consent indicator." \
  "status:hardware-ready,tier:tbd,area:safety"

create_issue "Ring-to-find pendant" \
  "Same unverified-against-real-hardware caveat as voice monitoring." \
  "status:hardware-ready,tier:tbd,area:safety"

create_issue "Set SOS speed-dial number(s)" \
  "Gateway supports 3 SOS number slots; the app UI only exposes slot 1." \
  "status:designed,tier:tbd,area:safety"

create_issue "Remote photo capture" \
  "Deliberately unbuilt — the gateway's own code comments say the capture command syntax couldn't be found documented anywhere." \
  "status:concept,tier:tbd,area:safety"

create_issue "Medication / pill reminders" \
  "Roadmap mention only (text-to-speech to pendant speaker) — no command, scheduling, or UI exists yet. Strong elderly-care-tier candidate if built." \
  "status:concept,tier:care,area:safety"

create_issue "Bracelet/pendant-removal detection" \
  "No dedicated alarm exists today. Would likely need to be built on top of the currently-unused tamper/vibration alarm bit." \
  "status:concept,tier:tbd,area:safety"

# ---- AI ----
create_issue "AI WhatsApp assistant (Claude-powered Q&A)" \
  "Natural-language Q&A over live device data via WhatsApp." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant: list devices" \
  "Tool the assistant uses to enumerate a guardian's linked pendants." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant: get last known location" \
  "Includes a Google Maps link in the response." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant: get battery level" \
  "Tool the assistant uses to answer battery-status questions." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant: get recent alerts" \
  "Falls back to an in-memory filter if the Firestore composite index is missing." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant caller-identity resolution (WhatsApp number to guardian account)" \
  "Unregistered numbers get told to ask their guardian to add them as a contact." \
  "status:built,tier:tbd,area:ai"

create_issue "Assistant offline fallback (no API key configured)" \
  "Still answers with a simple non-LLM Firestore status line for local testing." \
  "status:built,tier:tbd,area:ai"

create_issue "AI fall-verification confidence scoring" \
  "Roadmap text only. No accelerometer-sequence data is even decoded by the protocol yet — this needs hardware-layer work before it's an AI problem." \
  "status:concept,tier:tbd,area:ai"

create_issue "AI wandering / routine-anomaly detection" \
  "Flag when someone deviates from their normal location pattern, before a hard geofence breach. Roadmap text only, no code." \
  "status:concept,tier:tbd,area:ai"

create_issue "AI alert summarization / daily digest" \
  "No evidence anywhere in code or docs, including the roadmap notes — may be pure speculation. Verify intent before prioritizing." \
  "status:concept,tier:tbd,area:ai"

# ---- Communication ----
create_issue "WhatsApp notifications for alerts/SOS" \
  "Twilio-based outbound send exists and is config-gated; degrades to a logged skip (not a failure) if Twilio WhatsApp isn't configured — the app's account screen already discloses this to users. No test coverage of the actual Twilio send call." \
  "status:designed,tier:basic,area:communication"

create_issue "SMS notifications for alerts" \
  "Same untested/config-gated profile as WhatsApp notifications." \
  "status:designed,tier:basic,area:communication"

create_issue "Push notifications to guardian app (FCM)" \
  "Delivers alert pushes to all of a device's registered guardians." \
  "status:designed,tier:basic,area:communication"

create_issue "Push notification registration on sign-in" \
  "Mobile app registers its FCM token on sign-in and unregisters on sign-out." \
  "status:built,tier:basic,area:communication"

create_issue "Alert-type-specific push titles" \
  "Distinct push titles per alarm type (SOS, fall, geofence enter/exit, low battery)." \
  "status:built,tier:basic,area:communication"

create_issue "Per-channel notification toggles (SMS/WhatsApp on/off)" \
  "Gateway-level config flags to enable/disable each outbound channel." \
  "status:built,tier:tbd,area:communication"

# ---- Family ----
create_issue "Family circle via invite codes" \
  "6-character invite code, expires after 7 days." \
  "status:built,tier:family,area:family"

create_issue "Family member / pending invite list" \
  "See linked family members and outstanding invites on the account screen." \
  "status:built,tier:family,area:family"

create_issue "Shared family map view" \
  "Byproduct of invite-based device linking — every linked device shows up on every linked guardian's map. Batched at 30 devices per query (Firestore whereIn cap), silently drops beyond that." \
  "status:built,tier:family,area:family"

create_issue "Family bundle pricing" \
  "No 'family bundle' exists in code today — only a single flat per-account subscription tier field, purely for display, with no payment provider wired up." \
  "status:concept,tier:family,area:family"

create_issue "Paid subscription / billing" \
  "A subscription tier field exists in Firestore but is never written by any code path — there's no real purchase flow. Needed before any tier gating can be enforced." \
  "status:concept,tier:tbd,area:family"

# ---- Admin ----
create_issue "Email/password sign-in" \
  "Firebase Auth sign-in with friendly error-code mapping." \
  "status:built,tier:basic,area:admin"

create_issue "Email/password registration" \
  "No email verification step." \
  "status:built,tier:basic,area:admin"

create_issue "Password reset (forgot password)" \
  "No reset flow exists anywhere in the app." \
  "status:concept,tier:basic,area:admin"

create_issue "Account deletion" \
  "No delete-account UI or backend call exists." \
  "status:concept,tier:tbd,area:admin"

create_issue "Sign out (with push token cleanup)" \
  "Unregisters the FCM token before signing out of Firebase." \
  "status:built,tier:basic,area:admin"

create_issue "Language switcher (English / French / Kreol Morisien)" \
  "Persisted locale choice. Only ~21 strings are actually localized today (nav labels, emergency contacts, a few settings) — see the linked bug about incomplete translation coverage." \
  "status:built,tier:basic,area:admin"

create_issue "Bottom navigation (Map / Safe zones / Alerts / Account)" \
  "Four-tab shell; all tabs stay mounted across switches." \
  "status:built,tier:basic,area:admin"

create_issue "Role-based access control (guardian vs admin)" \
  "A 'role' field is defined in the Firestore schema but nothing in the app or gateway reads or branches on it — no admin-only surface exists despite the schema implying one." \
  "status:concept,tier:tbd,area:admin"

# =====================================================================
# BUGS — found during the feature audit, not roadmap gaps
# =====================================================================

create_issue "WiFi safe-zone matching never receives real device data" \
  "Users can type a WiFi SSID into a safe zone, but the gateway's real GT06/V28C decoder never populates the location's WiFi SSID field (undocumented byte layout for this hardware). The matching logic is fully built and unit-tested against a synthetic field, but is structurally dead in production — the UI gives a false impression this works." \
  "type:bug,area:safety"

create_issue "Route history playback is empty in production by default" \
  "The route history screen is fully built, but the gateway only writes location history when WRITE_LOCATION_HISTORY=true, which defaults to false. Users opening this screen see nothing and may assume it's broken." \
  "type:bug,area:tracking"

create_issue "Family invite relationship is one-directional" \
  "Accepting a family invite links the acceptor to the inviter's device(s), but the inviter's own family-member view doesn't appear to reflect the acceptor back. Verify intended behavior — likely an asymmetric-data-model bug." \
  "type:bug,area:family"

create_issue "Geofence alarm delivery is inconsistent across channels" \
  "geofence_enter reaches the app via push but is excluded from SMS/WhatsApp delivery, while geofence_exit is included in both. Confirm whether this asymmetry is intentional." \
  "type:bug,area:safety"

create_issue "Voice monitoring and ring-to-find use unverified SMS syntax" \
  "Both commands' SMS syntax is only documented for a related hardware model (RF-V28), not confirmed against the actual pendant model in use (V28C), per the gateway's own code comments. Could silently fail or do nothing on real hardware — needs verification before being relied on." \
  "type:bug,area:safety"

create_issue "Language switcher implies full translation but most UI stays English" \
  "Selecting French or Kreol Morisien only translates ~21 strings; safe zones, alerts, device settings, and family invites remain hardcoded English regardless of the selected language." \
  "type:bug,area:admin"

create_issue "'My location' overlay fails silently on permission denial" \
  "If location permission is denied, the map's 'my location' overlay fails silently with no user-facing error or retry prompt." \
  "type:bug,area:tracking"

echo "Done. Run 'gh issue list' to see everything, or open the Issues tab on GitHub."
echo "Optional next step: gh project create --owner @me --title \"Guardian Roadmap\" to get a kanban board on top of these."
