import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/guardian_widgets.dart';
import 'location_picker_page.dart';

class SafeZonesPage extends StatelessWidget {
  const SafeZonesPage({super.key});

  IconData _iconFor(String name) {
    final lower = name.toLowerCase();
    if (lower.contains('school')) return Icons.school_outlined;
    if (lower.contains('grand') || lower.contains('heart')) {
      return Icons.favorite_border;
    }
    return Icons.home_outlined;
  }

  (Color, Color) _iconColors(String name) {
    final lower = name.toLowerCase();
    if (lower.contains('school')) {
      return (GuardianColors.accent, GuardianColors.accentBg);
    }
    if (lower.contains('grand')) {
      return (const Color(0xFF993556), const Color(0xFFFBEAF0));
    }
    return (GuardianColors.safe, GuardianColors.safeBg);
  }

  Future<void> _createZone(BuildContext context, List<Device> devices) async {
    if (devices.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Link a device first')),
      );
      return;
    }

    final nameCtrl = TextEditingController(text: 'Home');
    final radiusCtrl = TextEditingController(text: '150');
    var imei = devices.first.imei;
    LatLng? pickedLocation;

    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setLocal) {
            return AlertDialog(
              title: const Text('Add safe zone'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    // ignore: deprecated_member_use
                    value: imei,
                    items: [
                      for (final d in devices)
                        DropdownMenuItem(value: d.imei, child: Text(d.displayName)),
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
                    decoration: const InputDecoration(labelText: 'Radius (meters)'),
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
                          style: const TextStyle(fontSize: 12, color: GuardianColors.textSecondary),
                        ),
                      ),
                      TextButton(
                        onPressed: () async {
                          final device = devices.firstWhere((d) => d.imei == imei);
                          final loc = device.location;
                          final initial = loc?.isValid == true
                              ? LatLng(loc!.lat, loc.lng)
                              : const LatLng(-20.2642, 57.4791);
                          final picked = await Navigator.of(ctx).push<LatLng>(
                            MaterialPageRoute(
                              builder: (_) => LocationPickerPage(initialCenter: initial),
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
              actions: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Create')),
              ],
            );
          },
        );
      },
    );

    if (created != true || !context.mounted) {
      nameCtrl.dispose();
      radiusCtrl.dispose();
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
      );
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Safe zone created')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    } finally {
      nameCtrl.dispose();
      radiusCtrl.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      body: SafeArea(
        child: StreamBuilder<List<Device>>(
          stream: DeviceService().watchLinkedDevices(),
          builder: (context, deviceSnap) {
            final devices = deviceSnap.data ?? <Device>[];

            return StreamBuilder<List<Geofence>>(
              stream: GeofenceService().watchAll(),
              builder: (context, zoneSnap) {
                if (zoneSnap.hasError) {
                  return Center(child: Text('${zoneSnap.error}'));
                }
                if (!zoneSnap.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }

                final zones = zoneSnap.data!;
                return ListView(
                  padding: const EdgeInsets.fromLTRB(16, 18, 16, 16),
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Safe zones',
                                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w600),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${zones.length} zone${zones.length == 1 ? '' : 's'} · get notified on exit',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: GuardianColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Material(
                          color: GuardianColors.safe,
                          shape: const CircleBorder(),
                          child: InkWell(
                            customBorder: const CircleBorder(),
                            onTap: () => _createZone(context, devices),
                            child: const SizedBox(
                              width: 34,
                              height: 34,
                              child: Icon(Icons.add, color: Colors.white, size: 18),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    if (zones.isEmpty)
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: GuardianColors.surface,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: const Text(
                          'No safe zones yet. Create a radius around home, school, or another place you care about.',
                          style: TextStyle(color: GuardianColors.textSecondary),
                        ),
                      )
                    else
                      for (final zone in zones) ...[
                        _ZoneCard(
                          zone: zone,
                          devices: devices,
                          icon: _iconFor(zone.name),
                          iconColor: _iconColors(zone.name).$1,
                          iconBg: _iconColors(zone.name).$2,
                          onToggle: () => GeofenceService().setActive(zone.id, !zone.active),
                          onDelete: () => GeofenceService().delete(zone.id),
                        ),
                        const SizedBox(height: 10),
                      ],
                    const SizedBox(height: 6),
                    OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                      ),
                      onPressed: () => _createZone(context, devices),
                      child: const Text('Add a new safe zone'),
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _ZoneCard extends StatelessWidget {
  const _ZoneCard({
    required this.zone,
    required this.devices,
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.onToggle,
    required this.onDelete,
  });

  final Geofence zone;
  final List<Device> devices;
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final VoidCallback onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final linked = devices.where((d) => d.imei == zone.imei).toList();
    final subtitle =
        '${zone.radiusMeters.round()} m radius${zone.active ? '' : ' · paused'}'
        '${linked.isNotEmpty ? ' · ${linked.first.displayName}' : ''}';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: GuardianColors.surface,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(12),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 19, color: iconColor),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  zone.name,
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 1),
                Text(
                  subtitle,
                  style: const TextStyle(fontSize: 12, color: GuardianColors.textSecondary),
                ),
              ],
            ),
          ),
          if (linked.isNotEmpty)
            AvatarBubble(
              initials: initialsFor(linked.first.displayName),
              color: avatarColorForKey(linked.first.imei),
              size: 22,
            ),
          PopupMenuButton<String>(
            onSelected: (v) {
              if (v == 'toggle') onToggle();
              if (v == 'delete') onDelete();
            },
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'toggle',
                child: Text(zone.active ? 'Pause' : 'Activate'),
              ),
              const PopupMenuItem(value: 'delete', child: Text('Delete')),
            ],
          ),
        ],
      ),
    );
  }
}
