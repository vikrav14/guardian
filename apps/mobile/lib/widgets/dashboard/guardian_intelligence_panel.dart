import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Guardian Intelligence panel — premium card showing what Guardian is monitoring
/// with icons and status checks. Matches image 2 design with purple accent.
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

    // Map activity text to icons
    final activityIcons = <String, IconData>{
      'Watch signal monitored': Icons.sensors_rounded,
      'Safe-zone check completed': Icons.shield_rounded,
      'Weather checked': Icons.cloud_rounded,
      'Local context analyzed': Icons.location_city_rounded,
    };

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        color: const Color(0xFF8058BE).withValues(alpha: 0.04),
        border: Border.all(
          color: const Color(0xFF8058BE).withValues(alpha: 0.1),
          width: 1,
        ),
      ),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(8),
                  color: const Color(0xFF8058BE).withValues(alpha: 0.12),
                ),
                child: const Icon(
                  Icons.auto_awesome_rounded,
                  size: 18,
                  color: Color(0xFF8058BE),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'GUARDIAN INTELLIGENCE',
                      style: textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: const Color(0xFF8058BE),
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Quietly checking what matters',
                      style: textTheme.bodySmall?.copyWith(
                        color: colors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...activities.asMap().entries.map(
            (entry) {
              final icon = activityIcons[entry.value] ?? Icons.check_rounded;
              return Padding(
                padding: EdgeInsets.only(
                  bottom: entry.key < activities.length - 1 ? 12 : 0,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        color: const Color(0xFF8058BE).withValues(alpha: 0.1),
                      ),
                      child: Icon(
                        icon,
                        size: 14,
                        color: const Color(0xFF8058BE),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          entry.value,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.textPrimary,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
