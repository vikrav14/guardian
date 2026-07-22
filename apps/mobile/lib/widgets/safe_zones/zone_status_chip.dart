import 'package:flutter/material.dart';

import '../../safe_zones/safe_zone_logic.dart';
import '../../theme/app_theme.dart';

class ZoneStatusChip extends StatelessWidget {
  const ZoneStatusChip({super.key, required this.status});

  final SafeZoneStatus status;

  @override
  Widget build(BuildContext context) {
    final style = styleForStatus(status);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: GuardianSpacing.sm,
        vertical: GuardianSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: style.background,
        borderRadius: BorderRadius.circular(GuardianRadius.pill),
      ),
      child: Text(
        style.label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
          color: style.foreground,
        ),
      ),
    );
  }
}
