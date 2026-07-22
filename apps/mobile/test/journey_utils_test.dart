import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_utils.dart';
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
}
