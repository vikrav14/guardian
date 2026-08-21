import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/journey/journey_v2_static_map.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/models/location_history_point.dart';

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

  test(
    'tracking gaps produce separate map segments instead of a straight line',
    () {
      final start = DateTime(2026, 8, 17, 12, 15);
      final journey = JourneyRecord(
        id: 'gap-trip',
        startAt: start,
        endAt: start.add(const Duration(minutes: 28)),
        polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
        distanceKm: 1.2,
        pointCount: 3,
        evidenceVersion: 3,
        routeStartAnchored: true,
        pointEvidence: const [
          JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
          JourneyPointEvidence(
            offsetMs: 60 * 1000,
            source: 'gps',
            gpsValid: true,
          ),
          JourneyPointEvidence(
            offsetMs: 28 * 60 * 1000,
            source: 'gps',
            gpsValid: true,
          ),
        ],
      );

      final segments = journeyV2StaticMapSegments(
        journeyV2DecodeRecord(journey),
      );

      expect(segments, hasLength(2));
      expect(segments.first, hasLength(2));
      expect(segments.last, hasLength(1));
    },
  );

  test('missing point time never creates a connected map line', () {
    final segments = journeyV2SplitPointsOnTrackingGaps(const [
      LocationHistoryPoint(lat: -20.02, lng: 57.59),
      LocationHistoryPoint(lat: -20.03, lng: 57.60),
    ]);

    expect(segments, hasLength(2));
  });

  test('GPS and approximate observations become distinct evidence segments', () {
    final start = DateTime(2026, 8, 19, 18);
    final points = [
      LocationHistoryPoint(
        lat: -20.01,
        lng: 57.58,
        source: 'gps',
        gpsValid: true,
        recordedAt: start,
      ),
      LocationHistoryPoint(
        lat: -20.02,
        lng: 57.59,
        source: 'gps',
        gpsValid: true,
        recordedAt: start.add(const Duration(minutes: 1)),
      ),
      LocationHistoryPoint(
        lat: -20.03,
        lng: 57.60,
        source: 'wifi',
        gpsValid: false,
        recordedAt: start.add(const Duration(minutes: 2)),
      ),
      LocationHistoryPoint(
        lat: -20.04,
        lng: 57.61,
        source: 'lbs',
        gpsValid: false,
        recordedAt: start.add(const Duration(minutes: 3)),
      ),
    ];
    final route = JourneyV2Route(
      record: record('', pointCount: 4),
      rawPoints: points,
      usablePoints: points,
    );

    final segments = journeyV2EvidenceSegments(route);

    expect(segments, hasLength(2));
    expect(segments.first.approximate, isFalse);
    expect(segments.first.points, hasLength(2));
    expect(segments.last.approximate, isTrue);
    expect(segments.last.points, hasLength(3));
  });

  test('confirmed return without zone data uses a Home point, not a fake radius', () {
    final start = DateTime(2026, 8, 17, 15, 30);
    final journey = JourneyRecord(
      id: 'home-round-trip',
      startAt: start,
      endAt: start.add(const Duration(minutes: 3)),
      polyline: r'f{`zBcmz~I}|XvfI',
      distanceKm: 1.2,
      pointCount: 2,
      closeReason: 'return_to_origin',
      originGeofenceName: 'Home',
      evidenceVersion: 3,
      routeStartAnchored: true,
      pointEvidence: const [
        JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
        JourneyPointEvidence(
          offsetMs: 3 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
      ],
    );
    final route = journeyV2DecodeRecord(journey);
    final points = journeyV2StaticMapPoints(route);
    final markers = journeyV2EndpointMarkers(route, points);
    final circles = journeyV2EndpointCircles(route, points);

    expect(markers, isEmpty);
    expect(circles, hasLength(1));
    expect(
      circles.map((circle) => circle.circleId.value),
      contains('journey-origin-core'),
    );
    for (final circle in circles) {
      expect(circle.center.latitude, closeTo(points.first.lat, 0.000001));
      expect(circle.center.longitude, closeTo(points.first.lng, 0.000001));
    }
  });

  test('configured Home safe zone uses its real center and radius', () {
    final start = DateTime(2026, 8, 21, 12, 20);
    final journey = JourneyRecord(
      id: 'configured-home-round-trip',
      startAt: start,
      endAt: start.add(const Duration(minutes: 28)),
      polyline: r'f{`zBcmz~I}|XvfI',
      distanceKm: 6.2,
      pointCount: 2,
      closeReason: 'return_to_origin',
      originGeofenceId: 'home-id',
      originGeofenceName: 'Home',
      evidenceVersion: 3,
      routeStartAnchored: true,
      pointEvidence: const [
        JourneyPointEvidence(offsetMs: 0, source: 'gps', gpsValid: true),
        JourneyPointEvidence(
          offsetMs: 28 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
      ],
    );
    final route = journeyV2DecodeRecord(journey);
    final points = journeyV2StaticMapPoints(route);
    const home = Geofence(
      id: 'home-id',
      imei: 'watch-1',
      name: 'Home',
      active: true,
      lat: -20.02937,
      lng: 57.59612,
      radiusMeters: 150,
    );

    final circles = journeyV2EndpointCircles(
      route,
      points,
      originGeofence: home,
    );
    final safeZone = circles.singleWhere(
      (circle) => circle.circleId.value == 'journey-origin-safe-zone',
    );

    expect(circles, hasLength(2));
    expect(safeZone.center.latitude, closeTo(home.lat, 0.000001));
    expect(safeZone.center.longitude, closeTo(home.lng, 0.000001));
    expect(safeZone.radius, home.radiusMeters);
  });

  test('source evidence shows only recorded GPS observations', () {
    final start = DateTime(2026, 8, 21, 12);
    final points = [
      LocationHistoryPoint(
        lat: -20.02,
        lng: 57.59,
        source: 'gps',
        gpsValid: true,
        recordedAt: start,
      ),
      LocationHistoryPoint(
        lat: -20.03,
        lng: 57.60,
        source: 'wifi',
        gpsValid: false,
        recordedAt: start.add(const Duration(minutes: 1)),
      ),
    ];
    final route = JourneyV2Route(
      record: record('', pointCount: 2),
      rawPoints: points,
      usablePoints: points,
    );

    final circles = journeyV2SourceEvidenceCircles(route).toList();

    expect(circles, hasLength(1));
    expect(circles[0].circleId.value, 'journey-source-evidence-0');
    expect(circles[0].radius, greaterThanOrEqualTo(34));
    expect(journeyV2RecordedGpsEvidencePoints(route), hasLength(1));
  });

  test('hybrid presentation preserves GPS and Google route sources', () {
    final journey = record(
      r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
      pointCount: 3,
    );
    final presentation = JourneyRoutePresentation(
      version: 1,
      generatedAt: DateTime(2026, 8, 21),
      expiresAt: DateTime(2099),
      segments: const [
        JourneyPresentationSegment(
          source: 'gps',
          polyline: r'_p~iF~ps|U_ulLnnqC',
          fromPointIndex: 0,
          toPointIndex: 1,
          fromOffsetMs: 0,
          toOffsetMs: 60 * 1000,
        ),
        JourneyPresentationSegment(
          source: 'google',
          polyline: r'_p~iF~ps|U_ulLnnqC_mqNvxq`@',
          fromPointIndex: 1,
          toPointIndex: 2,
          fromOffsetMs: 60 * 1000,
          toOffsetMs: 45 * 60 * 1000,
          confidence: 'supported_estimate',
        ),
      ],
      stopPlaces: const [],
    );
    final route = journeyV2DecodeRecord(
      journey,
      presentation: presentation,
    );

    final segments = journeyV2PresentationMapSegments(route);
    final points = journeyV2StaticMapPoints(route);

    expect(segments.map((segment) => segment.source), ['gps', 'google']);
    expect(points.length, greaterThanOrEqualTo(3));
    expect(points.first.sourcePointIndex, 0);
    expect(points.last.sourcePointIndex, 2);
  });
}
