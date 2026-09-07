import 'package:flutter/material.dart';

import '../dashboard/alert_formatters.dart';
import '../models/alert.dart';
import '../models/device.dart';
import '../theme/app_theme.dart';

class AlertRow extends StatelessWidget {
  const AlertRow({
    super.key,
    required this.alert,
    required this.device,
    required this.selected,
    required this.onTap,
  });

  final GuardianAlert alert;
  final Device? device;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final type = alert.type.toLowerCase();
    final danger =
        const {'sos', 'fall'}.contains(type) ||
        alert.severity.toLowerCase() == 'critical';
    final tone = danger
        ? GuardianColors.danger
        : type == 'geofence_enter'
        ? colors.accent
        : colors.textSecondary;
    final icon = switch (type) {
      'sos' || 'fall' => Icons.warning_amber_rounded,
      'geofence_enter' => Icons.home_outlined,
      'geofence_exit' => Icons.location_on_outlined,
      'low_battery' => Icons.battery_1_bar_rounded,
      'offline' => Icons.wifi_off_rounded,
      _ => Icons.notifications_outlined,
    };
    return Material(
      color: selected ? colors.accentMuted : colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: selected ? colors.accent : colors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: Semantics(
        selected: selected,
        child: InkWell(
          key: ValueKey('alert-row-${alert.id}'),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(15),
            child: Row(
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: tone.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icon, color: tone, size: 20),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        alertDisplayTitle(alert, device: device),
                        style: TextStyle(
                          color: colors.textPrimary,
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        alertDisplaySubtitle(alert, device: device),
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.chevron_right_rounded,
                  color: colors.textSecondary,
                  size: 19,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
