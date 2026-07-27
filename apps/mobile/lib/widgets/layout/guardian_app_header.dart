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
      color: GuardianColors.ivory.withValues(alpha: 0.94),
      child: SafeArea(
        bottom: false,
        child: Container(
          height: compact ? 68 : 78,
          padding: EdgeInsets.symmetric(horizontal: compact ? 16 : 30),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: colors.border)),
          ),
          child: Row(
            children: [
              Semantics(
                button: true,
                label: 'Guardian home',
                child: InkWell(
                  onTap: onHome,
                  borderRadius: BorderRadius.circular(16),
                  child: GuardianHeaderBrandMark(
                    iconSize: compact ? 39 : 44,
                    wordmarkSize: compact ? 20 : 24,
                    caption: compact
                        ? null
                        : Text.rich(
                            TextSpan(
                              text: 'Know they ',
                              children: const [
                                TextSpan(
                                  text: 'are safe',
                                  style: TextStyle(color: GuardianColors.safe),
                                ),
                              ],
                            ),
                            style: TextStyle(
                              color: colors.textSecondary,
                              fontSize: 11,
                            ),
                          ),
                  ),
                ),
              ),
              const Spacer(),
              _HeaderButton(
                tooltip: 'Notifications',
                icon: Icons.notifications_none_rounded,
                onTap: onAlerts,
              ),
              const SizedBox(width: 12),
              InkWell(
                onTap: onAccount,
                customBorder: const CircleBorder(),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    GuardianHeaderAvatar(
                      initials: initialsFor(name),
                      color: GuardianColors.safe,
                      size: compact ? 38 : 42,
                    ),
                    Positioned(
                      right: -1,
                      bottom: 1,
                      child: Container(
                        width: 11,
                        height: 11,
                        decoration: BoxDecoration(
                          color: const Color(0xFF36C477),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 2),
                        ),
                      ),
                    ),
                  ],
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
        color: colors.surface,
        borderRadius: BorderRadius.circular(14),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(14),
          child: Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              border: Border.all(color: colors.border),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, size: 20, color: colors.textPrimary),
          ),
        ),
      ),
    );
  }
}
