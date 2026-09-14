import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_utils.dart';
import 'package:guardian/journey/journey_v2_data.dart';

// Synthetic coordinates; no pilot location or device identifiers.
// Includes a negative starting latitude and negative deltas on both axes.
const _walkPolyline = r'narzB_n}}IIY`AfAHfB';
const _gpsEvidence = [
  JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
  JourneyPointEvidence(offsetMs: 12000, source: 'gps', gpsValid: true),
  JourneyPointEvidence(offsetMs: 84000, source: 'gps', gpsValid: true),
  JourneyPointEvidence(offsetMs: 138000, source: 'gps', gpsValid: true),
];

JourneyRecord _walk({
  List<JourneyPointEvidence> evidence = _gpsEvidence,
}) {
  final start = DateTime.utc(2026, 9, 14, 9);
  return JourneyRecord(
    id: 'synthetic-short-walk',
    startAt: start,
    endAt: start.add(const Duration(seconds: 138)),
    polyline: _walkPolyline,
    distanceKm: 0.122,
    pointCount: 4,
    evidenceVersion: 3,
    pointEvidence: evidence,
    closeReason: 'home_wifi_detected',
    originGeofenceName: 'Home',
    routeStartAnchored: false,
  );
}

void main() {
  test('negative latitude and route deltas decode consistently on web', () {
    final decoded = decodePolyline(_walkPolyline);
    const expected = [
      (lat: -20.25, lng: 57.5),
      (lat: -20.24995, lng: 57.50013),
      (lat: -20.25028, lng: 57.49977),
      (lat: -20.25033, lng: 57.49925),
    ];
    expect(decoded, hasLength(expected.length));
    for (var i = 0; i < expected.length; i++) {
      expect(decoded[i].lat, closeTo(expected[i].lat, 0.0000001));
      expect(decoded[i].lng, closeTo(expected[i].lng, 0.0000001));
      expect(isPlausibleCoord(decoded[i].lat, decoded[i].lng), isTrue);
    }
  });

  test('canonical route retains negative longitudes on web', () {
    final decoded = decodePolyline(r'_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    const expected = [
      (lat: 38.5, lng: -120.2),
      (lat: 40.7, lng: -120.95),
      (lat: 43.252, lng: -126.453),
    ];
    expect(decoded, hasLength(expected.length));
    for (var i = 0; i < expected.length; i++) {
      expect(decoded[i].lat, closeTo(expected[i].lat, 0.0000001));
      expect(decoded[i].lng, closeTo(expected[i].lng, 0.0000001));
    }
  });

  test('short GPS walk closed by Home remains visible without a route anchor', () {
    final record = _walk();
    expect(record.hasAuthoritativeEvidence, isTrue);
    expect(record.hasConfirmedReturn, isFalse);
    expect(journeyV2RecordedDistanceKm(record), closeTo(0.122, 0.001));
    expect(journeyV2MeaningfulRecords([record]), [record]);
    expect(journeyV2SelectRecord([record]), same(record));
  });

  test('decoding fix does not turn network estimates into a confirmed trip', () {
    final record = _walk(
      evidence: const [
        JourneyPointEvidence(offsetMs: 0, source: 'wifi', gpsValid: false),
        JourneyPointEvidence(offsetMs: 12000, source: 'wifi', gpsValid: false),
        JourneyPointEvidence(offsetMs: 84000, source: 'lbs', gpsValid: false),
        JourneyPointEvidence(offsetMs: 138000, source: 'wifi', gpsValid: false),
      ],
    );
    expect(record.hasAuthoritativeEvidence, isFalse);
    expect(journeyV2RecordedDistanceKm(record), 0);
    expect(journeyV2MeaningfulRecords([record]), isEmpty);
  });
}
