import 'package:flutter/material.dart';

import '../../navigation/home_shell_scope.dart';
import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';

const dashboardHeaderTitleStyle = TextStyle(
  fontSize: 22,
  fontWeight: FontWeight.w800,
  height: 1.0,
);

/// Multi-color "Know they are safe" slogan for the desktop dashboard header.
class DashboardGuardianSloganText extends StatelessWidget {
  const DashboardGuardianSloganText({super.key});

  static const _style = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.bold,
    height: 1.0,
  );

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        style: _style,
        children: const [
          TextSpan(
            text: 'Know ',
            style: TextStyle(color: GuardianColors.flagRed),
          ),
          TextSpan(
            text: 'they ',
            style: TextStyle(color: GuardianColors.flagBlue),
          ),
          TextSpan(
            text: 'are ',
            style: TextStyle(color: GuardianColors.flagYellow),
          ),
          TextSpan(
            text: 'safe',
            style: TextStyle(color: GuardianColors.flagGreen),
          ),
        ],
      ),
    );
  }
}

/// Desktop dashboard header. Shows Guardian branding only when the sidebar is
/// collapsed; when expanded, the sidebar already carries the brand.
class DashboardDesktopTopBar extends StatelessWidget {
  const DashboardDesktopTopBar({
    super.key,
    required this.userInitials,
    this.avatarUrls,
  });

  final String userInitials;
  final Stream<String?>? avatarUrls;

  static const _headerAnimDuration = Duration(milliseconds: 250);

  @override
  Widget build(BuildContext context) {
    final sidebarCollapsed =
        HomeShellScope.maybeOf(context)?.sidebarCollapsed ?? false;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        AnimatedSwitcher(
          duration: _headerAnimDuration,
          switchInCurve: Curves.easeInOut,
          switchOutCurve: Curves.easeInOut,
          transitionBuilder: (child, animation) => FadeTransition(
            opacity: animation,
            child: child,
          ),
          child: sidebarCollapsed
              ? const Column(
                  key: ValueKey('brand'),
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Guardian', style: dashboardHeaderTitleStyle),
                    DashboardGuardianSloganText(),
                  ],
                )
              : const SizedBox.shrink(key: ValueKey('empty')),
        ),
        const Spacer(),
        IconButton(
          onPressed: () {},
          icon: const Icon(Icons.notifications_none_rounded),
          tooltip: 'Notifications',
          visualDensity: VisualDensity.compact,
          padding: EdgeInsets.zero,
          constraints: BoxConstraints(minWidth: 40, minHeight: 40),
        ),
        const SizedBox(width: 8),
        GuardianHeaderAvatar(
          initials: userInitials,
          color: context.guardianColors.accent,
          size: 38,
          avatarUrls: avatarUrls,
        ),
      ],
    );
  }
}
