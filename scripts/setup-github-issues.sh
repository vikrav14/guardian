#!/usr/bin/env bash
# Sets up a feature-tracking system on GitHub Issues for Guardian.
# Run this from inside your cloned guardian repo, with `gh` installed and
# authenticated (`gh auth login` — same auth Claude Code would use).
#
# What this does:
#   1. Creates a label taxonomy (status + plan tier + area)
#   2. Creates one issue per feature from our inventory, pre-labeled
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

# ---- Core tracking ----
create_issue "Live GPS location on map" \
  "Show current pendant location on the map screen." \
  "status:built,tier:basic,area:tracking"

create_issue "Battery, speed, and location-source indicator" \
  "Show battery %, speed, and whether the fix is GPS/WiFi/LBS." \
  "status:built,tier:basic,area:tracking"

create_issue "Device online/offline status" \
  "Reflect whether the pendant is currently connected." \
  "status:built,tier:basic,area:tracking"

create_issue "Rename device" \
  "Let a user rename a pendant from the device detail sheet." \
  "status:built,tier:basic,area:tracking"

create_issue "Find device (ring pendant to locate)" \
  "Hardware supports FIND command (device rings for 1 minute). Wire up a button in the app." \
  "status:hardware-ready,tier:tbd,area:tracking"

create_issue "Step count / pedometer" \
  "Hardware reports steps in the LK heartbeat. Surface in app, decide which tier." \
  "status:hardware-ready,tier:tbd,area:tracking"

# ---- Safety & alerts ----
create_issue "Safe zones with enter/exit alerts" \
  "GPS-radius geofencing computed server-side (hardware only supports WiFi-MAC fencing natively). Engine built in alarm-handler.js." \
  "status:designed,tier:basic,area:safety"

create_issue "SOS button (device + WhatsApp dual path)" \
  "Device can auto-call/SMS a set number directly (SOS1/2/3). WhatsApp/app notification leg not wired yet." \
  "status:hardware-ready,tier:basic,area:safety"

create_issue "Fall detection with review card" \
  "Hardware fires raw fall alarm bit. Review-card logic (confidence score, call/false-alarm/notify actions) designed in alarm-handler.js." \
  "status:designed,tier:tbd,area:safety"

create_issue "Low battery alerts" \
  "Alert handler built; needs Firestore + notification wiring." \
  "status:designed,tier:basic,area:safety"

create_issue "Bracelet-removal alert" \
  "Hardware supports this alarm bit. Most relevant for the elderly/dementia segment — decide if it's care-tier only." \
  "status:hardware-ready,tier:tbd,area:safety"

create_issue "WiFi-based fence" \
  "Native to the device (up to 3 known WiFi networks), works indoors where GPS fails." \
  "status:hardware-ready,tier:tbd,area:safety"

# ---- AI layer ----
create_issue "AI WhatsApp assistant" \
  "Natural-language Q&A over device data via WhatsApp (e.g. 'where's Liana?')." \
  "status:designed,tier:tbd,area:ai"

create_issue "AI fall-verification confidence scoring" \
  "Uses the hardware's raw fall bit plus movement-since-impact as input to a confidence score." \
  "status:designed,tier:tbd,area:ai"

create_issue "AI wandering / routine-anomaly detection" \
  "Flag when someone deviates from their normal location pattern, before a hard geofence breach." \
  "status:concept,tier:tbd,area:ai"

create_issue "AI alert summarization / daily digest" \
  "Summarize a day's activity instead of firing raw pings for everything." \
  "status:concept,tier:tbd,area:ai"

# ---- Communication ----
create_issue "WhatsApp notifications for alerts/SOS" \
  "Send alert/SOS messages via WhatsApp Business API." \
  "status:concept,tier:basic,area:communication"

create_issue "Medication / pill reminders" \
  "Hardware can speak reminders aloud (TAKEPILLS command). Strong elderly-care-tier candidate." \
  "status:hardware-ready,tier:care,area:communication"

create_issue "Remote photo capture" \
  "Pendant camera can be triggered remotely (rcapture/img commands)." \
  "status:hardware-ready,tier:tbd,area:communication"

create_issue "Monitor callback" \
  "Pendant can auto-call a set number on command." \
  "status:hardware-ready,tier:tbd,area:communication"

create_issue "Ring/vibrate scene mode" \
  "Set the pendant's ring/vibrate profile remotely." \
  "status:hardware-ready,tier:tbd,area:communication"

# ---- Family / account ----
create_issue "Family circle (multiple people, one account)" \
  "UI designed (Account screen), backend not built." \
  "status:designed,tier:family,area:family"

create_issue "Family bundle pricing" \
  "Flat rate covering up to N members. Pricing modeled in the unit-economics spreadsheet." \
  "status:designed,tier:family,area:family"

create_issue "Family invites" \
  "Currently a UI placeholder only — no invite flow exists." \
  "status:concept,tier:family,area:family"

create_issue "Shared family map view" \
  "See every family member's location on one map at once." \
  "status:concept,tier:family,area:family"

# ---- Device admin ----
create_issue "Device provisioning via ICCID/IMEI" \
  "First-setup flow to register a new pendant against a user account." \
  "status:concept,tier:tbd,area:admin"

create_issue "Positioning interval configuration" \
  "Let support/admin change how often a device reports its location." \
  "status:hardware-ready,tier:tbd,area:admin"

create_issue "Remote power/restart/firmware version admin tools" \
  "Scheduled power on/off, remote restart, firmware version query — admin/support only." \
  "status:hardware-ready,tier:tbd,area:admin"

create_issue "Language & timezone setting" \
  "Hardware-supported per-device configuration." \
  "status:hardware-ready,tier:tbd,area:admin"

echo "Done. Run 'gh issue list' to see everything, or open the Issues tab on GitHub."
echo "Optional next step: gh project create --owner @me --title \"Guardian Roadmap\" to get a kanban board on top of these."
