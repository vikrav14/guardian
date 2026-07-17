import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

class AvatarBubble extends StatelessWidget {
  const AvatarBubble({
    super.key,
    required this.initials,
    required this.color,
    this.size = 32,
    this.ringWidth = 2.5,
  });

  final String initials;
  final Color color;
  final double size;
  final double ringWidth;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white,
        border: Border.all(color: color, width: ringWidth),
      ),
      alignment: Alignment.center,
      child: Text(
        initials,
        style: TextStyle(
          fontSize: size * 0.34,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

enum PillTone { safe, warning, danger, neutral }

class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.tone});

  final String label;
  final PillTone tone;

  (Color bg, Color fg) _colors() {
    switch (tone) {
      case PillTone.safe:
        return (GuardianColors.safeBg, GuardianColors.safeText);
      case PillTone.warning:
        return (GuardianColors.warningBg, GuardianColors.warningText);
      case PillTone.danger:
        return (GuardianColors.dangerBg, GuardianColors.dangerText);
      case PillTone.neutral:
        return (GuardianColors.surfaceMuted, GuardianColors.textSecondary);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _colors();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(
        label,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg),
      ),
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.icon,
    required this.value,
    this.iconColor = GuardianColors.textSecondary,
  });

  final IconData icon;
  final String value;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: GuardianColors.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      alignment: Alignment.center,
      child: Column(
        children: [
          Icon(icon, size: 18, color: iconColor),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class GuardianBottomNav extends StatelessWidget {
  const GuardianBottomNav({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  static const _items = [
    (icon: Icons.map_outlined, label: 'Map'),
    (icon: Icons.shield_outlined, label: 'Safe zones'),
    (icon: Icons.notifications_outlined, label: 'Alerts'),
    (icon: Icons.account_circle_outlined, label: 'Account'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: GuardianColors.surface,
        border: Border(top: BorderSide(color: GuardianColors.border)),
      ),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: SafeArea(
        top: false,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: List.generate(_items.length, (i) {
            final active = i == currentIndex;
            final color = active ? GuardianColors.safe : GuardianColors.textMuted;
            return InkWell(
              onTap: () => onTap(i),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(_items[i].icon, size: 22, color: color),
                  const SizedBox(height: 2),
                  Text(
                    _items[i].label,
                    style: TextStyle(
                      fontSize: 10,
                      color: color,
                      fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ],
              ),
            );
          }),
        ),
      ),
    );
  }
}
