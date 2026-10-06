import 'package:flutter/material.dart';

import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/safe_zones/safe_zone_map.dart';
import '../widgets/safe_zones/safe_zones_overview.dart';
import '../navigation/home_shell_scope.dart';
import '../widgets/layout/guardian_page_frame.dart';
import 'safe_zone_editor_page.dart';
import 'home_wifi_setup_page.dart';

class SafeZonesPage extends StatelessWidget {
  const SafeZonesPage({super.key});

  Future<void> _createZone(BuildContext context, List<Device> devices) async {
    if (devices.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Link a device first')));
      return;
    }

    final created = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => SafeZoneEditorPage(
          devices: devices,
          onCreate: (zone) => GeofenceService().create(
            imei: zone.imei,
            name: zone.name,
            lat: zone.lat,
            lng: zone.lng,
            radiusMeters: zone.radiusMeters,
          ),
        ),
      ),
    );
    if (created == true && context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Safe zone created')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: GuardianPageFrame(child: _SafeZonesBody(onCreateZone: _createZone)),
    );
  }
}

class _SafeZonesBody extends StatefulWidget {
  const _SafeZonesBody({required this.onCreateZone});

  final Future<void> Function(BuildContext context, List<Device> devices)
  onCreateZone;

  @override
  State<_SafeZonesBody> createState() => _SafeZonesBodyState();
}

class _SafeZonesBodyState extends State<_SafeZonesBody> {
  late final _devices = DeviceService().watchLinkedDevices();
  late final _zones = GeofenceService().watchAll();
  late final _alerts = AlertService().watchLinkedAlerts();
  final _busyZoneIds = <String>{};

  Future<void> _changeZone(Geofence zone, {bool delete = false}) async {
    if (_busyZoneIds.contains(zone.id)) return;
    setState(() => _busyZoneIds.add(zone.id));
    try {
      if (delete) {
        final confirmed = await confirmSafeZoneDeletion(context, zone);
        if (!confirmed || !mounted) return;
        await GeofenceService().delete(zone.id);
      } else {
        await GeofenceService().setActive(zone.id, !zone.active);
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            delete
                ? 'Safe zone deleted'
                : zone.active
                ? 'Safe zone paused'
                : 'Safe zone activated',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not update this zone. Please try again.'),
        ),
      );
    } finally {
      if (mounted) setState(() => _busyZoneIds.remove(zone.id));
    }
  }

  void _expandMap(Geofence zone) {
    Navigator.of(context).push<void>(
      MaterialPageRoute(
        builder: (context) => Scaffold(
          appBar: AppBar(title: Text(zone.name)),
          body: SafeArea(
            top: false,
            child: Column(
              children: [
                Expanded(child: SafeZoneMap(zone: zone, expanded: true)),
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    'Saved zone boundary · ${zone.radiusMeters.round()} m radius',
                    style: TextStyle(
                      color: context.guardianColors.textSecondary,
                      fontSize: 14,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _readError() => const Center(
    child: Padding(
      padding: EdgeInsets.all(24),
      child: Text(
        'Safe zones are unavailable. Check your connection and reopen this page.',
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Device>>(
      stream: _devices,
      builder: (context, deviceSnap) {
        if (deviceSnap.hasError) return _readError();
        final devices = deviceSnap.data ?? const <Device>[];
        return StreamBuilder<List<Geofence>>(
          stream: _zones,
          builder: (context, zoneSnap) {
            if (zoneSnap.hasError) return _readError();
            if (!zoneSnap.hasData || !deviceSnap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            return StreamBuilder<List<GuardianAlert>>(
              stream: _alerts,
              builder: (context, alertSnap) {
                final home = HomeShellScope.maybeOf(context);
                return SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(16, 24, 16, 24),
                  child: SafeZonesOverview(
                    zones: zoneSnap.data!,
                    devices: devices,
                    alerts: alertSnap.data ?? const [],
                    alertsLoading: !alertSnap.hasData && !alertSnap.hasError,
                    alertsUnavailable: alertSnap.hasError,
                    busyZoneIds: _busyZoneIds,
                    // IndexedStack retains pages. Avoid loading an off-screen
                    // Maps platform view while another primary tab is active.
                    mapBuilder: home != null && home.currentIndex != 1
                        ? (_, _) => const SizedBox.shrink()
                        : null,
                    onAdd: () => widget.onCreateZone(context, devices),
                    onToggle: (zone) => _changeZone(zone),
                    onDelete: (zone) => _changeZone(zone, delete: true),
                    onExpand: _expandMap,
                    onHomeWifi: (zone) => Navigator.of(context).push<void>(
                      MaterialPageRoute(
                        builder: (_) => HomeWifiSetupPage(zone: zone),
                      ),
                    ),
                    onAlerts: home == null ? null : () => home.goToTab(4),
                  ),
                );
              },
            );
          },
        );
      },
    );
  }
}
