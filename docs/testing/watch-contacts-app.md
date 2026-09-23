# Contacts: unified management and second-caller acceptance

2026-09-23. PR #115 remains draft. The Calls Auto/Manual pilot already passed on
Jesh; caller-number exclusivity and SOS/fall automation are not established.

## Delivered change

Account and Watch settings → **Contacts** open one address book. Existing
notification and watch entries merge by canonical phone number. Each person has
**Receive safety alerts** and **Call <wearer>** controls on one card. New contacts
are entered once. Saving both choices writes the directory, notification
projection and optional call request atomically; it grants no Auto-answer or SOS
setting. Turning alerts off retains the contact and any existing watch access.
Only the designated linked manager can request a watch addition.

The V52 manual documents **15 family numbers** (page 2). See the
[verified source note](../reference/V52-PHONEBOOK.md). That is capacity evidence,
not a query of occupied serial numbers on Jesh.

This uses the existing physically exercised PHBX add builder (UTF-16BE name,
E.164 phone, empty picture field). A single freshly identified connection must
answer VERNO before the gateway writes PHBX, and its bare PHBX reply proves
receipt only. Check the actual phonebook and call. The socket selector, exclusion
and reply observer are shared with Calls; transactional leases prevent those two
services changing the watch simultaneously across gateway processes.

No replacement or deletion is implemented. No invented safe-mode switch, SMS
fallback, broad caller permission, or emergency auto-answer trigger is added.
The pilot is available only after an operator records the physical inventory.

## One-time setup for an existing watch

For contacts previously saved in AnyTracking, the
[reference recorder procedure](phonebook-reference-capture.md) can identify the
serial of a specific entry by observing its save. It does not enumerate empty
slots; a newly added captured entry is occupied.

1. Update to `feat/v52-watch-modes`, retaining unrelated local files. Deploy the
   repository Firestore rules and indexes, restart the gateway, and restart the
   Flutter app. No ngrok or watch server-route change is needed.
2. Review the watch's existing contacts, including entries previously added by
   AnyTracking or admin commands. Establish the actual slot mapping from prior
   provisioning evidence. Do not assume displayed list position equals slot ID.
   Do not infer slot 2 or 15 is empty. If slot mapping is unknown, stop setup and
   inspect provisioning evidence; this implementation cannot safely discover or
   clear the watch phonebook.
3. Prepare a **private local** inventory JSON. Include every known existing
   contact and only independently verified empty slots. Unlisted slots remain
   unavailable. Confirm the manager UID is the linked guardian's Firebase UID.
   Schema (synthetic example only; these are NOT Jesh's slots or identity):

   ```json
   {
     "imei": "861397000000000",
     "managerUid": "synthetic-owner",
     "inventoryConfirmed": true,
     "emptySlots": [2],
     "contacts": [{"slot": 1, "name": "Existing", "phone": "+23050000000"}]
   }
   ```

4. In PowerShell, from `gateway`, preview then import that verified file:

   ```powershell
   $guardianInventory = Read-Host 'Full path to your verified private inventory JSON'
   node scripts/configure-watch-phonebook.js --inventory-file $guardianInventory
   node scripts/configure-watch-phonebook.js --inventory-file $guardianInventory --apply
   ```

   Setup writes backend records only; it sends no command to the watch. A
   configured inventory cannot be reset with this script. The legacy admin
   phonebook endpoint is then blocked for this watch so it cannot overwrite
   entries managed by the app. It now requires a full IMEI and Firestore even
   for unmanaged watches. Do not edit managed slots through another app.

Deployment from the repository root (rules/indexes are required for this UI):

```powershell
git pull --ff-only origin feat/v52-watch-modes
firebase deploy --only firestore:rules,firestore:indexes --project guardian-fbadd
```

Wait for index creation to finish. Stop/start the gateway and Flutter processes
in their existing terminals; their old process will not gain the new watcher.

## Real-device acceptance still required

1. Restore **Manual** using Calls. Wait for the watch reply and establish a
   baseline call from the original approved number.
2. In Contacts, add the second phone once with its actual outgoing caller-ID
   number in international format. Select **Call <wearer>**; choose **Receive
   safety alerts** only if desired, then **Save and send to watch**. Wait for **Watch replied**. Check the entry
   on the watch. If the entry is absent, retain evidence; do not blindly retry.
3. Call from the second phone. It should ring and wait for wearer acceptance;
   answer and check audio both ways. Record result/time. If blocked, investigate
   caller-ID formatting and safe-mode behavior, without changing Auto yet.
4. Set Auto in Calls for the existing configured original guardian. Call from
   that original phone, then from the second approved phone. Record separately
   whether each auto-answers, keeps ringing, or is blocked, plus audio results.
5. Restore Manual and repeat both calls. Finish with physical Manual acceptance.

Only step 4 establishes whether this firmware scopes ACALL to its supplied
number. Do not label it guardian-only or SOS-only before that test. Do not make
real SOS/fall events or send Meta messages for this contact test.

## Delivery and recovery

Requests expire within 90 seconds (app requests 60). Offline writes cannot
become fresh commands upon reconnect. Backend-only slots are reserved in a
transaction before transport. Concurrent/double requests cannot allocate the
same slot. A duplicate canonical phone cannot consume another slot.

A proven pre-write failure allows an explicit retry of the same unchanged
contact in its reserved slot. Missing replies, ambiguous writes, and crashes
retain reservations permanently pending operator review. They are never replayed
on restart or silently released for another person. Receipt never becomes
`appliedStateVerified: true`. Removing or replacing a number remains unavailable.

Private numbers/names stay in linked-device records; command payloads, frame hex
and names/numbers are excluded from transport/audit logs. Manager authority,
protocol identity and free slots are backend-only. Generic `deviceCommands`
cannot set phonebook contacts.

Automated coverage: backend identity/manager validation, immutable short-lived
requests, merged existing contacts, independent permission changes, atomic saves, concurrency/duplicate/reservation behavior, crash uncertainty,
existing Calls regression, same-socket PHBX receipt, rules emulator transactions,
and Flutter request flow/status/accessibility widths. No physical phonebook or
second-caller outcome is claimed by those tests. This file is also the repository
QA handoff; the GitHub Wiki cannot be published with the available connector.
