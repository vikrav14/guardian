import 'package:flutter/material.dart';

import '../navigation/home_shell_scope.dart';
import '../theme/app_theme.dart';
import '../widgets/layout/guardian_app_header.dart';
import '../widgets/navigation/guardian_navigation.dart';
import 'account_page.dart';
import 'alerts_page.dart';
import 'map_dashboard_page.dart';
import 'safe_zones_page.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  void _goToTab(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    const pages = [
      MapDashboardPage(),
      SafeZonesPage(),
      AlertsPage(),
      AccountPage(),
    ];
    return HomeShellScope(
      currentIndex: _index,
      goToTab: _goToTab,
      sidebarCollapsed: true,
      child: Scaffold(
        backgroundColor: context.guardianColors.canvas,
        extendBody: true,
        body: Column(
          children: [
            GuardianAppHeader(
              onHome: () => _goToTab(0),
              onAlerts: () => _goToTab(2),
              onAccount: () => _goToTab(3),
            ),
            Expanded(
              child: Stack(
                children: [
                  IndexedStack(index: _index, children: pages),
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 10,
                    child: MobileBottomBar(
                      currentIndex: _index,
                      onTap: _goToTab,
                      onSos: () => _goToTab(0),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
