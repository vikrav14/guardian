import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_map_styles.dart';

void main() {
  group('isEveningOrNight', () {
    test('is true between 17:00 and 06:00', () {
      expect(isEveningOrNight(DateTime(2026, 7, 22, 18, 0)), isTrue);
      expect(isEveningOrNight(DateTime(2026, 7, 22, 3, 0)), isTrue);
    });

    test('is false during daytime hours', () {
      expect(isEveningOrNight(DateTime(2026, 7, 22, 10, 0)), isFalse);
      expect(isEveningOrNight(DateTime(2026, 7, 22, 16, 59)), isFalse);
    });
  });
}
