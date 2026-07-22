import 'package:flutter/material.dart';

import '../../dashboard/dashboard_status_colors.dart';
import '../../dashboard/device_card_visibility.dart';
import '../../dashboard/device_formatters.dart';
import '../../models/alert.dart';
import '../../models/device.dart';
import '../../theme/app_theme.dart';
import '../cards/guardian_card.dart';
import '../guardian_widgets.dart';

/// Floating person/device card on the map — expandable or a minimized chip.
class SmartDeviceMapCard extends StatelessWidget {
  const SmartDeviceMapCard({
    super.key,
    required this.device,
    required this.updated,
    required this.onOpen,
    required this.minimized,
    required this.onMinimize,
    required this.onExpand,
    this.alerts = const [],
  });

  final Device device;
  final String updated;
  final VoidCallback onOpen;
  final bool minimized;
  final VoidCallback onMinimize;
  final VoidCallback onExpand;
  final List<GuardianAlert> alerts;

  bool get _statusNormal =>
      deviceMapCardStatusNormal(device, alerts: alerts);

  @override
  Widget build(BuildContext context) {
    if (minimized) {
      return _MinimizedDeviceChip(
        key: const ValueKey('smart-device-map-chip'),
        device: device,
        onExpand: onExpand,
      );
    }
    return _ExpandedDeviceCard(
      key: const ValueKey('smart-device-map-card'),
      device: device,
      updated: updated,
      onOpen: onOpen,
      onMinimize: onMinimize,
      showAllGoodHint: _statusNormal,
    );
  }
}

class _MinimizedDeviceChip extends StatelessWidget {
  const _MinimizedDeviceChip({
    super.key,
    required this.device,
    required this.onExpand,
  });

  final Device device;
  final VoidCallback onExpand;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Semantics(
      button: true,
      label: '${device.displayName}, tap to expand status',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onExpand,
          borderRadius: BorderRadius.circular(999),
          child: GuardianCard(
            glass: true,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            radius: 999,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    AvatarBubble(
                      initials: initialsFor(device.displayName),
                      color: avatarColorForKey(device.imei),
                      size: 34,
                      imageUrl: device.avatarUrl,
                    ),
                    Positioned(
                      right: -1,
                      bottom: -1,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: device.online ? colors.accent : colors.textMuted,
                          shape: BoxShape.circle,
                          border: Border.all(color: colors.surface, width: 1.5),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 6),
                Icon(
                  Icons.unfold_more_rounded,
                  size: 16,
                  color: colors.textSecondary,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ExpandedDeviceCard extends StatelessWidget {
  const _ExpandedDeviceCard({
    super.key,
    required this.device,
    required this.updated,
    required this.onOpen,
    required this.onMinimize,
    required this.showAllGoodHint,
  });

  final Device device;
  final String updated;
  final VoidCallback onOpen;
  final VoidCallback onMinimize;
  final bool showAllGoodHint;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final batteryMetric = flagMetricColors(
      DashboardFlagMetric.battery,
      dashboardBatteryHealthy(device.batteryPercent),
    );
    return Material(
      color: colors.surface.withValues(alpha: 0.96),
      borderRadius: BorderRadius.circular(18),
      elevation: 6,
      shadowColor: colors.textPrimary.withValues(alpha: 0.15),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: device.online ? colors.accent : colors.textMuted,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  device.online ? 'Live' : 'Offline',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: device.online ? colors.accent : colors.textMuted,
                  ),
                ),
                const Spacer(),
                PopupMenuButton<String>(
                  tooltip: 'Card options',
                  padding: EdgeInsets.zero,
                  icon: Icon(
                    Icons.more_horiz_rounded,
                    size: 18,
                    color: colors.textSecondary,
                  ),
                  onSelected: (value) {
                    if (value == 'minimize') onMinimize();
                  },
                  itemBuilder: (context) => const [
                    PopupMenuItem(
                      value: 'minimize',
                      child: Text('Hide for now'),
                    ),
                  ],
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                  tooltip: 'Minimize',
                  onPressed: onMinimize,
                  icon: Icon(
                    Icons.expand_more_rounded,
                    size: 20,
                    color: colors.textSecondary,
                  ),
                ),
              ],
            ),
            if (showAllGoodHint)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  'All good — hide when you do not need this',
                  style: TextStyle(
                    fontSize: 9,
                    color: colors.textMuted,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            Row(
              children: [
                AvatarBubble(
                  initials: initialsFor(device.displayName),
                  color: avatarColorForKey(device.imei),
                  size: 38,
                  imageUrl: device.avatarUrl,
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    device.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Icon(
                  Icons.star_border_rounded,
                  size: 18,
                  color: colors.textSecondary,
                ),
              ],
            ),
            if (device.displayName != device.relationshipLabel)
              Text(
                device.relationshipLabel,
                style: TextStyle(
                  fontSize: 10,
                  color: colors.textSecondary,
                ),
              ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  deviceMovementLabel(device),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: device.isMoving
                        ? colors.accent
                        : device.online
                            ? colors.textSecondary
                            : colors.textMuted,
                  ),
                ),
                if (device.isMoving && device.speedKmh != null) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Text(
                      '•',
                      style: TextStyle(color: colors.textMuted),
                    ),
                  ),
                  Text(
                    '${device.speedKmh} km/h',
                    style: TextStyle(
                      fontSize: 10,
                      color: colors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
            Text(
              updated,
              style: TextStyle(
                fontSize: 9,
                color: colors.textMuted,
              ),
            ),
            Divider(height: 16, color: colors.border),
            Row(
              children: [
                Icon(
                  Icons.battery_5_bar_rounded,
                  size: 15,
                  color: batteryMetric.foreground,
                ),
                const SizedBox(width: 5),
                Text(
                  device.batteryPercent == null
                      ? 'Battery unavailable'
                      : '${device.batteryPercent}% Battery',
                  style: TextStyle(
                    fontSize: 10,
                    color: colors.textSecondary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 9),
            SizedBox(
              width: double.infinity,
              height: 34,
              child: FilledButton(
                onPressed: onOpen,
                style: FilledButton.styleFrom(
                  elevation: 0,
                  backgroundColor: colors.accentMuted,
                  foregroundColor: colors.textPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'View details',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Icon(
                      Icons.chevron_right_rounded,
                      size: 16,
                      color: colors.accent,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
