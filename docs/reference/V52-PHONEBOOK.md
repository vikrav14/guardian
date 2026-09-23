# V52 phonebook: confirmed documentary capacity

Reviewed 23 September 2026 from the operator-supplied original PDFs. This
corrects the earlier description of 15 as merely a Guardian software guardrail.

## Capacity: 15 family numbers

The V52 user manual `v52(2).pdf`, PDF page 2, Settings → Phonebook, states:

> Phonebook: 15 family numbers can be set

The remainder of that sentence describes watch users making calls. Guardian's
current SIM still does not support wearer-originated calls; the capacity evidence
does not change that service limitation. The page also describes safe mode as
admitting SOS/phonebook callers. The datasheet lists Phonebook (Whitelist), but
provides no different numerical limit. No 12-contact limit was found in the
supplied V52 documents reviewed.

| Original | SHA-256 |
| --- | --- |
| `v52(2).pdf` | `0d2d4130ca97f7cf526de7412fb2591140ddf3c5c14d9db2153ca6a2b2e02590` |
| `2. V46-V48-V52 Communication Protocol(2).pdf` | `8f01881b9773f9ee762ceb2cc4dff9aa037abfa7a5540d6a723e1f4dd9161dbf` |
| `V52-DataSheet(3).pdf` | `503c0f4f8efebbb78893f28c654f29fcf7d7e3b6dbcc374b9ba54d8285a374fd` |

These originals remain in the supplied attachments, consistent with the reference
README. Their relevant pages were text-extracted and visually checked; the
capacity statement is in the fourth column of manual page 2.

## What capacity does and does not establish

The communication protocol, PDF page 5, section 14, defines a per-entry
`PHBX` command with a serial number, encoded name, number and picture. It says
entries are set one by one; its example uses serial 1. Guardian's existing
1–15 guard therefore agrees with the documented number of family contacts.

If fewer than 15 entries are stored, that suggests remaining capacity. It does
not identify the serial numbers occupied by an existing watch, nor prove a
particular serial is free. In these supplied documents there is no documented
phonebook occupancy/read-back command, append-to-free-entry operation, or
verified clear/delete sequence. Prior AnyTracking edits are not in Guardian's
managed inventory. Do not equate list position, an ACK, or capacity with a
verified free serial. Preserve the one-time inventory boundary for an existing
watch; customers do not choose slots in the app.

## Unified customer experience

Account and Watch settings now open one **Contacts** screen. Each person is
merged by canonical phone number and has separate **Receive safety alerts** and
**Call <wearer>** controls in the same card. Legacy notification contacts and
watch entries appear without re-entry or automatic permission changes.

The customer maintains one address book (`users.contactDirectory`). Existing
`emergencyContacts` remains a compatibility projection of notification-enabled
people for the current gateway. Phonebook receipt/reservations remain backend
owned and watch-specific. Those are implementation boundaries, not separate
customer lists. A combined save and optional call request commit atomically.

Turning alerts off retains the person and any watch access. Call additions wait
for the existing checked PHBX transport. Unknown receipt remains unknown;
editing/deleting an existing watch number is still unavailable. Auto-answer and
SOS settings are not changed by saving a contact.
