import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

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
    final d = device;
    if (d == null) return const SizedBox.shrink();

    final colors = context.guardianColors;
    const purple = Color(0xFF8058BE);

    final activityIcons = <String, IconData>{
      'Watch signal monitored': Icons.sensors_rounded,
      'Safe-zone check completed': Icons.shield_rounded,
      'Weather checked': Icons.cloud_rounded,
      'Local context analyzed': Icons.radar_rounded,
    };

    final checks = Column(
      children: [
        for (var i = 0; i < activities.length; i++)
          Padding(
            padding: EdgeInsets.only(
              bottom: i == activities.length - 1 ? 0 : 11,
            ),
            child: Row(
              children: [
                Container(
                  width: 30,
                  height: 30,
                  decoration: BoxDecoration(
                    color: purple.withValues(alpha: 0.09),
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Icon(
                    activityIcons[activities[i]] ?? Icons.check_rounded,
                    size: 15,
                    color: purple,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    activities[i],
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );

    final aiPanel = Container(
      constraints: const BoxConstraints(minHeight: 126),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
      decoration: BoxDecoration(
        color: const Color(0xFFF4EDFF),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: purple.withValues(alpha: 0.12)),
      ),
      child: const Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.psychology_alt_rounded, color: purple, size: 27),
          SizedBox(height: 8),
          Text(
            'Guardian AI',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF6D3FB0),
              fontSize: 12,
              fontWeight: FontWeight.w900,
            ),
          ),
          SizedBox(height: 5),
          Text(
            'Quietly checking\nwhat matters.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: Color(0xFF6D3FB0),
              fontSize: 9,
              height: 1.35,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: purple.withValues(alpha: 0.035),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: purple.withValues(alpha: 0.10)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: purple.withValues(alpha: 0.11),
                  borderRadius: BorderRadius.circular(9),
                ),
                child: const Icon(
                  Icons.auto_awesome_rounded,
                  size: 17,
                  color: purple,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'GUARDIAN INTELLIGENCE',
                      style: TextStyle(
                        color: purple,
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                        letterSpacing: .6,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Quietly checking what matters',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 10,
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: GuardianColors.safe.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  '● LIVE',
                  style: TextStyle(
                    color: GuardianColors.safe,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .4,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 15),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth < 500) {
                return checks;
              }
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: 8, child: checks),
                  const SizedBox(width: 16),
                  SizedBox(width: 150, child: aiPanel),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}
