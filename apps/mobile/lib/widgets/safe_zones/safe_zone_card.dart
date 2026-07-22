import 'package:flutter/material.dart';

import '../../models/alert.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';
import '../../widgets/guardian_widgets.dart';
import '../cards/guardian_card.dart';
import 'zone_mini_map.dart';
import 'zone_status_chip.dart';

class SafeZoneCard extends StatelessWidget {
  const SafeZoneCard({
    super.key,
    required this.zone,
    required this.devices,
    required this.alerts,
    required this.onToggle,
    required this.onDelete,
  });

  final Geofence zone;
  final List<Device> devices;
  final List<GuardianAlert> alerts;
  final VoidCallback onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final category = styleForZone(zone);
    final occupants = occupantsForZone(zone, devices);
    final device = deviceForZone(zone, devices);
    final status = resolveZoneStatus(
      zone: zone,
      device: device,
      alerts: alerts,
    );

    return GuardianCard(
      padding: const EdgeInsets.all(GuardianSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 112,
                child: ZoneMiniMapPreview(
                  zone: zone,
                  device: device,
                  height: 88,
                ),
              ),
              const SizedBox(width: GuardianSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 28,
                          height: 28,
                          decoration: BoxDecoration(
                            color: category.background,
                            borderRadius:
                                BorderRadius.circular(GuardianRadius.small),
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            category.icon,
                            size: 16,
                            color: category.color,
                          ),
                        ),
                        const SizedBox(width: GuardianSpacing.xs),
                        Expanded(
                          child: Text(
                            zone.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        PopupMenuButton<String>(
                          icon: const Icon(Icons.more_vert, size: 20),
                          onSelected: (value) {
                            if (value == 'toggle') onToggle();
                            if (value == 'delete') onDelete();
                          },
                          itemBuilder: (_) => [
                            PopupMenuItem(
                              value: 'toggle',
                              child: Text(zone.active ? 'Pause' : 'Activate'),
                            ),
                            const PopupMenuItem(
                              value: 'delete',
                              child: Text('Delete'),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: GuardianSpacing.xxs),
                    Text(
                      category.label,
                      style: TextStyle(
                        fontSize: 11,
                        color: colors.textSecondary,
                      ),
                    ),
                    if (occupants.isNotEmpty) ...[
                      const SizedBox(height: GuardianSpacing.xs),
                      _OccupantRow(devices: occupants),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: GuardianSpacing.sm),
          Wrap(
            spacing: GuardianSpacing.xs,
            runSpacing: GuardianSpacing.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ZoneStatusChip(status: status),
              _MetaChip(
                icon: Icons.radio_button_unchecked,
                label: '${zone.radiusMeters.round()} m',
              ),
              _MetaChip(
                icon: Icons.login_rounded,
                label: lastEnteredLabel(zone, alerts),
              ),
            ],
          ),
          const SizedBox(height: GuardianSpacing.xxs),
          Text(
            zoneUpdatedLabel(device),
            style: TextStyle(
              fontSize: 11,
              color: colors.textMuted,
            ),
          ),
          if (zone.wifiSsid != null && zone.wifiSsid!.isNotEmpty) ...[
            const SizedBox(height: GuardianSpacing.xxs),
            Text(
              'WiFi "${zone.wifiSsid}"',
              style: TextStyle(
                fontSize: 11,
                color: colors.textSecondary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _OccupantRow extends StatelessWidget {
  const _OccupantRow({required this.devices});

  final List<Device> devices;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: GuardianSpacing.xs,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (final device in devices.take(3))
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AvatarBubble(
                initials: initialsFor(device.displayName),
                color: avatarColorForKey(device.imei),
                size: 22,
                imageUrl: device.avatarUrl,
              ),
              const SizedBox(width: 4),
              Text(
                device.displayName,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
      ],
    );
  }
}

class _MetaChip extends StatelessWidget {
  const _MetaChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: GuardianSpacing.xs,
        vertical: GuardianSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(GuardianRadius.pill),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: colors.textSecondary),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              color: colors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}
