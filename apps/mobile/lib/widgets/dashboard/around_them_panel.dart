import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../theme/app_theme.dart';

/// Around Them — contextual intelligence panel showing location, weather,
/// safe zones, and local context around the wearer.
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
            'AROUND THEM',
            style: textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: colors.textSecondary,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 16),
          _ContextRow(
            label: 'Location',
            value: device!.hasFreshLocation ? 'Located' : 'Locating',
          ),
          const SizedBox(height: 12),
          _ContextRow(label: 'Weather', value: weatherStatus),
          const SizedBox(height: 12),
          _ContextRow(
            label: 'Safe zones',
            value: safeZones.isEmpty
                ? 'No active zones'
                : safeZones.length == 1
                ? '1 zone nearby'
                : '${safeZones.length} zones nearby',
          ),
          const SizedBox(height: 12),
          _ContextRow(label: 'Local context', value: localContext),
          const SizedBox(height: 12),
          _ContextRow(label: 'Guardian AI', value: guardianIntelligence),
        ],
      ),
    );
  }
}

class _ContextRow extends StatelessWidget {
  const _ContextRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 100,
          child: Text(
            label,
            style: textTheme.bodySmall?.copyWith(
              color: colors.textSecondary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: textTheme.bodySmall?.copyWith(color: colors.textPrimary),
            textAlign: TextAlign.end,
          ),
        ),
      ],
    );
  }
}
