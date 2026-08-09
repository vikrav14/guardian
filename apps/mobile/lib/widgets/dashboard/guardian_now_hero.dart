import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Guardian Now hero section — top-of-dashboard status summary.
///
/// Shows: person name, place, connectivity state, battery, last update,
/// and one-line AI interpretation summarizing device + context health.
class GuardianNowHero extends StatelessWidget {
  const GuardianNowHero({
    required this.device,
    required this.aiInterpretation,
    super.key,
  });

  final Device? device;
  final String aiInterpretation;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;

    if (device == null) {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          color: colors.surface,
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
        child: Center(
          child: Column(
            children: [
              Text(
                'No watch linked',
                style: textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Link a device to see its status',
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      );
    }

    // ignore: unnecessary_non_null_assertion
    final d = device!;
    final isLive = d.connectionState == 'live';
    final isReconnecting = d.connectionState == 'connecting';
    final isOffline = !isLive && !isReconnecting;
    final hasLocation = d.hasFreshLocation || d.hasApproximateLocation;
    // ignore: dead_code, dead_null_aware_expression
    final displayName = d.displayName ?? 'Device';

    String statusText;
    Color statusColor;
    if (isReconnecting) {
      statusText = 'Connecting';
      statusColor = GuardianColors.warning;
    } else if (isLive) {
      statusText = 'Live';
      statusColor = GuardianColors.safe;
    } else {
      statusText = 'Offline';
      statusColor = GuardianColors.textMuted;
    }

    final locationText = isOffline && hasLocation
        ? 'Last known location'
        : (hasLocation ? 'Current location' : 'Locating...');

    final battery = d.batteryPercent;
    final batteryText = battery != null
        ? '$battery% battery'
        : 'Battery unknown';

    final lastUpdate = d.lastHeartbeatAt;
    String updateText;
    if (lastUpdate == null) {
      updateText = 'Never connected';
    } else {
      final now = DateTime.now();
      final diff = now.difference(lastUpdate);
      if (diff.inMinutes < 1) {
        updateText = 'Updated just now';
      } else if (diff.inMinutes < 60) {
        updateText = 'Updated ${diff.inMinutes}m ago';
      } else if (diff.inHours < 24) {
        updateText = 'Updated ${diff.inHours}h ago';
      } else {
        updateText = 'Updated ${diff.inDays}d ago';
      }
    }

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: colors.surface,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header: Name + Status
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      displayName,
                      style: textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: colors.textPrimary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      locationText,
                      style: textTheme.bodyMedium?.copyWith(
                        color: colors.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  color: statusColor.withValues(alpha: 0.12),
                ),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Text(
                  statusText,
                  style: textTheme.labelMedium?.copyWith(
                    color: statusColor,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Status strip: compact telemetry
          Row(
            children: [
              Expanded(
                child: Text(
                  '● $batteryText · $updateText',
                  style: textTheme.bodySmall?.copyWith(
                    color: colors.textSecondary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),

          // Guardian AI interpretation
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              color: GuardianColors.forest.withValues(alpha: 0.04),
              border: Border.all(
                color: GuardianColors.forest.withValues(alpha: 0.1),
                width: 1,
              ),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              children: [
                Text(
                  'Guardian AI',
                  style: textTheme.labelSmall?.copyWith(
                    color: colors.textSecondary,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    aiInterpretation,
                    style: textTheme.bodySmall?.copyWith(
                      color: colors.textPrimary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
