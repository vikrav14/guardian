import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/location/place_label.dart';
import 'package:guardian/models/device.dart';

void main() {
  test('old single-letter details fall back to the known area', () {
    for (final detail in ['B', 'C', 'B.', '123', '', '—']) {
      final location = DeviceLocation.fromMap({
        'lat': -20.0,
        'lng': 57.5,
        'placeLabel': 'Grand Baie · near $detail',
      });
      expect(location.displayPlaceLabel, 'Grand Baie');
      expect(weatherAreaLabel(location.placeLabel), 'Grand Baie');
    }
    expect(displayPlaceLabel(null), isNull);
    expect(displayPlaceLabel('B'), isNull);
    expect(displayPlaceLabel('  '), isNull);
  });

  test('complete Mauritius road codes and named places stay intact', () {
    for (final detail in ['B13', 'A4', 'M2', 'Sottise Road', 'Cœur de Ville']) {
      final label = 'Grand Baie · near $detail';
      expect(displayPlaceLabel(label), label);
      expect(weatherAreaLabel(label), 'Grand Baie');
    }
    expect(displayPlaceLabel('Grand-mère’s house'), 'Grand-mère’s house');
    expect(displayPlaceLabel('Grand Baie · near grand baie'), 'Grand Baie');
    expect(weatherAreaLabel('Near Grand Baie · near C'), 'Grand Baie');
    expect(weatherAreaLabel('Lower Vale'), 'Lower Vale');
  });
}
