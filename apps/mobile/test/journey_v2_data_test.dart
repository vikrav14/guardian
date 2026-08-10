import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';

void main() {
  JourneyRecord record({
    required String id,
    required DateTime start,
    required DateTime end,
    required String polyline,
    required double km,
    required int pointCount,
  }) {
    return JourneyRecord(
      id: id,
      startAt: start,
      endAt: end,
      polyline: polyline,
      distanceKm: km,
      pointCount: pointCount,
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
