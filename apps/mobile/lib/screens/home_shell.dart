import 'package:flutter/material.dart';

import '../navigation/home_shell_scope.dart';
import '../services/sidebar_preferences.dart';
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
  bool _sidebarCollapsed = false;

  @override
  void initState() {
    super.initState();
    SidebarPreferences.loadCollapsed().then((collapsed) {
      if (!mounted) return;
      setState(() => _sidebarCollapsed = collapsed);
    });
  }

  void _goToTab(int index) => setState(() => _index = index);

  void _setSidebarCollapsed(bool collapsed) {
    setState(() => _sidebarCollapsed = collapsed);
    SidebarPreferences.saveCollapsed(collapsed);
  }

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
      sidebarCollapsed: _sidebarCollapsed,
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
                collapsed: _sidebarCollapsed,
                onCollapsedChanged: _setSidebarCollapsed,
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
