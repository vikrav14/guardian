import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/models/location_history_point.dart';

void main() {
  JourneyRecord record({
    required String id,
    required DateTime start,
    required DateTime end,
    required String polyline,
    required double km,
    required int pointCount,
  }) {
    final evidence = <JourneyPointEvidence>[
      for (var index = 0; index < pointCount; index++)
        JourneyPointEvidence(
          offsetMs: pointCount <= 1
              ? 0
              : (end.difference(start).inMilliseconds * index) ~/
                    (pointCount - 1),
          source: 'gps',
          gpsValid: true,
        ),
    ];
    return JourneyRecord(
      id: id,
      startAt: start,
      endAt: end,
      polyline: polyline,
      distanceKm: km,
      pointCount: pointCount,
      evidenceVersion: 3,
      pointEvidence: evidence,
    );
  }

  group('Journey V2 record selection', () {
    test('defaults to latest meaningful journey', () {
      final base = DateTime(2026, 8, 10, 8);
      final journeys = [
        record(
          id: 'tiny',
          start: base,
          end: base.add(const Duration(minutes: 2)),
          polyline: '',
          km: 0,
          pointCount: 0,
        ),
        record(
          id: 'first-real',
          start: base.add(const Duration(hours: 1)),
          end: base.add(const Duration(hours: 1, minutes: 20)),
          polyline: '',
          km: 2.1,
          pointCount: 3,
        ),
        record(
          id: 'latest-real',
          start: base.add(const Duration(hours: 2)),
          end: base.add(const Duration(hours: 2, minutes: 45)),
          polyline: '',
          km: 21.9,
          pointCount: 28,
        ),
      ];

      expect(journeyV2SelectRecord(journeys)?.id, 'latest-real');
      expect(
        journeyV2SelectRecord(journeys, selectedId: 'first-real')?.id,
        'first-real',
      );
    });

    test('excludes legacy records that cannot prove their boundary events', () {
      final start = DateTime(2026, 8, 17, 12, 10);
      final ghost = JourneyRecord(
        id: 'legacy-wifi-ghost',
        startAt: start,
        endAt: start.add(const Duration(minutes: 3, seconds: 58)),
        polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceKm: 2.1,
        pointCount: 11,
      );

      expect(journeyV2MeaningfulRecords([ghost]), isEmpty);
      expect(journeyV2SelectRecord([ghost]), isNull);
    });

    test('keeps a confirmed outing even when a tracking gap leaves zero connected distance', () {
      final start = DateTime(2026, 8, 17, 12, 10);
      final outing = JourneyRecord(
        id: 'confirmed-sparse-outing',
        startAt: start,
        endAt: start.add(const Duration(minutes: 30)),
        polyline: r'f{`zBcmz~I}|XvfI',
        distanceKm: 0,
        pointCount: 2,
        closeReason: 'return_to_origin',
        originGeofenceName: 'Home',
        departureAt: start.add(const Duration(minutes: 1)),
        returnAt: start.add(const Duration(minutes: 30)),
        evidenceVersion: 3,
        routeStartAnchored: true,
        pointEvidence: const [
          JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
          JourneyPointEvidence(
            offsetMs: 30 * 60 * 1000,
            source: 'gps',
            gpsValid: true,
          ),
        ],
      );

      expect(journeyV2MeaningfulRecords([outing]), hasLength(1));
      expect(journeyV2SelectRecord([outing])?.id, outing.id);
    });

    test('excludes a confirmed outing whose stored route starts outside Home', () {
      final start = DateTime(2026, 8, 17, 15, 30);
      final outsideStart = JourneyRecord(
        id: 'outside-start',
        startAt: start,
        endAt: start.add(const Duration(minutes: 3)),
        polyline: r'f{`zBcmz~I}|XvfI',
        distanceKm: 1.2,
        pointCount: 2,
        closeReason: 'return_to_origin',
        originGeofenceName: 'Home',
        evidenceVersion: 3,
        routeStartAnchored: false,
        pointEvidence: const [
          JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
          JourneyPointEvidence(
            offsetMs: 3 * 60 * 1000,
            source: 'gps',
            gpsValid: true,
          ),
        ],
      );

      expect(journeyV2MeaningfulRecords([outsideStart]), isEmpty);
    });
  });

  group('Journey V2 polyline decoding', () {
    test('decodes the canonical Google sample exactly', () {
      final start = DateTime(2026, 8, 10, 12);
      final end = start.add(const Duration(minutes: 20));
      final journey = record(
        id: 'sample',
        start: start,
        end: end,
        polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        km: 0,
        pointCount: 3,
      );

      final route = journeyV2DecodeRecord(journey);

      expect(route.rawPoints, hasLength(3));
      expect(route.usablePoints, hasLength(3));
      expect(route.matchesStoredPointCount, isTrue);
      expect(route.hasReplayableRoute, isTrue);

      expect(route.rawPoints[0].lat, closeTo(38.5, 0.000001));
      expect(route.rawPoints[0].lng, closeTo(-120.2, 0.000001));
      expect(route.rawPoints[1].lat, closeTo(40.7, 0.000001));
      expect(route.rawPoints[1].lng, closeTo(-120.95, 0.000001));
      expect(route.rawPoints[2].lat, closeTo(43.252, 0.000001));
      expect(route.rawPoints[2].lng, closeTo(-126.453, 0.000001));

      expect(route.rawPoints.first.recordedAt, start);
      expect(
        route.rawPoints[1].recordedAt,
        start.add(const Duration(minutes: 10)),
      );
      expect(route.rawPoints.last.recordedAt, end);
    });

    test('preserves a 28-point Mauritius route without collapsing it', () {
      final coords = <({double lat, double lng})>[
        for (var index = 0; index < 28; index++)
          (lat: -20.16196 + (index * 0.0048), lng: 57.64834 - (index * 0.0019)),
      ];

      final encoded = _encodePolyline(coords);
      final start = DateTime(2026, 8, 10, 12, 50, 4);
      final end = DateTime(2026, 8, 10, 13, 35, 44);

      final journey = record(
        id: 'mauritius-28',
        start: start,
        end: end,
        polyline: encoded,
        km: 21.918,
        pointCount: 28,
      );

      final route = journeyV2DecodeRecord(journey);

      expect(route.decodedPointCount, 28);
      expect(route.usablePointCount, 28);
      expect(route.matchesStoredPointCount, isTrue);
      expect(route.hasReplayableRoute, isTrue);
      expect(route.rawPoints.first.recordedAt, start);
      expect(route.rawPoints.last.recordedAt, end);
    });

    test('uses stored point timing and provenance instead of inventing equal intervals', () {
      final start = DateTime(2026, 8, 17, 12, 10);
      final journey = JourneyRecord(
        id: 'truth-v2',
        startAt: start,
        endAt: start.add(const Duration(minutes: 30)),
        polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceKm: 2.1,
        pointCount: 3,
        evidenceVersion: 2,
        pointEvidence: const [
          JourneyPointEvidence(
            offsetMs: 0,
            source: 'gps',
            gpsValid: true,
            satellites: 10,
          ),
          JourneyPointEvidence(
            offsetMs: 60 * 1000,
            source: 'gps',
            gpsValid: true,
            satellites: 8,
          ),
          JourneyPointEvidence(
            offsetMs: 28 * 60 * 1000,
            source: 'gps',
            gpsValid: true,
            satellites: 6,
          ),
        ],
      );

      final route = journeyV2DecodeRecord(journey);

      expect(route.rawPoints[0].recordedAt, start);
      expect(
        route.rawPoints[1].recordedAt,
        start.add(const Duration(minutes: 1)),
      );
      expect(
        route.rawPoints[2].recordedAt,
        start.add(const Duration(minutes: 28)),
      );
      expect(route.rawPoints[0].accuracySource, 'gps');
      expect(route.rawPoints[0].gpsValid, isTrue);
      expect(route.rawPoints[0].satellites, 10);
      expect(route.continuousSegments, hasLength(2));
      expect(route.continuousSegments.first, hasLength(2));
      expect(route.continuousSegments.last, hasLength(1));
    });

    test('empty polyline remains safely empty', () {
      final start = DateTime(2026, 8, 10, 12);
      final journey = record(
        id: 'empty',
        start: start,
        end: start,
        polyline: '',
        km: 0,
        pointCount: 0,
      );

      final route = journeyV2DecodeRecord(journey);

      expect(route.rawPoints, isEmpty);
      expect(route.usablePoints, isEmpty);
      expect(route.hasReplayableRoute, isFalse);
      expect(route.matchesStoredPointCount, isTrue);
    });

    test('missing point time creates a conservative route break', () {
      final start = DateTime(2026, 8, 17, 12);
      final journey = JourneyRecord(
        id: 'missing-time',
        startAt: start,
        endAt: start.add(const Duration(minutes: 5)),
        polyline: '',
        distanceKm: 0,
        pointCount: 2,
      );
      final route = JourneyV2Route(
        record: journey,
        rawPoints: const [],
        usablePoints: const [
          LocationHistoryPoint(lat: -20.02, lng: 57.59),
          LocationHistoryPoint(lat: -20.03, lng: 57.60),
        ],
      );

      expect(route.continuousSegments, hasLength(2));
    });
  });
}

String _encodePolyline(List<({double lat, double lng})> coords) {
  var previousLat = 0;
  var previousLng = 0;
  final buffer = StringBuffer();

  for (final coord in coords) {
    final lat = (coord.lat * 1e5).round();
    final lng = (coord.lng * 1e5).round();

    _encodeSigned(lat - previousLat, buffer);
    _encodeSigned(lng - previousLng, buffer);

    previousLat = lat;
    previousLng = lng;
  }

  return buffer.toString();
}

void _encodeSigned(int value, StringBuffer buffer) {
  var encoded = value < 0 ? ~(value << 1) : value << 1;

  while (encoded >= 0x20) {
    buffer.writeCharCode((0x20 | (encoded & 0x1f)) + 63);
    encoded >>= 5;
  }

  buffer.writeCharCode(encoded + 63);
}
