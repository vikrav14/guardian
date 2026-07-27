import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_replay_controller.dart';
import 'package:guardian/journey/journey_utils.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/models/location_history_point.dart';

List<LocationHistoryPoint> _line({
  required int count,
  required double startLat,
  required double startLng,
  required double latStep,
  required double lngStep,
  required DateTime startTime,
  required Duration step,
  double speedKmh = 10,
}) {
  return List.generate(count, (index) {
    return LocationHistoryPoint(
      lat: startLat + (latStep * index),
      lng: startLng + (lngStep * index),
      speedKmh: speedKmh,
      accuracySource: 'gps',
      recordedAt: startTime.add(step * index),
    );
  });
}

void main() {
  group('journeyDistanceKm', () {
    test('returns zero for fewer than two points', () {
      expect(journeyDistanceKm([]), 0);
      expect(
        journeyDistanceKm(const [LocationHistoryPoint(lat: -20.2, lng: 57.4)]),
        0,
      );
    });

    test('sums haversine segments between consecutive points', () {
      final points = _line(
        count: 3,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 17, 20),
        step: const Duration(minutes: 1),
      );

      final distance = journeyDistanceKm(points);
      expect(distance, greaterThan(0.1));
      expect(distance, lessThan(0.5));
    });

    test('ignores GPS teleports and placeholder coordinates', () {
      final points = [
        const LocationHistoryPoint(lat: -20.02, lng: 57.59),
        const LocationHistoryPoint(lat: 22.68, lng: 113.99),
        const LocationHistoryPoint(lat: -20.03, lng: 57.60),
      ];

      expect(journeyDistanceKm(points), 0);
    });
  });

  group('buildJourneyStats', () {
    test('uses stored journey distances when records exist', () {
      final points = _line(
        count: 3,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 17, 20),
        step: const Duration(minutes: 1),
      );
      final journeys = [
        JourneyRecord(
          id: 'j1',
          startAt: DateTime(2026, 7, 22, 17, 20),
          endAt: DateTime(2026, 7, 22, 17, 22),
          distanceKm: 2.349,
          pointCount: 13,
          polyline: '',
        ),
      ];

      final stats = buildJourneyStats(points, journeys: journeys);
      expect(stats.distanceKm, 2.349);
      expect(stats.pointCount, 3);
    });

    test('falls back to journey metadata when points are empty', () {
      final journeys = [
        JourneyRecord(
          id: 'j1',
          startAt: DateTime(2026, 7, 23, 16, 14),
          endAt: DateTime(2026, 7, 23, 17, 3),
          distanceKm: 2.674,
          pointCount: 22,
          polyline: '',
        ),
      ];

      final stats = buildJourneyStats(const [], journeys: journeys);
      expect(stats.distanceKm, 2.674);
      expect(stats.pointCount, 22);
      expect(stats.duration, const Duration(minutes: 49));
    });
  });

  group('filterOutlierPoints', () {
    test('removes factory placeholder coordinates', () {
      final points = [
        const LocationHistoryPoint(lat: -20.02, lng: 57.59),
        const LocationHistoryPoint(lat: 22.68, lng: 113.99),
        const LocationHistoryPoint(lat: -20.03, lng: 57.60),
      ];

      final filtered = filterOutlierPoints(points);
      expect(filtered.length, 2);
      expect(filtered.first.lat, closeTo(-20.02, 0.001));
      expect(filtered.last.lat, closeTo(-20.03, 0.001));
    });

    test('removes equator noise from compressed journey polylines', () {
      final points = [
        const LocationHistoryPoint(lat: -20.02418, lng: 57.59117),
        const LocationHistoryPoint(lat: 0.62588, lng: 57.59626),
        const LocationHistoryPoint(lat: -20.02915, lng: 57.59604),
      ];

      final filtered = filterOutlierPoints(points);
      expect(filtered.length, 2);
      expect(filtered.every((p) => p.lat < -5), isTrue);
    });
  });

  group('journeyDuration', () {
    test('uses first and last recordedAt timestamps', () {
      final start = DateTime(2026, 7, 22, 17, 20);
      final points = _line(
        count: 4,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0,
        lngStep: 0,
        startTime: start,
        step: const Duration(minutes: 5),
      );

      expect(journeyDuration(points), const Duration(minutes: 15));
    });
  });

  group('smoothRouteForDisplay', () {
    test('reduces noisy points while preserving endpoints', () {
      final base = _line(
        count: 20,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.0002,
        lngStep: 0.0001,
        startTime: DateTime(2026, 7, 22, 17, 20),
        step: const Duration(seconds: 30),
      );
      final noisy = [
        for (var i = 0; i < base.length; i++)
          LocationHistoryPoint(
            lat: base[i].lat + (i.isOdd ? 0.00001 : 0),
            lng: base[i].lng + (i.isOdd ? -0.00001 : 0),
            recordedAt: base[i].recordedAt,
          ),
      ];

      final smoothed = smoothRouteForDisplay(noisy, epsilonMeters: 5);
      expect(smoothed.length, lessThan(noisy.length));
      expect(smoothed.first.lat, closeTo(noisy.first.lat, 0.0001));
      expect(smoothed.last.lat, closeTo(noisy.last.lat, 0.0001));
    });

    test('replay display processing preserves the recorded source points', () {
      final recorded = _line(
        count: 8,
        startLat: -20.02418,
        startLng: 57.59117,
        latStep: 0.0004,
        lngStep: 0.0003,
        startTime: DateTime(2026, 7, 24, 15, 19),
        step: const Duration(minutes: 2),
      );
      final originalCoordinates = [
        for (final point in recorded) (point.lat, point.lng, point.recordedAt),
      ];

      final replay = JourneyReplayController(rawPoints: recorded);

      expect(recorded.length, originalCoordinates.length);
      expect(
        [
          for (final point in recorded) (point.lat, point.lng, point.recordedAt),
        ],
        originalCoordinates,
      );
      expect(replay.rawPoints, isNot(same(recorded)));
      expect(
        () => replay.rawPoints.add(recorded.first),
        throwsUnsupportedError,
      );

      replay.dispose();
    });
  });

  group('classifyTransportMode', () {
    test('classifies stationary, walking, bicycle, and vehicle speeds', () {
      expect(classifyTransportMode(0), TransportMode.stationary);
      expect(classifyTransportMode(3), TransportMode.walking);
      expect(classifyTransportMode(8), TransportMode.bicycle);
      expect(classifyTransportMode(25), TransportMode.vehicle);
    });

    test('classifySegmentSpeed maps to journey event types', () {
      expect(classifySegmentSpeed(0), JourneyEventType.stopped);
      expect(classifySegmentSpeed(4), JourneyEventType.walking);
      expect(classifySegmentSpeed(30), JourneyEventType.vehicle);
    });
  });

  group('buildRouteSegments', () {
    test('colors walking segments green and vehicle segments blue', () {
      final start = DateTime(2026, 7, 22, 8, 0);
      final points = <LocationHistoryPoint>[
        ..._line(
          count: 4,
          startLat: -20.2,
          startLng: 57.4,
          latStep: 0.0001,
          lngStep: 0,
          startTime: start,
          step: const Duration(minutes: 1),
          speedKmh: 3,
        ),
        ..._line(
          count: 4,
          startLat: -20.2003,
          startLng: 57.4,
          latStep: 0.001,
          lngStep: 0,
          startTime: start.add(const Duration(minutes: 3)),
          step: const Duration(minutes: 1),
          speedKmh: 25,
        ),
      ];

      final segments = buildRouteSegments(points);
      expect(segments.any((s) => s.color == RouteSegmentColor.green), isTrue);
      expect(segments.any((s) => s.color == RouteSegmentColor.blue), isTrue);
    });

    test('colors stationary segments purple', () {
      final start = DateTime(2026, 7, 22, 9, 0);
      final points = [
        LocationHistoryPoint(
          lat: -20.2,
          lng: 57.4,
          speedKmh: 0,
          recordedAt: start,
        ),
        LocationHistoryPoint(
          lat: -20.2,
          lng: 57.4,
          speedKmh: 0,
          recordedAt: start.add(const Duration(minutes: 1)),
        ),
        LocationHistoryPoint(
          lat: -20.201,
          lng: 57.4,
          speedKmh: 20,
          recordedAt: start.add(const Duration(minutes: 2)),
        ),
      ];

      expect(
        buildRouteSegments(points).any((s) => s.color == RouteSegmentColor.purple),
        isTrue,
      );
    });
  });

  group('detectJourneyEvents', () {
    test('does not mark left home without geofence exit', () {
      final points = _line(
        count: 5,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 8, 0),
        step: const Duration(minutes: 2),
        speedKmh: 12,
      );

      final events = detectJourneyEvents(points);
      expect(events.any((e) => e.type == JourneyEventType.leftHome), isFalse);
      expect(events.last.type, JourneyEventType.arrived);
    });

    test('emits left home and arrived home when crossing home geofence', () {
      const home = Geofence(
        id: 'home',
        imei: 'demo',
        name: 'Home',
        active: true,
        lat: -20.2642,
        lng: 57.4791,
        radiusMeters: 200,
      );
      final start = DateTime(2026, 7, 22, 8, 0);
      final points = <LocationHistoryPoint>[
        LocationHistoryPoint(
          lat: -20.2642,
          lng: 57.4791,
          speedKmh: 0,
          recordedAt: start,
        ),
        ..._line(
          count: 4,
          startLat: -20.2642,
          startLng: 57.4791,
          latStep: 0.003,
          lngStep: 0,
          startTime: start.add(const Duration(minutes: 2)),
          step: const Duration(minutes: 2),
          speedKmh: 12,
        ),
        LocationHistoryPoint(
          lat: -20.2642,
          lng: 57.4791,
          speedKmh: 0,
          recordedAt: start.add(const Duration(minutes: 12)),
        ),
      ];

      final events = detectJourneyEvents(points, geofences: const [home]);
      expect(events.any((e) => e.type == JourneyEventType.leftHome), isTrue);
      expect(
        events.any((e) => e.label.toLowerCase().contains('arrived home')),
        isTrue,
      );
    });

    test('detects vehicle movement above walking threshold', () {
      final points = _line(
        count: 6,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 9, 0),
        step: const Duration(minutes: 1),
        speedKmh: 25,
      );

      expect(
        detectJourneyEvents(points).any((e) => e.type == JourneyEventType.vehicle),
        isTrue,
      );
    });

    test('detects prolonged stops', () {
      final start = DateTime(2026, 7, 22, 10, 0);
      final points = <LocationHistoryPoint>[
        LocationHistoryPoint(
          lat: -20.2,
          lng: 57.4,
          speedKmh: 0,
          recordedAt: start,
        ),
        for (var i = 1; i <= 4; i++)
          LocationHistoryPoint(
            lat: -20.2,
            lng: 57.4,
            speedKmh: 0,
            recordedAt: start.add(Duration(minutes: i)),
          ),
        LocationHistoryPoint(
          lat: -20.201,
          lng: 57.4,
          speedKmh: 20,
          recordedAt: start.add(const Duration(minutes: 5)),
        ),
      ];

      expect(
        detectJourneyEvents(points).any((e) => e.type == JourneyEventType.stopped),
        isTrue,
      );
    });
  });

  group('computeJourneyScore', () {
    test('returns breakdown with overall score between 0 and 100', () {
      final points = _line(
        count: 30,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 11, 0),
        step: const Duration(minutes: 1),
        speedKmh: 12,
      );

      final score = computeJourneyScore(points);
      expect(score.overall, inInclusiveRange(0, 100));
      expect(score.gpsAccuracy, inInclusiveRange(0, 100));
      expect(score.routeConsistency, inInclusiveRange(0, 100));
      expect(score.safety, inInclusiveRange(0, 100));
      expect(score.battery, inInclusiveRange(0, 100));
    });
  });

  group('computeJourneyQuality', () {
    test('labels dense GPS data as excellent', () {
      final points = _line(
        count: 60,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 12, 0),
        step: const Duration(minutes: 1),
      );

      final quality = computeJourneyQuality(points);
      expect(quality.fixesLabel, '60 GPS fixes');
      expect(quality.label, 'Excellent');
    });

    test('does not label excellent when GPS metadata is missing', () {
      final start = DateTime(2026, 7, 22, 12, 0);
      final points = List.generate(
        60,
        (index) => LocationHistoryPoint(
          lat: -20.2 + (index * 0.0001),
          lng: 57.4,
          recordedAt: start.add(Duration(minutes: index)),
        ),
      );

      expect(computeJourneyQuality(points).label, 'Unknown');
    });
  });

  group('computeJourneyHighlights', () {
    test('counts safe zones visited from geofence data', () {
      final start = DateTime(2026, 7, 22, 13, 0);
      final points = _line(
        count: 5,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0,
        lngStep: 0,
        startTime: start,
        step: const Duration(minutes: 5),
      );
      const zone = Geofence(
        id: 'home',
        imei: 'demo',
        name: 'Home',
        active: true,
        lat: -20.2642,
        lng: 57.4791,
        radiusMeters: 200,
      );

      final highlights = computeJourneyHighlights(points, zones: const [zone]);
      expect(highlights.safeZonesVisited, 1);
    });
  });

  group('buildJourneyInsights', () {
    test('flags unusual stops and computes confidence', () {
      final start = DateTime(2026, 7, 22, 11, 0);
      final points = <LocationHistoryPoint>[
        ..._line(
          count: 10,
          startLat: -20.2,
          startLng: 57.4,
          latStep: 0.0004,
          lngStep: 0,
          startTime: start,
          step: const Duration(minutes: 1),
          speedKmh: 15,
        ),
        for (var i = 0; i < 3; i++)
          LocationHistoryPoint(
            lat: -20.2036,
            lng: 57.4,
            speedKmh: 0,
            accuracySource: 'gps',
            recordedAt: start.add(Duration(minutes: 10 + i)),
          ),
      ];

      final insights = buildJourneyInsights(points);
      expect(insights.stopCount, greaterThanOrEqualTo(1));
      expect(insights.confidenceScore, greaterThan(50));
      expect(insights.confidenceExplanation, 'Based on 13 GPS fixes');
      expect(insights.avgSpeedKmh, isNotNull);
    });
  });

  group('buildJourneyInsights confidenceExplanation', () {
    test('includes GPS fix count', () {
      final points = _line(
        count: 8,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0002,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 14, 0),
        step: const Duration(minutes: 1),
      );

      expect(
        buildJourneyInsights(points).confidenceExplanation,
        'Based on 8 GPS fixes',
      );
    });
  });

  group('buildJourneyInsights GPS reliability', () {
    test('caps confidence when live GPS is stale on today', () {
      final points = _line(
        count: 30,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 8, 0),
        step: const Duration(minutes: 1),
        speedKmh: 12,
      );
      const gpsContext = JourneyGpsContext(
        liveGpsFresh: false,
        staleGpsActive: true,
        isViewingToday: true,
      );

      final insights = buildJourneyInsights(points, gpsContext: gpsContext);
      expect(insights.confidenceScore, lessThanOrEqualTo(25));
      expect(insights.highDataQuality, isFalse);
      expect(insights.gpsQualityLabel, 'GPS unavailable');
      expect(
        insights.confidenceExplanation,
        'GPS unavailable — journey data may be incomplete',
      );
      expect(insights.confidenceSubtitle, 'Limited GPS data');
    });

    test('does not claim excellent GPS when metadata is missing', () {
      final start = DateTime(2026, 7, 22, 8, 0);
      final points = List.generate(
        25,
        (index) => LocationHistoryPoint(
          lat: -20.2 + (index * 0.0002),
          lng: 57.4,
          speedKmh: 10,
          recordedAt: start.add(Duration(minutes: index)),
        ),
      );

      final insights = buildJourneyInsights(points);
      expect(insights.gpsQualityLabel, 'GPS quality unknown');
      expect(insights.highDataQuality, isFalse);
      expect(insights.confidenceScore, lessThan(70));
      expect(
        insights.confidenceExplanation,
        'GPS metadata unavailable for this route',
      );
    });

    test('journey health avoids excellent GPS when live fix is unavailable', () {
      final points = _line(
        count: 30,
        startLat: -20.2,
        startLng: 57.4,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 8, 0),
        step: const Duration(minutes: 1),
        speedKmh: 12,
      );
      const gpsContext = JourneyGpsContext(
        liveGpsFresh: false,
        isViewingToday: true,
      );
      final insights = buildJourneyInsights(points, gpsContext: gpsContext);
      final quality = computeJourneyQuality(points, gpsContext: gpsContext);
      final score = computeJourneyScore(points, gpsContext: gpsContext);
      final assessment = assessJourneyGps(points, gpsContext: gpsContext);
      final health = computeJourneyHealth(
        insights,
        quality,
        score,
        gpsAssessment: assessment,
      );

      expect(health.summary, contains('GPS unreliable'));
      expect(health.summary, isNot(contains('excellent GPS')));
    });
  });

  group('journeyGpsContextForDevice', () {
    test('maps stale_gps intelligence into journey GPS context', () {
      final now = DateTime(2026, 7, 22, 13, 40);
      final device = Device(
        imei: '1',
        online: true,
        location: DeviceLocation(lat: -20.2, lng: 57.5, recordedAt: now),
        lastHeartbeatAt: now,
        intelligence: DeviceIntelligence(
          insights: const [
            DeviceIntelligenceInsight(
              id: 'stale_gps',
              inference: 'Last GPS fix is 12 minutes old.',
              confidence: 80,
              level: 'warning',
            ),
          ],
          topInsight: const DeviceIntelligenceInsight(
            id: 'stale_gps',
            inference: 'Last GPS fix is 12 minutes old.',
            confidence: 80,
            level: 'warning',
          ),
        ),
      );

      final context = journeyGpsContextForDevice(device, isViewingToday: true);
      expect(context.staleGpsActive, isTrue);
      expect(context.liveGpsFresh, isTrue);
    });
  });

  group('RouteSegmentColorX', () {
    test('maps segment colors to flutter colors', () {
      expect(RouteSegmentColor.green.toColor(), isA<Color>());
      expect(RouteSegmentColor.blue.toColor(), isA<Color>());
      expect(RouteSegmentColor.purple.toColor(), isA<Color>());
    });
  });

  group('computeRouteSimilarity', () {
    test('returns high score for identical routes', () {
      final points = _line(
        count: 10,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 8, 0),
        step: const Duration(minutes: 2),
      );

      expect(computeRouteSimilarity(points, points), greaterThanOrEqualTo(95));
    });

    test('returns lower score for divergent routes', () {
      final a = _line(
        count: 10,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 8, 0),
        step: const Duration(minutes: 2),
      );
      final b = _line(
        count: 10,
        startLat: -20.35,
        startLng: 57.55,
        latStep: 0.0003,
        lngStep: 0,
        startTime: DateTime(2026, 7, 21, 8, 0),
        step: const Duration(minutes: 2),
      );

      expect(computeRouteSimilarity(a, b), lessThan(50));
    });
  });

  group('buildHeatmapCells', () {
    test('clusters repeated visits into cells', () {
      final start = DateTime(2026, 7, 22, 9, 0);
      final points = [
        for (var i = 0; i < 5; i++)
          LocationHistoryPoint(
            lat: -20.2642 + (i.isEven ? 0.00001 : 0),
            lng: 57.4791,
            recordedAt: start.add(Duration(minutes: i)),
          ),
      ];

      final cells = buildHeatmapCells(points);
      expect(cells, isNotEmpty);
      expect(cells.first.visitCount, greaterThanOrEqualTo(2));
    });
  });

  group('typicalWeatherForMonth', () {
    test('returns Mauritius seasonal placeholder', () {
      final jan = typicalWeatherForMonth(1);
      final jul = typicalWeatherForMonth(7);
      expect(jan.display, contains('°C'));
      expect(jul.label, isNotEmpty);
    });
  });

  group('decodePolyline', () {
    test('decodes gateway-encoded polyline', () {
      const encoded = r'fztzBkky}I~CsD';
      final points = decodePolyline(encoded);
      expect(points.length, 2);
      expect(points.first.lat, closeTo(-20.2642, 0.0001));
      expect(points.last.lng, closeTo(57.48, 0.0001));
    });
  });

  group('pointsFromJourneyRecords', () {
    test('expands today Bouboush gateway polylines with bad segment removed', () {
      final journeys = [
        JourneyRecord(
          id: 'j1',
          startAt: DateTime.utc(2026, 7, 23, 12, 14, 38),
          endAt: DateTime.utc(2026, 7, 23, 12, 28, 0),
          polyline: r'b~eyBygo~I|Wy^}Wx^??xRyPbD_M????????????cD~L',
          distanceKm: 2.349,
          pointCount: 13,
        ),
        JourneyRecord(
          id: 'j2',
          startAt: DateTime.utc(2026, 7, 23, 12, 34, 9),
          endAt: DateTime.utc(2026, 7, 23, 12, 42, 0),
          polyline: r'`wfyBsgp~I??',
          distanceKm: 0,
          pointCount: 2,
        ),
        JourneyRecord(
          id: 'j3',
          startAt: DateTime.utc(2026, 7, 23, 12, 47, 18),
          endAt: DateTime.utc(2026, 7, 23, 13, 3, 0),
          polyline: r'd}fyBgfp~IcEk@????xDJDD_EQ',
          distanceKm: 0.325,
          pointCount: 7,
        ),
      ];

      final points = pointsFromJourneyRecords(journeys);
      expect(points, isNotEmpty);
      expect(points.length, greaterThanOrEqualTo(18));
      expect(points.every((p) => p.lat < -5), isTrue);
    });
  });

  group('buildJourneyDayData', () {
    test('merges dwell segments into timeline labels', () {
      final start = DateTime(2026, 7, 22, 9, 0);
      final end = DateTime(2026, 7, 22, 12, 10);
      const home = Geofence(
        id: 'home',
        imei: 'demo',
        name: 'Home',
        active: true,
        lat: -20.2642,
        lng: 57.4791,
        radiusMeters: 200,
      );
      final dwell = DwellSegment(
        id: 'd1',
        from: start,
        to: end,
        centerLat: -20.2642,
        centerLng: 57.4791,
        geofenceId: 'home',
      );
      final points = _line(
        count: 6,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 13, 0),
        step: const Duration(minutes: 5),
        speedKmh: 12,
      );

      final dayData = buildJourneyDayData(
        locationPoints: points,
        journeys: const [],
        dwells: [dwell],
        geofences: const [home],
      );

      expect(
        dayData.events.any((e) => e.type == JourneyEventType.dwell),
        isTrue,
      );
      expect(
        dayData.events
            .firstWhere((e) => e.type == JourneyEventType.dwell)
            .label,
        contains('Stayed at Home'),
      );
      expect(
        dayData.events
            .firstWhere((e) => e.type == JourneyEventType.dwell)
            .label,
        contains('09:00'),
      );
    });
  });

  group('bearingDegrees', () {
    test('north is ~0° and east is ~90°', () {
      expect(
        bearingDegrees(-20.03, 57.59, -20.02, 57.59),
        closeTo(0, 1),
      );
      expect(
        bearingDegrees(-20.03, 57.59, -20.03, 57.60),
        closeTo(90, 2),
      );
    });

    test('bearingAtRouteIndex uses forward segment', () {
      final points = _line(
        count: 4,
        startLat: -20.2642,
        startLng: 57.4791,
        latStep: 0.001,
        lngStep: 0,
        startTime: DateTime(2026, 7, 22, 17, 20),
        step: const Duration(minutes: 1),
      );
      final bearing = bearingAtRouteIndex(points, 1);
      expect(bearing, isNotNull);
      expect(bearing!, closeTo(0, 5));
    });
  });
}
