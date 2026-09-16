import 'dart:async';

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
class MobileBottomBar extends StatefulWidget {
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
  State<MobileBottomBar> createState() => _MobileBottomBarState();
}

class _MobileBottomBarState extends State<MobileBottomBar> {
  Timer? _sosHoldTimer;
  int _sosHoldTenths = 0;
  bool _sosCompleted = false;

  void _startSosHold() {
    if (_sosHoldTimer != null || _sosCompleted) return;
    setState(() => _sosHoldTenths = 0);
    _sosHoldTimer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _sosHoldTenths++);
      if (_sosHoldTenths >= 30) {
        timer.cancel();
        _sosHoldTimer = null;
        _sosCompleted = true;
        widget.onSos();
      }
    });
  }

  void _cancelSosHold() {
    _sosHoldTimer?.cancel();
    _sosHoldTimer = null;
    if (!mounted) return;
    setState(() {
      _sosHoldTenths = 0;
      _sosCompleted = false;
    });
  }

  @override
  void dispose() {
    _sosHoldTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final items = guardianDestinations(context);
    final progress = (_sosHoldTenths / 30).clamp(0.0, 1.0).toDouble();
    final remainingSeconds = (3 - progress * 3).ceil().clamp(1, 3);
    final holdLabel = _sosCompleted
        ? 'Release'
        : _sosHoldTenths > 0
        ? 'Hold $remainingSeconds sec'
        : 'Hold 3 sec';

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
                      _DestinationButton(
                        item: items[0],
                        active: widget.currentIndex == 0,
                        onTap: () => widget.onTap(0),
                      ),
                      _DestinationButton(
                        item: items[1],
                        active: widget.currentIndex == 1,
                        onTap: () => widget.onTap(1),
                      ),
                      Expanded(
                        child: _SosHoldButton(
                          holdLabel: holdLabel,
                          progress: progress,
                          holding: _sosHoldTenths > 0,
                          onStart: _startSosHold,
                          onCancel: _cancelSosHold,
                        ),
                      ),
                      _DestinationButton(
                        item: items[2],
                        active: widget.currentIndex == 2,
                        onTap: () => widget.onTap(2),
                      ),
                      _DestinationButton(
                        item: items[3],
                        active: widget.currentIndex == 3,
                        onTap: () => widget.onTap(3),
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

class _SosHoldButton extends StatelessWidget {
  const _SosHoldButton({
    required this.holdLabel,
    required this.progress,
    required this.holding,
    required this.onStart,
    required this.onCancel,
  });

  final String holdLabel;
  final double progress;
  final bool holding;
  final VoidCallback onStart;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final danger = _navigationTone(context, emergency: true);
    return Semantics(
      button: true,
      label: 'SOS emergency. Hold for 3 seconds.',
      child: ExcludeSemantics(
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () {},
          onTapDown: (_) => onStart(),
          onTapUp: (_) => onCancel(),
          onTapCancel: onCancel,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 6),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.start,
                children: [
                  _NavigationMark(
                    symbol: GuardianNavigationSymbol.sos,
                    color: danger,
                    emergency: true,
                    progress: holding ? progress : null,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'SOS',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: danger,
                      fontSize: 11.5,
                      height: 1.2,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    holdLabel,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 11,
                      height: 1.2,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
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
    this.emergency = false,
    this.progress,
  });

  final GuardianNavigationSymbol symbol;
  final Color color;
  final bool selected, emergency;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final highContrast =
        MediaQuery.highContrastOf(context) ||
        colors.border == GuardianThemeColors.elderCare.border;
    final highlighted = selected || emergency;
    final tint = emergency ? GuardianColors.danger : colors.accent;
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
          if (progress != null)
            SizedBox.square(
              dimension: 38,
              child: CircularProgressIndicator(
                value: progress,
                strokeWidth: 2,
                color: color,
              ),
            ),
        ],
      ),
    );
  }
}
