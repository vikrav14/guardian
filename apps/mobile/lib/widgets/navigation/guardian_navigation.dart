import 'dart:async';

import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../theme/app_theme.dart';

typedef GuardianDestination = ({
  IconData icon,
  IconData activeIcon,
  String label,
});

List<GuardianDestination> guardianDestinations(BuildContext context) {
  final t = AppLocalizations.of(context)!;
  return [
    (icon: Icons.home_outlined, activeIcon: Icons.home_rounded, label: 'Home'),
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
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(
                    width: 28,
                    height: 28,
                    child: Stack(
                      alignment: Alignment.center,
                      children: [
                        const Icon(
                          Icons.error_outline_rounded,
                          size: 26,
                          color: GuardianColors.danger,
                        ),
                        if (holding)
                          CircularProgressIndicator(
                            value: progress,
                            strokeWidth: 2,
                            color: GuardianColors.danger,
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 3),
                  const Text(
                    'SOS',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: GuardianColors.danger,
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
                      fontSize: 10,
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
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      active ? item.activeIcon : item.icon,
                      size: 26,
                      color: active ? colors.accent : colors.textSecondary,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      item.label,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontSize: 11.5,
                        height: 1.2,
                        color: active ? colors.accent : colors.textSecondary,
                        fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                      ),
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
