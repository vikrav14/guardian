import 'package:flutter/material.dart';
import '../services/guardian_entitlements.dart';
import 'wellness_card.dart';

/// Shared plan presentation. Availability of a watch measurement is separate
/// from the subscription's history window.
class WellnessSettingsCard extends StatelessWidget {
  const WellnessSettingsCard({
    super.key,
    required this.subscription,
    required this.onOpen,
  });
  final GuardianSubscription subscription;
  final VoidCallback onOpen;

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
          'Today’s steps are on Home. Guardian Care also includes watch estimates and automatic reading routines; steps record independently.',
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: subscription.has(GuardianFeature.wellnessReadings)
              ? onOpen
              : null,
          icon: const Icon(Icons.schedule),
          label: const Text('Wellness routine'),
        ),
      ],
    ),
  );
}
