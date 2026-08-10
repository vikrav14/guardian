import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/journey/journey_v2_static_map.dart';

void main() {
  JourneyRecord record(String polyline, {int pointCount = 3}) {
    return JourneyRecord(
      id: 'map-trip',
      startAt: DateTime(2026, 8, 10, 16, 50),
      endAt: DateTime(2026, 8, 10, 17, 35),
      polyline: polyline,
      distanceKm: 21.9,
      pointCount: pointCount,
    );
  }

  test('web-safe decoder handles canonical Google sample', () {
    final coords = journeyV2DecodePolylineWebSafe(
      r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    );

    expect(coords, hasLength(3));
    expect(coords[0].lat, closeTo(38.5, 0.00001));
    expect(coords[0].lng, closeTo(-120.2, 0.00001));
    expect(coords[2].lat, closeTo(43.252, 0.00001));
    expect(coords[2].lng, closeTo(-126.453, 0.00001));
  });

  test('web-safe decoder handles negative Mauritius first latitude', () {
    final coords = journeyV2DecodePolylineWebSafe(r'f{`zBcmz~I}|XvfI');

    expect(coords, hasLength(2));
    expect(coords.first.lat, closeTo(-20.16196, 0.00001));
    expect(coords.first.lng, closeTo(57.64834, 0.00001));
    expect(coords.last.lat, closeTo(-20.02917, 0.00001));
    expect(coords.last.lng, closeTo(57.59590, 0.00001));
  });

  test('static map can recover from broken shared-decoder points', () {
    final route = JourneyV2Route(
      record: record(r'f{`zBcmz~I}|XvfI', pointCount: 2),
      rawPoints: const [],
      usablePoints: const [],
    );

    final points = journeyV2StaticMapPoints(route);

    expect(points, hasLength(2));
    expect(points.first.lat, closeTo(-20.16196, 0.00001));
    expect(points.first.lng, closeTo(57.64834, 0.00001));
  });

  test('bounds contain the recovered route', () {
    final route = JourneyV2Route(
      record: record(r'f{`zBcmz~I}|XvfI', pointCount: 2),
      rawPoints: const [],
      usablePoints: const [],
    );

    final points = journeyV2StaticMapPoints(route);
    final bounds = journeyV2Bounds(points)!;

    for (final point in points) {
      expect(point.lat, greaterThanOrEqualTo(bounds.southwest.latitude));
      expect(point.lat, lessThanOrEqualTo(bounds.northeast.latitude));
      expect(point.lng, greaterThanOrEqualTo(bounds.southwest.longitude));
      expect(point.lng, lessThanOrEqualTo(bounds.northeast.longitude));
    }
  });
}
