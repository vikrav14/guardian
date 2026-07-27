import 'package:flutter/material.dart';

import '../../models/alert.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';
import '../cards/guardian_card.dart';
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
      padding: const EdgeInsets.all(18),
      radius: 20,
      elevation: 2,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: category.background,
              borderRadius: BorderRadius.circular(16),
            ),
            alignment: Alignment.center,
            child: Icon(category.icon, size: 24, color: category.color),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  zone.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${category.label} • ${zone.radiusMeters.round()} m',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10,
                    color: colors.textSecondary,
                  ),
                ),
                const SizedBox(height: 7),
                Row(
                  children: [
                    Flexible(child: ZoneStatusChip(status: status)),
                    if (occupants.isNotEmpty) ...[
                      const SizedBox(width: 7),
                      Flexible(
                        child: Text(
                          occupants.map((d) => d.displayName).join(', '),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: GuardianColors.safe,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            icon: Icon(
              Icons.more_horiz_rounded,
              size: 20,
              color: colors.textMuted,
            ),
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
    );
  }
}
