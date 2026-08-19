import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';

void main() {
  test('watch check-in and GPS fix use separate clocks', () {
    final now = DateTime.utc(2026, 8, 14, 19);
    final device = Device(
      imei: '861397052547492',
      online: true,
      accuracySource: 'gps',
      lastHeartbeatAt: now.subtract(const Duration(seconds: 20)),
      location: DeviceLocation(
        lat: -20.029299,
        lng: 57.5960407,
        source: 'gps',
        gpsValid: true,
        recordedAt: now.subtract(const Duration(hours: 8)),
      ),
    );

    expect(
      deviceWatchCheckInLabel(device, now: now),
      'Watch checked in just now',
    );
    expect(
      deviceLocationFixLabel(device, now: now),
      'Satellite GPS updated 8h ago',
    );
  });

  test('watch check-in falls back to the device update timestamp', () {
    final now = DateTime.utc(2026, 8, 14, 19);
    final device = Device(
      imei: '861397052547492',
      online: false,
      updatedAt: now.subtract(const Duration(minutes: 17)),
    );

    expect(
      deviceWatchCheckInLabel(device, now: now),
      'Watch checked in 17m ago',
    );
    expect(
      deviceLocationFixLabel(device, now: now),
      'Location time unavailable',
    );
  });

  test('recent indoor fallback retains and labels the last satellite fix', () {
    final now = DateTime.utc(2026, 8, 14, 19, 48);
    final satellite = DeviceLocation(
      lat: -20.029278,
      lng: 57.5960427,
      source: 'gps',
      gpsValid: true,
      recordedAt: DateTime.utc(2026, 8, 14, 19, 42),
    );
    final approximate = DeviceLocation(
      lat: -20.028,
      lng: 57.596,
      source: 'wifi',
      gpsValid: false,
      accuracyMeters: 308.701,
      recordedAt: DateTime.utc(2026, 8, 14, 19, 47),
    );
    final device = Device(
      imei: '861397052547492',
      online: true,
      accuracySource: 'wifi',
      location: approximate,
      lastLocationObservation: approximate,
      lastSatelliteLocation: satellite,
      lastApproximateLocation: approximate,
      lastHeartbeatAt: now,
    );

    expect(device.isDisplayingRetainedSatelliteLocation, true);
    expect(device.displayLocation, same(satellite));
    expect(device.displayLocationSource, 'gps');
    expect(deviceLocationStatusLabel(device), 'Last satellite fix');
    expect(
      deviceLocationFixLabel(device, now: now),
      'Last satellite fix 6m ago',
    );
  });

  test('approximate fix becomes display position after retention window', () {
    final satelliteAt = DateTime.utc(2026, 8, 14, 19);
    final approximateAt = satelliteAt.add(const Duration(minutes: 31));
    final approximate = DeviceLocation(
      lat: -20.028,
      lng: 57.596,
      source: 'lbs',
      accuracyMeters: 900,
      recordedAt: approximateAt,
    );
    final device = Device(
      imei: '861397052547492',
      online: true,
      accuracySource: 'lbs',
      location: approximate,
      lastLocationObservation: approximate,
      lastSatelliteLocation: DeviceLocation(
        lat: -20.029278,
        lng: 57.5960427,
        source: 'gps',
        recordedAt: satelliteAt,
      ),
      lastHeartbeatAt: approximateAt,
    );

    expect(device.isDisplayingRetainedSatelliteLocation, false);
    expect(device.displayLocation, same(approximate));
    expect(device.mapDisplayLocation, same(device.lastSatelliteLocation));
    expect(device.isMapDisplayingLastSatelliteLocation, true);
    expect(deviceLocationStatusLabel(device), 'Approximate location');
    expect(
      deviceLocationFixLabel(device, now: approximateAt),
      'Approximate network location updated just now',
    );
    expect(deviceMapLocationStatusLabel(device), 'Last reliable fix');
    expect(
      deviceMapLocationFixLabel(device, now: approximateAt),
      'Last reliable GPS fix 31m ago',
    );
  });

  test('map moves again when a new satellite fix arrives', () {
    final now = DateTime.utc(2026, 8, 14, 20);
    final gps = DeviceLocation(
      lat: -20.04,
      lng: 57.61,
      source: 'gps',
      gpsValid: true,
      recordedAt: now,
    );
    final device = Device(
      imei: '861397052547492',
      online: true,
      accuracySource: 'gps',
      location: gps,
      lastLocationObservation: gps,
      lastSatelliteLocation: gps,
      lastHeartbeatAt: now,
    );

    expect(device.mapDisplayLocation, same(gps));
    expect(device.isMapDisplayingLastSatelliteLocation, false);
  });

  test('map can use approximate location when no satellite fix exists', () {
    final now = DateTime.utc(2026, 8, 14, 20);
    final approximate = DeviceLocation(
      lat: -20.03,
      lng: 57.60,
      source: 'lbs',
      gpsValid: false,
      accuracyMeters: 800,
      recordedAt: now,
    );
    final device = Device(
      imei: '861397052547492',
      online: true,
      accuracySource: 'lbs',
      location: approximate,
      lastLocationObservation: approximate,
      lastHeartbeatAt: now,
    );

    expect(device.mapDisplayLocation, same(approximate));
    expect(device.isMapDisplayingLastSatelliteLocation, false);
  });

  test('cellular signal uses the measured V52 percentage while fresh', () {
    final now = DateTime.utc(2026, 8, 16, 10);
    final device = Device(
      imei: '861397052547492',
      online: true,
      lastHeartbeatAt: now.subtract(const Duration(seconds: 30)),
      cellularSignalPercent: 80,
      cellularSignalUpdatedAt: now.subtract(const Duration(minutes: 2)),
    );

    expect(deviceCellularSignalLabel(device, now: now), 'Signal 80%');
  });

  test('cellular signal never substitutes connectivity for a measurement', () {
    final now = DateTime.utc(2026, 8, 16, 10);
    final missing = Device(
      imei: '1',
      online: true,
      lastHeartbeatAt: now,
    );
    final stale = Device(
      imei: '2',
      online: true,
      lastHeartbeatAt: now,
      cellularSignalPercent: 80,
      cellularSignalUpdatedAt: now.subtract(const Duration(minutes: 13)),
    );

    expect(deviceCellularSignalLabel(missing, now: now), 'Signal —');
    expect(deviceCellularSignalLabel(stale, now: now), 'Signal —');
  });

  test('cellular signal says no signal only when contact is not live', () {
    final now = DateTime.utc(2026, 8, 16, 10);
    final device = Device(
      imei: '1',
      online: true,
      lastHeartbeatAt: now.subtract(const Duration(minutes: 13)),
      cellularSignalPercent: 80,
      cellularSignalUpdatedAt: now.subtract(const Duration(minutes: 13)),
    );

    expect(deviceCellularSignalLabel(device, now: now), 'No signal');
  });

  test('GPS chip adds satellite context without claiming metre accuracy', () {
    final now = DateTime.utc(2026, 8, 16, 10);
    final device = Device(
      imei: '1',
      online: true,
      accuracySource: 'gps',
      lastHeartbeatAt: now,
      location: DeviceLocation(
        lat: -20.02,
        lng: 57.59,
        source: 'gps',
        gpsValid: true,
        satellites: 9,
        recordedAt: now,
      ),
    );

    expect(deviceGpsChipLabel(device), 'GPS · 9 sat');
  });
}
