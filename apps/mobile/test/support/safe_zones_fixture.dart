import 'package:flutter/material.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/safe_zones/safe_zones_overview.dart';

import 'dashboard_fixture.dart';

// Synthetic presentation records only. These never connect to an account,
// Firebase, or Google Maps.
Geofence safeZoneFixture({
  String id = 'preview-zone-home',
  String imei = 'demo-watch-a',
  String name = 'Home',
  bool active = true,
  double radius = 150,
}) {
  return Geofence(
    id: id,
    imei: imei,
    name: name,
    active: active,
    lat: -20.1,
    lng: 57.5,
    radiusMeters: radius,
  );
}

GuardianAlert safeZoneAlertFixture({
  String id = 'preview-event',
  String imei = 'demo-watch-a',
  String type = 'geofence_enter',
  String? geofenceId = 'preview-zone-home',
  bool resolved = false,
  DateTime? createdAt,
}) {
  return GuardianAlert(
    id: id,
    imei: imei,
    type: type,
    severity: type == 'sos' ? 'critical' : 'info',
    message: 'Synthetic preview event',
    resolved: resolved,
    createdAt:
        createdAt ?? DateTime.now().subtract(const Duration(minutes: 12)),
    payload: geofenceId == null ? null : {'geofenceId': geofenceId},
  );
}

SafeZonesOverview safeZonesFixtureOverview({
  List<Geofence>? zones,
  List<Device>? devices,
  List<GuardianAlert> alerts = const [],
  Set<String> busyZoneIds = const {},
  bool alertsLoading = false,
  bool alertsUnavailable = false,
  VoidCallback? onAdd,
  ValueChanged<Geofence>? onToggle,
  ValueChanged<Geofence>? onDelete,
  ValueChanged<Geofence>? onExpand,
  VoidCallback? onAlerts,
}) {
  return SafeZonesOverview(
    zones: zones ?? [safeZoneFixture()],
    devices: devices ?? [dashboardFixtureDevice()],
    alerts: alerts,
    busyZoneIds: busyZoneIds,
    alertsLoading: alertsLoading,
    alertsUnavailable: alertsUnavailable,
    onAdd: onAdd ?? () {},
    onToggle: onToggle ?? (_) {},
    onDelete: onDelete ?? (_) {},
    onExpand: onExpand ?? (_) {},
    onAlerts: onAlerts ?? () {},
    mapBuilder: (context, zone) => SafeZoneFixtureMap(zoneId: zone.id),
  );
}

/// Deliberately neutral so review captures cannot be mistaken for map tiles.
class SafeZoneFixtureMap extends StatelessWidget {
  const SafeZoneFixtureMap({super.key, required this.zoneId});

  final String zoneId;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return ColoredBox(
      key: ValueKey('safe-zone-fixture-map-$zoneId'),
      color: colors.surfaceMuted,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text(
            'Preview map\nNo live data',
            textAlign: TextAlign.center,
            style: TextStyle(color: colors.textSecondary, fontSize: 14),
          ),
        ),
      ),
    );
  }
}
