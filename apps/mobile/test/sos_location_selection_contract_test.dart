import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:guardian/models/device.dart';

// These exact fixtures are also run by gateway/test/sos-location-snapshot.test.js.
// They keep SOS primary-pin selection aligned with the actual map model.
void main() {
  final fixtures = jsonDecode(
    File('../../docs/testing/sos-location-selection.json').readAsStringSync(),
  ) as List<dynamic>;

  DeviceLocation? location(dynamic raw) => raw is Map
      ? DeviceLocation.fromMap(Map<String, dynamic>.from(raw))
      : null;

  for (final raw in fixtures) {
    final fixture = Map<String, dynamic>.from(raw as Map);
    test('app/SOS primary pin: ${fixture['name']}', () {
      final evidence = Map<String, dynamic>.from(fixture['device'] as Map);
      final device = Device(
        imei: 'fixture-watch',
        online: true,
        accuracySource: evidence['accuracySource'] as String?,
        location: location(evidence['location']),
        lastLocationObservation: location(evidence['lastLocationObservation']),
        lastSatelliteLocation: location(evidence['lastSatelliteLocation']),
      );
      final expected = (fixture['expected'] as Map)['location'];
      final selected = device.mapDisplayLocation;
      if (expected == null) {
        expect(selected, isNull);
      } else {
        expect(selected, isNotNull);
        final point = selected!;
        final target = Map<String, dynamic>.from(expected as Map);
        expect(point.lat, target['lat']);
        expect(point.lng, target['lng']);
      }
    });
  }
}
