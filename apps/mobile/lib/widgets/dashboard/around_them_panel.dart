import 'package:flutter/material.dart';

import '../../models/care_profile.dart';
import '../../models/device.dart';
import '../../models/geofence.dart';
import '../../theme/app_theme.dart';

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
    final d = device;
    if (d == null) return const SizedBox.shrink();

    final colors = context.guardianColors;
    final profile = GuardianCareProfileX.fromValue(d.careProfile);
    final priorities = d.carePriorities.isEmpty
        ? GuardianCarePriority.defaultsFor(profile)
        : d.carePriorities;

    final safeZones = geofences
        .where((zone) => zone.imei == d.imei && zone.active)
        .toList(growable: false);

    final place = d.location?.placeLabel?.trim();
    final locationValue = place != null && place.isNotEmpty
        ? place
        : d.hasFreshLocation
        ? 'Location confirmed'
        : d.location?.isValid == true
        ? 'Last known location'
        : 'Locating';

    final cards = <Widget>[
      _ContextCard(
        icon: Icons.location_on_rounded,
        color: GuardianColors.accent,
        title: 'Location',
        value: locationValue,
        detail: d.hasFreshLocation ? 'Current fix' : 'Last GPS fix',
      ),
    ];

    if (profile == GuardianCareProfile.child) {
      cards.addAll([
        _ContextCard(
          icon: Icons.route_rounded,
          color: GuardianColors.accent,
          title: 'Journey',
          value: priorities.contains(GuardianCarePriority.journeys)
              ? 'Route awareness on'
              : 'Journey monitoring',
          detail: 'Home, school and unusual stops',
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
        _ContextCard(
          icon: Icons.radar_rounded,
          color: const Color(0xFF8058BE),
          title: 'Around them',
          value: localContext,
          detail: weatherStatus,
        ),
      ]);
    } else if (profile == GuardianCareProfile.senior) {
      cards.addAll([
        _ContextCard(
          icon: Icons.favorite_rounded,
          color: const Color(0xFF8058BE),
          title: 'Wellbeing',
          value: priorities.contains(GuardianCarePriority.wellbeing)
              ? 'Watching for changes'
              : 'Wellbeing available',
          detail: 'Readings stay in the detail view',
        ),
        _ContextCard(
          icon: Icons.shield_rounded,
          color: safeZones.isEmpty
              ? const Color(0xFF7E8B86)
              : GuardianColors.safe,
          title: 'Safe zone',
          value: safeZones.isEmpty ? 'No active zone' : 'Protection active',
          detail: priorities.contains(GuardianCarePriority.wandering)
              ? 'Wandering context enabled'
              : 'Location boundaries',
        ),
        _ContextCard(
          icon: Icons.medication_rounded,
          color: const Color(0xFFD19B16),
          title: 'Medication',
          value: priorities.contains(GuardianCarePriority.medication)
              ? 'Care reminders enabled'
              : 'Medication support',
          detail: 'Managed in Care Services',
        ),
      ]);
    } else {
      cards.addAll([
        _ContextCard(
          icon: Icons.favorite_rounded,
          color: const Color(0xFF8058BE),
          title: 'Wellbeing',
          value: 'Quietly monitored',
          detail: 'Trends, not diagnosis',
        ),
        _ContextCard(
          icon: Icons.shield_rounded,
          color: safeZones.isEmpty
              ? const Color(0xFF7E8B86)
              : GuardianColors.safe,
          title: 'Safe zone',
          value: safeZones.isEmpty ? 'No active zone' : 'Protection active',
          detail: 'Location boundaries',
        ),
        _ContextCard(
          icon: Icons.radar_rounded,
          color: const Color(0xFF8058BE),
          title: 'Local context',
          value: localContext,
          detail: weatherStatus,
        ),
      ]);
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
                    : profile == GuardianCareProfile.senior
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
              if (constraints.maxWidth >= 820) {
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
