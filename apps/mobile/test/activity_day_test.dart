import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';

void main() {
  test('accepted activity day parses customer-safe fields', () {
    final day = ActivityDay.fromMap({
      'localDate': '2026-08-23',
      'displayable': true,
      'reportedSteps': 4321,
      'lastObservedAt': DateTime.utc(2026, 8, 23, 10),
      'quality': 'partial',
    });
    expect(day.steps, 4321);
    expect(day.localDate, '2026-08-23');
    expect(day.isFresh(now: DateTime.utc(2026, 8, 23, 11)), true);
  });

  test('unverified raw counters fail closed', () {
    expect(
      () => ActivityDay.fromMap({
        'localDate': '2026-08-23',
        'displayable': false,
        'reportedSteps': null,
        'observedDeltaSteps': 300,
        'lastObservedAt': DateTime.utc(2026, 8, 23, 10),
      }),
      throwsFormatException,
    );
  });
}
