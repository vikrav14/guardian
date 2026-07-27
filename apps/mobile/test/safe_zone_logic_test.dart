import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/safe_zones/safe_zone_logic.dart';
import 'package:guardian/theme/colors.dart';

void main() {
  final freshAt = DateTime.utc(2026, 7, 22, 12, 0);
  const homeZone = Geofence(
    id: 'zone-home',
    imei: '111',
    name: 'Home',
    active: true,
    lat: -20.2642,
    lng: 57.4791,
    radiusMeters: 150,
  );

  const schoolZone = Geofence(
    id: 'zone-school',
    imei: '222',
    name: 'School',
    active: true,
    lat: -20.27,
    lng: 57.48,
    radiusMeters: 200,
  );

    final deviceInside = Device(
    imei: '111',
    online: true,
    lastHeartbeatAt: freshAt,
    location: DeviceLocation(
      lat: -20.2642,
      lng: 57.4791,
      recordedAt: freshAt,
    ),
  );

    final deviceOutside = Device(
    imei: '111',
    online: true,
    lastHeartbeatAt: freshAt,
    location: DeviceLocation(
      lat: -20.28,
      lng: 57.49,
      recordedAt: freshAt,
    ),
  );

  test('categoryFromZoneName maps common zone names to palette categories', () {
    expect(categoryFromZoneName('Home'), SafeZoneCategory.home);
    expect(categoryFromZoneName('Grandma house'), SafeZoneCategory.home);
    expect(categoryFromZoneName('Primary School'), SafeZoneCategory.school);
    expect(categoryFromZoneName('Church'), SafeZoneCategory.church);
    expect(categoryFromZoneName('Office'), SafeZoneCategory.work);
    expect(categoryFromZoneName('Hiking trail'), SafeZoneCategory.hiking);
  });

  test('styleForCategory uses approved zone colors', () {
    // Home/hiking/other intentionally reuse the shared design-system tokens
    // (not bespoke hex) so they stay in sync with GuardianColors automatically.
    expect(
      styleForCategory(SafeZoneCategory.home).color.toARGB32(),
      GuardianColors.accent.toARGB32(),
    );
    expect(styleForCategory(SafeZoneCategory.school).color.toARGB32(), 0xFF7C3AED);
    expect(styleForCategory(SafeZoneCategory.church).color.toARGB32(), 0xFFEA580C);
    expect(styleForCategory(SafeZoneCategory.work).color.toARGB32(), 0xFF6B7280);
    expect(
      styleForCategory(SafeZoneCategory.hiking).color.toARGB32(),
      GuardianColors.safe.toARGB32(),
    );
  });

  test('isDeviceInsideZone uses haversine distance against radius', () {
    expect(isDeviceInsideZone(deviceInside, homeZone), isTrue);
    expect(isDeviceInsideZone(deviceOutside, homeZone), isFalse);
  });

  test('resolveZoneStatus prioritizes emergency, paused, outside, safe', () {
    const paused = Geofence(
      id: 'z1',
      imei: '111',
      name: 'Home',
      active: false,
      lat: -20.2642,
      lng: 57.4791,
      radiusMeters: 150,
    );

    expect(
      resolveZoneStatus(zone: paused, device: deviceInside, alerts: const []),
      SafeZoneStatus.paused,
    );

    expect(
      resolveZoneStatus(
        zone: homeZone,
        device: deviceInside,
        alerts: const [
          GuardianAlert(
            id: 'a1',
            imei: '111',
            type: 'sos',
            severity: 'critical',
            message: 'SOS',
            resolved: false,
          ),
        ],
      ),
      SafeZoneStatus.emergency,
    );

    expect(
      resolveZoneStatus(zone: homeZone, device: deviceOutside, alerts: const []),
      SafeZoneStatus.outside,
    );

    expect(
      resolveZoneStatus(zone: homeZone, device: deviceInside, alerts: const []),
      SafeZoneStatus.safe,
    );
  });

  test('occupantsForZone shows device linked by geofence imei only', () {
    final occupants = occupantsForZone(homeZone, [
      deviceInside,
      Device(imei: '222', online: true),
    ]);

    expect(occupants, hasLength(1));
    expect(occupants.first.imei, '111');
  });

  test('latestEnterAlert filters by geofence id in payload', () {
    final now = DateTime(2026, 7, 21, 12);
    final alerts = [
      GuardianAlert(
        id: 'old',
        imei: '111',
        type: 'geofence_enter',
        severity: 'info',
        message: 'Entered Home',
        resolved: true,
        createdAt: now.subtract(const Duration(days: 2)),
        payload: const {'geofenceId': 'zone-home'},
      ),
      GuardianAlert(
        id: 'new',
        imei: '111',
        type: 'geofence_enter',
        severity: 'info',
        message: 'Entered Home again',
        resolved: true,
        createdAt: now.subtract(const Duration(hours: 3)),
        payload: const {'geofenceId': 'zone-home'},
      ),
      GuardianAlert(
        id: 'other-zone',
        imei: '111',
        type: 'geofence_enter',
        severity: 'info',
        message: 'Entered School',
        resolved: true,
        createdAt: now,
        payload: const {'geofenceId': 'zone-school'},
      ),
    ];

    final latest = latestEnterAlert(homeZone, alerts);
    expect(latest?.id, 'new');
    expect(
      lastEnteredLabel(homeZone, alerts, now: now),
      'Last entered · 3h ago',
    );
  });

  test('relativeTimeLabel stays honest for stale timestamps', () {
    final now = DateTime(2026, 7, 22, 12);
    final stale = now.subtract(const Duration(hours: 30));

    expect(relativeTimeLabel(stale, now: now), '30h ago');
    expect(
      zoneUpdatedLabel(
        Device(
          imei: '111',
          online: true,
          updatedAt: stale,
        ),
        now: now,
      ),
      'Updated 30h ago',
    );
  });

  test('buildSafeZonesHeroSummary reports outside and emergency states', () {
    final now = DateTime(2026, 7, 22, 12);
    final outsideHero = buildSafeZonesHeroSummary(
      zones: const [homeZone],
      devices: [deviceOutside],
      alerts: const [],
      now: now,
    );
    expect(outsideHero.tone, SafeZoneStatus.outside);
    expect(outsideHero.headline, contains('outside'));

    final emergencyHero = buildSafeZonesHeroSummary(
      zones: const [homeZone],
      devices: [deviceInside],
      alerts: const [
        GuardianAlert(
          id: 'sos',
          imei: '111',
          type: 'sos',
          severity: 'critical',
          message: 'SOS pressed',
          resolved: false,
        ),
      ],
      now: now,
    );
    expect(emergencyHero.tone, SafeZoneStatus.emergency);

    final clearHero = buildSafeZonesHeroSummary(
      zones: const [homeZone, schoolZone],
      devices: [
        deviceInside,
        Device(
          imei: '222',
          online: true,
          lastHeartbeatAt: now,
          location: DeviceLocation(
            lat: -20.27,
            lng: 57.48,
            recordedAt: now,
          ),
        ),
      ],
      alerts: const [],
      now: now,
    );
    expect(clearHero.activeZoneCount, 2);
    expect(clearHero.tone, SafeZoneStatus.safe);
  });
}
