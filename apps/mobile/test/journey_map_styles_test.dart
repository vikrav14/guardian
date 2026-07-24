import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_map_styles.dart';

void main() {
  group('journeyMapStyleForReplay', () {
    test('keeps daytime and evening journey replays on the same light map', () {
      final daytime = journeyMapStyleForReplay(
        DateTime(2026, 7, 24, 10),
      );
      final evening = journeyMapStyleForReplay(
        DateTime(2026, 7, 24, 20),
      );

      expect(daytime, same(JourneyMapStyles.light));
      expect(evening, same(JourneyMapStyles.light));
    });

    test('keeps the light map before replay starts', () {
      expect(
        journeyMapStyleForReplay(null),
        same(JourneyMapStyles.light),
      );
    });
  });
}
