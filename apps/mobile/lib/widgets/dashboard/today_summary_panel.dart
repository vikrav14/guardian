import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Today — summary of daily activity and movement patterns.
class TodaySummaryPanel extends StatelessWidget {
  const TodaySummaryPanel({
    required this.device,
    required this.dailySummary,
    required this.activityStatus,
    this.onViewJourney,
    super.key,
  });

  final Device? device;
  final String dailySummary;
  final String activityStatus;
  final VoidCallback? onViewJourney;

  @override
  Widget build(BuildContext context) {
    if (device == null) return const SizedBox.shrink();

    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: colors.surface,
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.2),
          width: 1,
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'TODAY',
            style: textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colors.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 16),
          Text(
            dailySummary,
            style: textTheme.bodyMedium?.copyWith(color: colors.textPrimary),
          ),
          const SizedBox(height: 12),
          Text(
            activityStatus,
            style: textTheme.bodySmall?.copyWith(color: colors.textSecondary),
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: Material(
              color: GuardianColors.forest.withValues(alpha: 0.08),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                onTap: onViewJourney,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'View journey',
                    textAlign: TextAlign.center,
                    style: textTheme.labelMedium?.copyWith(
                      color: GuardianColors.forest,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
