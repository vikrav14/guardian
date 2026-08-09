import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../theme/app_theme.dart';

/// Around Them — premium 4-card grid showing location, weather, safe zones,
/// and local context around the wearer. Matches image 2 design.
class AroundThemPanel extends StatelessWidget {
  const AroundThemPanel({
    required this.device,
    required this.geofences,
    required this.weatherStatus,
    required this.localContext,
    required this.guardianIntelligence,
    super.key,
  });

  final Device? device;
  final List<Geofence> geofences;
  final String weatherStatus;
  final String localContext;
  final String guardianIntelligence;

  @override
  Widget build(BuildContext context) {
    if (device == null) return const SizedBox.shrink();

    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final safeZones = geofences
        .where((z) => z.imei == device!.imei && z.active)
        .toList();

    final locationText = device!.hasFreshLocation ? 'Located' : 'Locating';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'AROUND THEM',
            style: textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colors.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _ContextCard(
                icon: Icons.location_on_rounded,
                color: GuardianColors.accent,
                title: 'Location',
                value: locationText,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _ContextCard(
                icon: Icons.cloud_rounded,
                color: const Color(0xFF4AADD6),
                title: 'Weather',
                value: weatherStatus,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _ContextCard(
                icon: Icons.shield_rounded,
                color: const Color(0xFF9C6BA8),
                title: 'Safe zone',
                value: safeZones.isEmpty ? 'No active' : 'Inside safe zone',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _ContextCard(
                icon: Icons.info_outline_rounded,
                color: const Color(0xFFF4A460),
                title: 'Local context',
                value: localContext,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _ContextCard extends StatelessWidget {
  const _ContextCard({
    required this.icon,
    required this.color,
    required this.title,
    required this.value,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;

    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: color.withValues(alpha: 0.08),
        border: Border.all(
          color: color.withValues(alpha: 0.15),
          width: 1,
        ),
      ),
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              color: color.withValues(alpha: 0.12),
            ),
            child: Icon(icon, size: 18, color: color),
          ),
          const SizedBox(height: 10),
          Text(
            title,
            style: textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: colors.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: textTheme.bodySmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: colors.textPrimary,
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }
}
