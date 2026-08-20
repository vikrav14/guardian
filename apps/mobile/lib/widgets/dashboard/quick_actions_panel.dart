import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Quick Actions panel — three primary guardian actions.
///
/// Separate from hero per spec (section 3.2).
/// Actions: Call watch, View location, Ask Guardian (via WhatsApp/AI).
class QuickActionsPanel extends StatelessWidget {
  const QuickActionsPanel({
    required this.onCall,
    required this.onViewLocation,
    required this.onAskGuardian,
    super.key,
  });

  final VoidCallback onCall;
  final VoidCallback onViewLocation;
  final VoidCallback onAskGuardian;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _QuickActionButton(
            label: 'Call watch',
            onPressed: onCall,
            color: GuardianColors.safe,
            textColor: Colors.white,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _QuickActionButton(
            label: 'View location',
            onPressed: onViewLocation,
            color: GuardianColors.accent,
            textColor: Colors.white,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _QuickActionButton(
            label: 'Ask Guardian',
            onPressed: onAskGuardian,
            color: GuardianColors.whatsapp,
            textColor: Colors.white,
          ),
        ),
      ],
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  const _QuickActionButton({
    required this.label,
    required this.onPressed,
    required this.color,
    required this.textColor,
  });

  final String label;
  final VoidCallback onPressed;
  final Color color;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    final textTheme = Theme.of(context).textTheme;

    return Material(
      color: color,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onPressed,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: textTheme.labelMedium?.copyWith(
              color: textColor,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
