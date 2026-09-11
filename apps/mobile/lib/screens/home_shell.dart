import 'package:flutter/material.dart';

import '../navigation/home_shell_scope.dart';
import '../services/guardian_entitlements_scope.dart';
import '../services/guardian_services.dart';
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
  final _dashboardKey = GlobalKey<MapDashboardPageState>();
  late final Stream<GuardianSubscription> _subscriptions;

  @override
  void initState() {
    super.initState();
    _subscriptions = UserProfileService().watchSubscription();
  }

  void _goToTab(int index) => setState(() => _index = index);

  void _sendSos() {
    _goToTab(0);
    _dashboardKey.currentState?.sendHelpFromNavigation();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      MapDashboardPage(key: _dashboardKey),
      SafeZonesPage(),
      AlertsPage(),
      AccountPage(),
    ];
    return StreamBuilder<GuardianSubscription>(
      stream: _subscriptions,
      builder: (context, snapshot) {
        return GuardianEntitlementsScope(
          subscription: snapshot.data,
          checking:
              snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData,
          error: snapshot.error,
          child: HomeShellScope(
            currentIndex: _index,
            goToTab: _goToTab,
            sidebarCollapsed: true,
            child: Scaffold(
              backgroundColor: context.guardianColors.canvas,
              bottomNavigationBar: MobileBottomBar(
                currentIndex: _index,
                onTap: _goToTab,
                onSos: _sendSos,
              ),
              body: Column(
                children: [
                  GuardianAppHeader(
                    onHome: () => _goToTab(0),
                    onAlerts: () => _goToTab(2),
                    onAccount: () => _goToTab(3),
                  ),
                  Expanded(
                    child: IndexedStack(index: _index, children: pages),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
