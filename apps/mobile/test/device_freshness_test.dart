import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';

void main() {
  test('watch check-in and GPS fix use separate clocks', () {
    final now = DateTime.utc(2026, 8, 14, 19);
    final device = Device(
      imei: '861397052547492',
      online: true,
      lastHeartbeatAt: now.subtract(const Duration(seconds: 20)),
      location: DeviceLocation(
        lat: -20.029299,
        lng: 57.5960407,
        recordedAt: now.subtract(const Duration(hours: 8)),
      ),
    );

    expect(
      deviceWatchCheckInLabel(device, now: now),
      'Watch checked in just now',
    );
    expect(deviceLocationFixLabel(device, now: now), 'Last GPS fix 8h ago');
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
      'GPS fix time unavailable',
    );
  });
}
