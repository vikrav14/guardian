import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../safe_zones/safe_zone_logic.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/safe_zones/safe_zone_card.dart';
import '../widgets/safe_zones/safe_zones_hero.dart';
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
      body: SafeArea(
        child: GuardianPageFrame(
          child: _SafeZonesBody(onCreateZone: _createZone),
        ),
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

                return Stack(
                  children: [
                    ListView(
                      padding: const EdgeInsets.fromLTRB(
                        GuardianSpacing.md,
                        GuardianSpacing.lg,
                        GuardianSpacing.md,
                        88,
                      ),
                      children: [
                        SafeZonesHero(summary: hero),
                        const SizedBox(height: GuardianSpacing.md),
                        if (zones.isEmpty)
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
                        else
                          for (final zone in zones) ...[
                            SafeZoneCard(
                              zone: zone,
                              devices: devices,
                              alerts: alerts,
                              onToggle: () => GeofenceService().setActive(
                                zone.id,
                                !zone.active,
                              ),
                              onDelete: () => GeofenceService().delete(zone.id),
                            ),
                            const SizedBox(height: GuardianSpacing.sm),
                          ],
                      ],
                    ),
                    Positioned(
                      right: GuardianSpacing.md,
                      bottom: GuardianSpacing.md,
                      child: FloatingActionButton(
                        onPressed: () =>
                            widget.onCreateZone(context, devices),
                        backgroundColor: context.guardianColors.accent,
                        foregroundColor: Theme.of(context).colorScheme.onPrimary,
                        child: const Icon(Icons.add),
                      ),
                    ),
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
