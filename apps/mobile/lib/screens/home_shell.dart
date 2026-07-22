import 'package:flutter/material.dart';

import '../navigation/home_shell_scope.dart';
import '../widgets/dashboard/responsive_layout.dart';
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
      child: ResponsiveLayout(
        mobile: Scaffold(
          body: IndexedStack(index: _index, children: pages),
          bottomNavigationBar: MobileBottomBar(
            currentIndex: _index,
            onTap: _goToTab,
          ),
        ),
        desktop: Scaffold(
          body: Row(
            children: [
              DesktopSidebar(
                currentIndex: _index,
                onTap: _goToTab,
              ),
              Expanded(
                child: IndexedStack(index: _index, children: pages),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
