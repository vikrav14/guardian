import 'package:flutter/material.dart';
import '../services/guardian_entitlements.dart';
import 'wellness_card.dart';
import 'movement_reminder_preview.dart';
import '../services/movement_reminders_service.dart';

/// Shared plan presentation. Availability of a watch measurement is separate
/// from the subscription's history window.
class WellnessSettingsCard extends StatelessWidget {
  const WellnessSettingsCard({
    super.key,
    required this.subscription,
    required this.onOpen,
    this.onMovementReminders,
    this.imei = '',
  });
  final GuardianSubscription subscription;
  final VoidCallback onOpen;
  final VoidCallback? onMovementReminders;
  final String imei;

  @override
  Widget build(BuildContext context) => WellnessSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        WellnessHeading(title: 'Wellness', subtitle: subscription.planLabel),
        const SizedBox(height: 12),
        Text(subscription.wellnessHistoryDescription),
        const SizedBox(height: 8),
        const Text(
          'Today’s steps are on Home. Family and Care can use watch estimates and automatic reading routines; steps record independently.',
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: subscription.has(GuardianFeature.wellnessReadings)
              ? onOpen
              : null,
          icon: const Icon(Icons.schedule),
          label: const Text('Wellness routine'),
        ),
        if (onMovementReminders != null &&
            (canPreviewMovementReminders(subscription) ||
                canUseMovementPilot(subscription, imei))) ...[
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: onMovementReminders,
            icon: const Icon(Icons.directions_walk_rounded),
            label: const Text('Movement reminders'),
          ),
        ],
      ],
    ),
  );
}
