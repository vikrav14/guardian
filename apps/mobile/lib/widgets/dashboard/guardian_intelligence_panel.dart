import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Guardian Intelligence panel — shows what Guardian is monitoring
/// and AI interpretation activities happening quietly in background.
class GuardianIntelligencePanel extends StatelessWidget {
  const GuardianIntelligencePanel({
    required this.device,
    required this.activities,
    super.key,
  });

  final Device? device;
  final List<String> activities;

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
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'GUARDIAN INTELLIGENCE',
                style: textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: colors.textSecondary,
                  letterSpacing: 0.5,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Quietly checking what matters',
                style: textTheme.bodySmall?.copyWith(
                  color: colors.textSecondary,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...activities
              .asMap()
              .entries
              .map(
                (entry) => Padding(
                  padding: EdgeInsets.only(
                    bottom: entry.key < activities.length - 1 ? 12 : 0,
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 4, right: 10),
                        child: Text(
                          '●',
                          style: textTheme.bodySmall?.copyWith(
                            color: GuardianColors.safe,
                          ),
                        ),
                      ),
                      Expanded(
                        child: Text(
                          entry.value,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.textPrimary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
        ],
      ),
    );
  }
}
