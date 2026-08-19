import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';

void main() {
  test('JourneyPointEvidence parses a reverse-geocoded place name', () {
    final evidence = JourneyPointEvidence.fromMap({
      'offsetMs': 60000,
      'source': 'gps',
      'gpsValid': true,
      'placeName': 'Petite Julie',
    });

    expect(evidence.placeName, 'Petite Julie');
  });

  test('JourneyStop parses factual stop data without inventing a place', () {
    final stop = JourneyStop.fromMap(<String, dynamic>{
      'id': 'stop_1',
      'startAt': '2026-08-11T10:08:00Z',
      'endAt': '2026-08-11T10:16:00Z',
      'durationMinutes': 8,
      'centerLat': -20.255,
      'centerLng': 57.484,
      'pointStartIndex': 2,
      'pointEndIndex': 4,
      'placeName': null,
      'source': 'gps_dwell',
    });

    expect(stop.id, 'stop_1');
    expect(stop.durationMinutes, 8);
    expect(stop.duration, const Duration(minutes: 8));
    expect(stop.placeName, isNull);
    expect(stop.source, 'gps_dwell');
  });

  test('JourneyLeg parses movement between stops', () {
    final leg = JourneyLeg.fromMap(<String, dynamic>{
      'id': 'leg_2',
      'startAt': '2026-08-11T10:16:00Z',
      'endAt': '2026-08-11T10:28:00Z',
      'durationMinutes': 12,
      'distanceKm': 2.4,
      'pointStartIndex': 4,
      'pointEndIndex': 6,
      'fromStopId': 'stop_1',
      'toStopId': null,
    });

    expect(leg.id, 'leg_2');
    expect(leg.distanceKm, 2.4);
    expect(leg.fromStopId, 'stop_1');
    expect(leg.toStopId, isNull);
  });

  test('JourneyRecord exposes total factual stop duration', () {
    final record = JourneyRecord(
      id: 'journey_1',
      startAt: DateTime.parse('2026-08-11T10:00:00Z'),
      endAt: DateTime.parse('2026-08-11T10:30:00Z'),
      polyline: 'abc',
      distanceKm: 4.2,
      pointCount: 7,
      stops: [
        JourneyStop.fromMap(<String, dynamic>{
          'id': 'stop_1',
          'startAt': '2026-08-11T10:08:00Z',
          'endAt': '2026-08-11T10:16:00Z',
          'durationMinutes': 8,
          'centerLat': -20.255,
          'centerLng': 57.484,
          'pointStartIndex': 2,
          'pointEndIndex': 4,
        }),
      ],
      stopCount: 1,
      legCount: 2,
    );

    expect(record.stopCount, 1);
    expect(record.legCount, 2);
    expect(record.totalStopDuration, const Duration(minutes: 8));
  });

  test('legacy journey records default to no structured stops or legs', () {
    final record = JourneyRecord(
      id: 'legacy',
      startAt: DateTime.parse('2026-08-10T10:00:00Z'),
      endAt: DateTime.parse('2026-08-10T10:20:00Z'),
      polyline: 'abc',
      distanceKm: 2,
      pointCount: 5,
    );

    expect(record.stops, isEmpty);
    expect(record.legs, isEmpty);
    expect(record.stopCount, 0);
    expect(record.legCount, 0);
  });
}
