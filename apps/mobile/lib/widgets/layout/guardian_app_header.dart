import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../brand/guardian_pin_logo.dart';
import '../guardian_widgets.dart';

class GuardianAppHeader extends StatelessWidget {
  const GuardianAppHeader({
    super.key,
    required this.onHome,
    required this.onAlerts,
    required this.onAccount,
  });

  final VoidCallback onHome;
  final VoidCallback onAlerts;
  final VoidCallback onAccount;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final user = FirebaseAuth.instance.currentUser;
    final name = user?.displayName?.trim().isNotEmpty == true
        ? user!.displayName!
        : (user?.email ?? 'Guardian');
    final compact = MediaQuery.sizeOf(context).width < 520;

    return Material(
      color: colors.surface,
      child: SafeArea(
        bottom: false,
        child: Container(
          height: compact ? 60 : 72,
          padding: EdgeInsets.symmetric(horizontal: compact ? 12 : 30),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: colors.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: Semantics(
                    button: true,
                    label: 'Guardian home',
                    onTap: onHome,
                    child: ExcludeSemantics(
                      child: InkWell(
                        onTap: onHome,
                        borderRadius: BorderRadius.circular(12),
                        child: SizedBox(
                          height: 48,
                          child: FittedBox(
                            fit: BoxFit.scaleDown,
                            alignment: Alignment.centerLeft,
                            child: GuardianHeaderBrandMark(
                              iconSize: compact ? 34 : 40,
                              wordmarkSize: compact ? 20 : 24,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              _HeaderButton(
                tooltip: 'Notifications',
                icon: Icons.notifications_none_rounded,
                onTap: onAlerts,
              ),
              const SizedBox(width: 4),
              Tooltip(
                message: 'Account',
                child: Semantics(
                  button: true,
                  label: 'Account',
                  onTap: onAccount,
                  child: ExcludeSemantics(
                    child: InkWell(
                      onTap: onAccount,
                      customBorder: const CircleBorder(),
                      child: SizedBox.square(
                        dimension: 48,
                        child: Center(
                          child: GuardianHeaderAvatar(
                            initials: initialsFor(name),
                            color: GuardianColors.safe,
                            size: compact ? 34 : 38,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeaderButton extends StatelessWidget {
  const _HeaderButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: colors.surfaceMuted,
        shape: const CircleBorder(),
        child: InkWell(
          onTap: onTap,
          customBorder: const CircleBorder(),
          child: SizedBox.square(
            dimension: 48,
            child: Icon(icon, size: 24, color: colors.textPrimary),
          ),
        ),
      ),
    );
  }
}
