import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../safe_zones/safe_zone_logic.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/safe_zones/safe_zone_card.dart';
import '../widgets/safe_zones/zone_mini_map.dart';
import '../widgets/safe_zones/zone_status_chip.dart';
import '../widgets/layout/guardian_page_frame.dart';
import 'location_picker_page.dart';

class SafeZonesPage extends StatelessWidget {
  const SafeZonesPage({super.key});

  Future<void> _createZone(BuildContext context, List<Device> devices) async {
    if (devices.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Link a device first')));
      return;
    }

    final nameCtrl = TextEditingController(text: 'Home');
    final radiusCtrl = TextEditingController(text: '150');
    final wifiCtrl = TextEditingController();
    var imei = devices.first.imei;
    LatLng? pickedLocation;

    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setLocal) {
            return AlertDialog(
              title: const Text('Add safe zone'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    DropdownButtonFormField<String>(
                      // ignore: deprecated_member_use
                      value: imei,
                      items: [
                        for (final d in devices)
                          DropdownMenuItem(
                            value: d.imei,
                            child: Text(d.displayName),
                          ),
                      ],
                      onChanged: (v) => setLocal(() => imei = v ?? imei),
                      decoration: const InputDecoration(labelText: 'Device'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: nameCtrl,
                      decoration: const InputDecoration(labelText: 'Zone name'),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: radiusCtrl,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'Radius (meters)',
                      ),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: wifiCtrl,
                      decoration: const InputDecoration(
                        labelText: 'Home WiFi name (optional)',
                        hintText:
                            'Also counts as "inside" if the pendant supports it',
                      ),
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            pickedLocation != null
                                ? 'Center: pinned at ${pickedLocation!.latitude.toStringAsFixed(4)}, '
                                      '${pickedLocation!.longitude.toStringAsFixed(4)}'
                                : "Center: pendant's current location",
                            style: TextStyle(
                              fontSize: 12,
                              color: context.guardianColors.textSecondary,
                            ),
                          ),
                        ),
                        TextButton(
                          onPressed: () async {
                            final device = devices.firstWhere(
                              (d) => d.imei == imei,
                            );
                            final loc = device.location;
                            final initial = loc?.isValid == true
                                ? LatLng(loc!.lat, loc.lng)
                                : const LatLng(-20.2642, 57.4791);
                            final radius =
                                double.tryParse(radiusCtrl.text.trim()) ?? 150;
                            final zoneStyle = styleForCategory(
                              categoryFromZoneName(nameCtrl.text),
                            );
                            final picked = await Navigator.of(ctx).push<LatLng>(
                              MaterialPageRoute(
                                builder: (_) => LocationPickerPage(
                                  initialCenter: initial,
                                  radiusMeters: radius.clamp(50, 5000),
                                  zoneColor: zoneStyle.color,
                                ),
                              ),
                            );
                            if (picked != null) {
                              setLocal(() => pickedLocation = picked);
                            }
                          },
                          child: const Text('Choose on map'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(ctx, false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(ctx, true),
                  child: const Text('Create'),
                ),
              ],
            );
          },
        );
      },
    );

    if (created != true || !context.mounted) {
      nameCtrl.dispose();
      radiusCtrl.dispose();
      wifiCtrl.dispose();
      return;
    }

    double lat;
    double lng;
    if (pickedLocation != null) {
      lat = pickedLocation!.latitude;
      lng = pickedLocation!.longitude;
    } else {
      final device = devices.firstWhere((d) => d.imei == imei);
      final loc = device.location;
      if (loc == null || !loc.isValid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              "Device has no location yet — wait for a GPS update, or use 'Choose on map'.",
            ),
          ),
        );
        nameCtrl.dispose();
        radiusCtrl.dispose();
        wifiCtrl.dispose();
        return;
      }
      lat = loc.lat;
      lng = loc.lng;
    }

    final radius = double.tryParse(radiusCtrl.text.trim()) ?? 150;
    try {
      await GeofenceService().create(
        imei: imei,
        name: nameCtrl.text,
        lat: lat,
        lng: lng,
        radiusMeters: radius.clamp(50, 5000),
        wifiSsid: wifiCtrl.text,
      );
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Safe zone created')));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed: $e')));
      }
    } finally {
      nameCtrl.dispose();
      radiusCtrl.dispose();
      wifiCtrl.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: GuardianPageFrame(
        child: _SafeZonesBody(onCreateZone: _createZone),
      ),
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
  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Device>>(
      stream: DeviceService().watchLinkedDevices(),
      builder: (context, deviceSnap) {
        final devices = deviceSnap.data ?? const <Device>[];

        return StreamBuilder<List<Geofence>>(
          stream: GeofenceService().watchAll(),
          builder: (context, zoneSnap) {
            if (zoneSnap.hasError) {
              return Center(child: Text('${zoneSnap.error}'));
            }
            if (!zoneSnap.hasData || !deviceSnap.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final zones = zoneSnap.data!;

            return StreamBuilder<List<GuardianAlert>>(
              stream: AlertService().watchLinkedAlerts(),
              builder: (context, alertSnap) {
                final alerts = alertSnap.data ?? const <GuardianAlert>[];
                final hero = buildSafeZonesHeroSummary(
                  zones: zones,
                  devices: devices,
                  alerts: alerts,
                );
                final displayZones = <Geofence>[];
                final visibleKeys = <String>{};
                for (final zone in zones) {
                  final key =
                      '${zone.imei}|${zone.name.trim().toLowerCase()}';
                  if (visibleKeys.add(key)) displayZones.add(zone);
                }

                return ListView(
                  padding: const EdgeInsets.fromLTRB(18, 24, 18, 118),
                  children: [
                    GuardianPageHeader(
                      eyebrow: 'PLACES THAT MATTER',
                      title: 'Safe zones',
                      subtitle:
                          'Get a gentle alert when someone arrives or leaves.',
                      action: FilledButton.icon(
                        onPressed: () =>
                            widget.onCreateZone(context, devices),
                        icon: const Icon(Icons.add_rounded, size: 18),
                        label: const Text('Add zone'),
                      ),
                    ),
                    const SizedBox(height: 20),
                    if (displayZones.isEmpty)
                      GuardianEmptyState(
                        icon: Icons.shield_outlined,
                        title: 'Create your first safe zone',
                        message:
                            'Add home, school, or another familiar place. Guardian will gently tell you when someone arrives or leaves.',
                        action: FilledButton.icon(
                          onPressed: () =>
                              widget.onCreateZone(context, devices),
                          icon: const Icon(Icons.add_rounded),
                          label: const Text('Add a safe zone'),
                        ),
                      )
                    else ...[
                      _PrototypeSafeZoneFeature(
                        zone: displayZones.first,
                        device: deviceForZone(displayZones.first, devices),
                        summary: hero,
                      ),
                      const SizedBox(height: 18),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          final columns = constraints.maxWidth >= 900 ? 3 : 1;
                          final gap = 16.0;
                          final width = columns == 1
                              ? constraints.maxWidth
                              : (constraints.maxWidth -
                                      gap * (columns - 1)) /
                                  columns;
                          return Wrap(
                            spacing: gap,
                            runSpacing: gap,
                            children: [
                              for (final zone in displayZones)
                                SizedBox(
                                  width: width,
                                  child: SafeZoneCard(
                                    zone: zone,
                                    devices: devices,
                                    alerts: alerts,
                                    onToggle: () =>
                                        GeofenceService().setActive(
                                      zone.id,
                                      !zone.active,
                                    ),
                                    onDelete: () =>
                                        GeofenceService().delete(zone.id),
                                  ),
                                ),
                            ],
                          );
                        },
                      ),
                    ],
                  ],
                );
              },
            );
          },
        );
      },
    );
  }
}

class _PrototypeSafeZoneFeature extends StatelessWidget {
  const _PrototypeSafeZoneFeature({
    required this.zone,
    required this.device,
    required this.summary,
  });

  final Geofence zone;
  final Device? device;
  final SafeZonesHeroSummary summary;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final copy = Container(
      padding: const EdgeInsets.fromLTRB(32, 30, 32, 28),
      color: colors.surface.withValues(alpha: 0.97),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ZoneStatusChip(status: summary.tone),
          const SizedBox(height: 14),
          Text(
            zone.name,
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 28,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.8,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            '${zone.radiusMeters.round()} m radius',
            style: TextStyle(color: colors.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 16),
          Text(
            summary.detail,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ],
      ),
    );

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: colors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.09),
            blurRadius: 38,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 680) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                ZoneMiniMapPreview(
                  zone: zone,
                  device: device,
                  height: 250,
                ),
                copy,
              ],
            );
          }
          return SizedBox(
            height: 300,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 3,
                  child: ZoneMiniMapPreview(
                    zone: zone,
                    device: device,
                    height: 300,
                  ),
                ),
                Expanded(flex: 2, child: copy),
              ],
            ),
          );
        },
      ),
    );
  }
}
