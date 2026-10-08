import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/sos_location_snapshot.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/dashboard/device_formatters.dart';

void main() {
  final at = DateTime.utc(2026, 10, 8, 19, 5, 40, 596);
  Map<String, dynamic> point(String source, DateTime time) => {
    'lat': -20.2,
    'lng': 57.5,
    'source': source,
    'recordedAt': time.toIso8601String(),
    'accuracyMeters': 502.371,
    'placeLabel': 'New town',
  };
  Map<String, dynamic> snapshot(Object? location) => {
    'version': 2,
    'policy': 'fresh_incident_evidence_v2',
    'capturedAt': at.toIso8601String(),
    'state': location == null ? 'unavailable' : 'fresh',
    'retainedSatellite': false,
    'location': location,
  };

  test('v2 SOS shows recent approximate evidence with its own radius', () {
    final parsed = SosLocationSnapshot.tryParse(snapshot(point('lbs', at)))!;
    expect(parsed.state, 'fresh');
    expect(parsed.location!.accuracyMeters, 502.371);
    expect(parsed.location!.source, 'lbs');
    expect(parsed.mapsUri!.queryParameters['q'], '-20.2,57.5');
  });

  test(
    'v2 SOS accepts bounded packet-clock normalization and rejects forged timing',
    () {
      final raw = point('lbs', at)
        ..addAll({
          'timeBasis': 'gateway_receipt_clock_skew',
          'deviceRecordedAt': at
              .add(const Duration(milliseconds: 1404))
              .toIso8601String(),
        });
      expect(SosLocationSnapshot.tryParse(snapshot(raw)), isNotNull);
      raw['deviceRecordedAt'] = at
          .add(const Duration(minutes: 3))
          .toIso8601String();
      expect(SosLocationSnapshot.tryParse(snapshot(raw)), isNull);
    },
  );

  test('stale or future primary evidence cannot be a v2 current map', () {
    for (final time in [
      at.subtract(const Duration(minutes: 10, milliseconds: 1)),
      at.subtract(const Duration(minutes: 11)),
      at.add(const Duration(seconds: 1)),
    ]) {
      expect(
        SosLocationSnapshot.tryParse(snapshot(point('gps', time))),
        isNull,
      );
    }
    expect(SosLocationSnapshot.tryParse(snapshot(null))!.mapsUri, isNull);
  });

  test(
    'v2 Home needs matching unexpired enrolled evidence and keeps the saved-pin source',
    () {
      final raw = snapshot(point('home_wifi', at));
      expect(SosLocationSnapshot.tryParse(raw), isNull);
      raw['homeWifiEvidence'] = {
        'version': 4,
        'policy': 'enrolled_home_radio_v4',
        'pilot': true,
        'state': 'matched',
        'source': 'home_wifi',
        'observedAt': at.toIso8601String(),
        'expiresAt': at.add(const Duration(seconds: 90)).toIso8601String(),
        'anchor': {
          'geofenceId': 'fixture-home',
          'lat': -20.2,
          'lng': 57.5,
          'radiusMeters': 100,
        },
      };
      expect(SosLocationSnapshot.tryParse(raw)!.location!.source, 'home_wifi');
      (raw['homeWifiEvidence'] as Map)['expiresAt'] = at.toIso8601String();
      expect(SosLocationSnapshot.tryParse(raw), isNull);
    },
  );

  test('current app map expires without heartbeats renewing the location', () {
    final device = Device(
      imei: 'fixture',
      online: true,
      lastHeartbeatAt: at.add(const Duration(hours: 1)),
      location: DeviceLocation.fromMap(point('wifi', at)),
      lastSatelliteLocation: DeviceLocation(
        lat: -20.1,
        lng: 57.1,
        source: 'gps',
        recordedAt: at.subtract(const Duration(hours: 9)),
      ),
    );
    expect(device.mapDisplayLocationAt(at)!.source, 'wifi');
    expect(
      device.mapDisplayLocationAt(at.add(const Duration(minutes: 11))),
      isNull,
    );
    expect(
      deviceMapLocationFixLabel(
        device,
        now: at.add(const Duration(minutes: 11)),
      ),
      'Waiting for a fresh location report',
    );
  });
}
