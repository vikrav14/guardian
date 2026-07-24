import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../theme/app_theme.dart';

typedef GuardianDestination = ({IconData icon, IconData activeIcon, String label});

List<GuardianDestination> guardianDestinations(BuildContext context) {
  final t = AppLocalizations.of(context)!;
  return [
    (
      icon: Icons.home_outlined,
      activeIcon: Icons.home_rounded,
      label: 'Home',
    ),
    (
      icon: Icons.shield_outlined,
      activeIcon: Icons.shield_rounded,
      label: t.navSafeZones,
    ),
    (
      icon: Icons.notifications_none_rounded,
      activeIcon: Icons.notifications_rounded,
      label: t.navAlerts,
    ),
    (
      icon: Icons.person_outline_rounded,
      activeIcon: Icons.person_rounded,
      label: t.navAccount,
    ),
  ];
}

/// Guardian uses one navigation model on every platform. Wide screens gain
/// breathing room around the app content, rather than switching to a separate
/// legacy desktop shell.
class MobileBottomBar extends StatelessWidget {
  const MobileBottomBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    required this.onSos,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback onSos;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final items = guardianDestinations(context);

    return SafeArea(
      top: false,
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Container(
            height: 76,
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: colors.glass,
              borderRadius: BorderRadius.circular(25),
              border: Border.all(color: Colors.white),
              boxShadow: [
                BoxShadow(
                  color: GuardianColors.forest.withValues(alpha: 0.18),
                  blurRadius: 34,
                  offset: const Offset(0, 14),
                ),
              ],
            ),
            child: Row(
              children: [
                _DestinationButton(
                  item: items[0],
                  active: currentIndex == 0,
                  onTap: () => onTap(0),
                ),
                _DestinationButton(
                  item: items[1],
                  active: currentIndex == 1,
                  onTap: () => onTap(1),
                ),
                Expanded(
                  child: Center(
                    child: Semantics(
                      button: true,
                      label: 'SOS emergency',
                      child: Material(
                        color: GuardianColors.danger,
                        shape: const CircleBorder(),
                        elevation: 8,
                        shadowColor: GuardianColors.danger.withValues(
                          alpha: 0.45,
                        ),
                        child: InkWell(
                          customBorder: const CircleBorder(),
                          onTap: onSos,
                          child: const SizedBox(
                            width: 56,
                            height: 56,
                            child: Center(
                              child: Text(
                                'SOS',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 13,
                                  fontWeight: FontWeight.w900,
                                  letterSpacing: 0.2,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                _DestinationButton(
                  item: items[2],
                  active: currentIndex == 2,
                  onTap: () => onTap(2),
                ),
                _DestinationButton(
                  item: items[3],
                  active: currentIndex == 3,
                  onTap: () => onTap(3),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _DestinationButton extends StatelessWidget {
  const _DestinationButton({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final GuardianDestination item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Expanded(
      child: Semantics(
        selected: active,
        button: true,
        label: item.label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                active ? item.activeIcon : item.icon,
                size: 21,
                color: active ? GuardianColors.safe : colors.textMuted,
              ),
              const SizedBox(height: 4),
              Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 9,
                  color: active ? GuardianColors.safe : colors.textMuted,
                  fontWeight: active ? FontWeight.w800 : FontWeight.w500,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
