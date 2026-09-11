import 'package:flutter/material.dart';

import '../../models/care_profile.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../dashboard/device_formatters.dart';
import '../../theme/app_theme.dart';

class AroundThemPanel extends StatelessWidget {
  const AroundThemPanel({
    required this.device,
    required this.geofences,
    required this.guardianIntelligence,
    required this.guardianAiEnabled,
    required this.careEnabled,
    required this.medicationEnabled,
    super.key,
  });

  final Device? device;
  final List<Geofence> geofences;
  final String guardianIntelligence;
  final bool guardianAiEnabled;
  final bool careEnabled;
  final bool medicationEnabled;

  @override
  Widget build(BuildContext context) {
    final d = device;
    if (d == null) return const SizedBox.shrink();

    final colors = context.guardianColors;
    final profile = GuardianCareProfileX.fromValue(d.careProfile);
    final safeZones = geofences
        .where((zone) => zone.imei == d.imei && zone.active)
        .toList(growable: false);

    final place = d.mapDisplayLocation?.placeLabel?.trim();
    final locationValue = d.hasHomeWifiConflict
        ? 'Location uncertain'
        : place != null && place.isNotEmpty
        ? place
        : d.isDisplayingRetainedSatelliteLocation
        ? 'Last satellite location'
        : d.hasFreshLocation
        ? 'Location confirmed'
        : d.displayLocation?.isValid == true
        ? 'Last known location'
        : 'Locating';

    final locationDetail = d.hasHomeWifiConflict
        ? 'Home Wi-Fi detected · GPS does not confirm Home'
        : d.hasHomeWifiDisplay
        ? deviceHomeWifiFixLabel(d)
        : d.isDisplayingRetainedSatelliteLocation
        ? 'Precise GPS unavailable indoors'
        : d.hasApproximateLocation
        ? 'Approximate network fix'
        : d.hasFreshLocation
        ? 'Satellite GPS fix'
        : 'Last known fix';

    final cards = <Widget>[
      _ContextCard(
        icon: Icons.location_on_rounded,
        color: GuardianColors.accent,
        title: 'Location',
        value: locationValue,
        detail: locationDetail,
      ),
      _ContextCard(
        icon: Icons.shield_rounded,
        color: safeZones.isEmpty
            ? const Color(0xFF7E8B86)
            : GuardianColors.safe,
        title: 'Safe zone',
        value: safeZones.isEmpty ? 'No active zone' : 'Protection active',
        detail: safeZones.isEmpty
            ? 'Add home or school'
            : '${safeZones.length} zone${safeZones.length == 1 ? '' : 's'} monitored',
      ),
      const _ContextCard(
        icon: Icons.route_rounded,
        color: GuardianColors.accent,
        title: 'Journey',
        value: 'Movement history',
        detail: 'Open View journey for recorded trips',
      ),
    ];

    if (guardianAiEnabled) {
      cards.add(
        _ContextCard(
          icon: Icons.auto_awesome_rounded,
          color: const Color(0xFF8058BE),
          title: 'Guardian AI',
          value: guardianIntelligence,
          detail: 'Included with this family plan',
        ),
      );
    }

    if (careEnabled) {
      cards.add(
        const _ContextCard(
          icon: Icons.favorite_rounded,
          color: Color(0xFF8058BE),
          title: 'Wellbeing',
          value: 'Care observations available',
          detail: 'Trends and context, not diagnosis',
        ),
      );
    }

    if (medicationEnabled) {
      cards.add(
        const _ContextCard(
          icon: Icons.medication_rounded,
          color: Color(0xFFD19B16),
          title: 'Medication',
          value: 'Reminder support available',
          detail: 'Configure reminders in Care settings',
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colors.border.withValues(alpha: 0.65)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                profile == GuardianCareProfile.child
                    ? 'AROUND THEM'
                    : careEnabled && profile == GuardianCareProfile.senior
                    ? 'CARE AROUND THEM'
                    : 'AROUND THEM',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: colors.textSecondary,
                  letterSpacing: 0.8,
                ),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                decoration: BoxDecoration(
                  color: GuardianColors.safe.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  profile.label,
                  style: const TextStyle(
                    color: GuardianColors.safe,
                    fontSize: 8,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          LayoutBuilder(
            builder: (context, constraints) {
              if (constraints.maxWidth >= 820 && cards.length <= 4) {
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < cards.length; i++) ...[
                      if (i > 0) const SizedBox(width: 12),
                      Expanded(child: cards[i]),
                    ],
                  ],
                );
              }
              return Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final card in cards)
                    SizedBox(
                      width: constraints.maxWidth >= 520
                          ? (constraints.maxWidth - 10) / 2
                          : constraints.maxWidth,
                      child: card,
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ContextCard extends StatelessWidget {
  const _ContextCard({
    required this.icon,
    required this.color,
    required this.title,
    required this.value,
    required this.detail,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String value;
  final String detail;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      constraints: const BoxConstraints(minHeight: 104),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.055),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withValues(alpha: 0.12)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(11),
            ),
            child: Icon(icon, color: color, size: 18),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  value,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 12,
                    height: 1.25,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: colors.textMuted, fontSize: 9),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
