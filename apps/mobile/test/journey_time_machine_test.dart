import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_time_machine.dart';

void main() {
  group('buildTimeMachineOptions', () {
    test('includes today and yesterday when data exists', () {
      final now = DateTime(2026, 7, 22, 12);
      final today = DateTime(2026, 7, 22);
      final yesterday = DateTime(2026, 7, 21);

      final options = buildTimeMachineOptions(
        selectedDay: today,
        daysWithData: {today, yesterday},
        referenceNow: now,
      );

      expect(options.any((o) => o.label == 'Today'), isTrue);
      expect(options.any((o) => o.label == 'Yesterday'), isTrue);
    });

    test('includes last weekend memory', () {
      final now = DateTime(2026, 7, 22); // Wednesday
      final lastSat = DateTime(2026, 7, 19);

      final options = buildTimeMachineOptions(
        selectedDay: now,
        daysWithData: {now, lastSat},
        referenceNow: now,
      );

      expect(options.any((o) => o.label == 'Last Weekend'), isTrue);
    });
  });
}
