import 'package:flutter/material.dart';

import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';
import '../cards/guardian_card.dart';
import 'zone_status_chip.dart';

class SafeZonesHero extends StatelessWidget {
  const SafeZonesHero({super.key, required this.summary});

  final SafeZonesHeroSummary summary;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final toneStyle = styleForStatus(summary.tone);

    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Safe zones',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: GuardianSpacing.xxs),
                    Text(
                      '${summary.activeZoneCount} active · ${summary.totalZoneCount} total',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
              ZoneStatusChip(status: summary.tone),
            ],
          ),
          const SizedBox(height: GuardianSpacing.sm),
          Text(
            summary.headline,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: toneStyle.foreground,
            ),
          ),
          const SizedBox(height: GuardianSpacing.xxs),
          Text(
            summary.detail,
            style: TextStyle(fontSize: 13, color: colors.textSecondary),
          ),
          if (summary.lastEventLabel != null) ...[
            const SizedBox(height: GuardianSpacing.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(GuardianSpacing.sm),
              decoration: BoxDecoration(
                color: colors.surfaceMuted,
                borderRadius: BorderRadius.circular(GuardianRadius.medium),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    summary.lastEventLabel!,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (summary.lastEventAt != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      relativeTimeLabel(summary.lastEventAt),
                      style: TextStyle(fontSize: 11, color: colors.textMuted),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
