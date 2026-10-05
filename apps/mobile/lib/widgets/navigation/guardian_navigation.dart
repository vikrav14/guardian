import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../theme/app_theme.dart';
import 'guardian_navigation_icon.dart';

typedef GuardianDestination = ({GuardianNavigationSymbol icon, String label});

List<GuardianDestination> guardianDestinations(BuildContext context) {
  final t = AppLocalizations.of(context)!;
  return [
    (icon: GuardianNavigationSymbol.home, label: 'Home'),
    (icon: GuardianNavigationSymbol.safeZones, label: t.navSafeZones),
    (icon: GuardianNavigationSymbol.alerts, label: t.navAlerts),
    (icon: GuardianNavigationSymbol.account, label: t.navAccount),
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
  });
  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final items = guardianDestinations(context);
    return Material(
      color: colors.surface,
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: colors.border)),
        ),
        child: SafeArea(
          top: false,
          child: Center(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                child: IntrinsicHeight(
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      for (var index = 0; index < items.length; index++)
                        _DestinationButton(
                          item: items[index],
                          active: currentIndex == index,
                          onTap: () => onTap(index),
                        ),
                    ],
                  ),
                ),
              ),
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
    final tone = active ? _navigationTone(context) : colors.textSecondary;
    return Expanded(
      child: Semantics(
        selected: active,
        button: true,
        label: item.label,
        onTap: onTap,
        child: ExcludeSemantics(
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 72),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  mainAxisAlignment: MainAxisAlignment.start,
                  children: [
                    _NavigationMark(
                      symbol: item.icon,
                      color: tone,
                      selected: active,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.2,
                        color: tone,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                      ),
                    ),
                    SizedBox(
                      height: MediaQuery.textScalerOf(context).scale(11) * 1.2,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Color _navigationTone(BuildContext context, {bool emergency = false}) {
  final colors = context.guardianColors;
  final base = emergency ? GuardianColors.danger : colors.accent;
  if (Theme.of(context).brightness == Brightness.dark) {
    return emergency ? Color.lerp(base, Colors.white, .30)! : base;
  }
  return Color.lerp(base, colors.textPrimary, emergency ? .14 : .40)!;
}

class _NavigationMark extends StatelessWidget {
  const _NavigationMark({
    required this.symbol,
    required this.color,
    this.selected = false,
  });

  final GuardianNavigationSymbol symbol;
  final Color color;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final highContrast =
        MediaQuery.highContrastOf(context) ||
        colors.border == GuardianThemeColors.elderCare.border;
    final highlighted = selected;
    final tint = colors.accent;
    return AnimatedContainer(
      width: 50,
      height: 42,
      duration: MediaQuery.disableAnimationsOf(context)
          ? Duration.zero
          : const Duration(milliseconds: 160),
      curve: Curves.easeOut,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: highlighted && !highContrast
            ? LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color.lerp(colors.surface, tint, .13)!,
                  Color.lerp(colors.surface, tint, .055)!,
                ],
              )
            : null,
        border: highlighted && highContrast
            ? Border.all(color: color, width: 2)
            : null,
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          GuardianNavigationIcon(
            symbol: symbol,
            color: color,
            selected: selected,
            highContrast: highContrast,
          ),
        ],
      ),
    );
  }
}
