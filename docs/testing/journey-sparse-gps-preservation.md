# Sparse GPS journey preservation

Ten-minute satellite reports on a motorway can be more than 5 km apart. The old
journey builder and history recovery treated that distance as an impossible jump,
while the five-minute Home anchor window also removed the departure observation.
An outing recorded on 8 October 2026 consequently retained 94 of 97 GPS points,
starting at 11:13 instead of the first observation near Home at 10:46.

## Change

- Timestamped GPS hops are checked against elapsed observation time and the
  existing recovery speed ceiling of 250 km/h. Untimed and approximate sources
  retain the 5 km guard; they cannot relax it using stale packet speeds.
- The last confirmed Home GPS observation can anchor a departure for up to an
  hour. Intervals over five minutes remain explicit tracking gaps, and their
  unobserved distance is excluded. The first outside observation retains its own
  departure timestamp.
- A route consisting entirely of sparse observations is retained even when its
  connected-distance total is zero. This is not a claim of zero actual travel.
- Delayed recovery uses retained context from the affected Mauritius calendar
  days, rather than a five-minute neighborhood around the delayed reports.
- Repair merges into the existing journey, validates timestamps and plausible
  hops, invalidates its old presentation, and remains idempotent. Confirmed outing
  boundaries still require review before extending them.

## Verification

The gateway suite passes 1,779 tests on the main-based fix branch and 1,850 tests
on the existing live integration checkout. New regression cases cover ten-minute
motorway observations, a sparse Home anchor, entirely sparse journeys, impossible
jumps, approximate-source isolation, repair of a partial saved trip, and delayed
recovery of earlier processed points. Existing cases cover restart recovery,
failed-write retry, duplicate suppression, Home priority and alarm separation.

Private replay of the 97 timestamped GPS observations reconstructs a single trip
from 10:46:46 to 14:14:13 Mauritius time, retaining all 97 points and eight marked
GPS gaps. Private coordinates and credentials are not included in this repository.

## Remaining operational requirements

The existing gateway fsyncs valid GPS evidence into its local journal before
acknowledging the watch, retains processed evidence for seven days, and retries
pending journey writes. This protects received reports against process restarts
and transient remote write failures; it is not an off-machine backup.

An asleep, offline or powered-off laptop cannot receive watch traffic. Buffered
uploads recovered some observations in this outing, but watch retention has not
been verified as complete. Continuous service requires an always-on host with
persistent storage and backups; no new hosting service or paid plan is enabled
by this code change. More frequent reporting changes sampling density and battery
use, and is not a substitute for preserving every valid received observation.
