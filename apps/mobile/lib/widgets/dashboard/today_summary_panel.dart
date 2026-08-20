import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Today — premium card summary of daily activity and movement patterns.
/// Matches image 2 design with bullet points and better hierarchy.
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
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Icon(Icons.calendar_today, size: 18, color: GuardianColors.safe),
              Text(
                'TODAY',
                style: textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: colors.textSecondary,
                  letterSpacing: 0.5,
                ),
              ),
              const Spacer(),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            dailySummary,
            style: textTheme.bodyMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: colors.textPrimary,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            activityStatus,
            style: textTheme.bodySmall?.copyWith(
              color: colors.textSecondary,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 16),
          Material(
            color: GuardianColors.safe.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(10),
            child: InkWell(
              onTap: onViewJourney,
              borderRadius: BorderRadius.circular(10),
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.arrow_forward_rounded,
                      size: 16,
                      color: GuardianColors.safe,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'View journey',
                      style: textTheme.labelMedium?.copyWith(
                        color: GuardianColors.safe,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
