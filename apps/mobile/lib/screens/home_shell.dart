import 'package:flutter/material.dart';

import '../widgets/guardian_widgets.dart';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: IndexedStack(
        index: _index,
        children: const [
          MapDashboardPage(),
          SafeZonesPage(),
          AlertsPage(),
          AccountPage(),
        ],
      ),
      bottomNavigationBar: GuardianBottomNav(
        currentIndex: _index,
        onTap: (i) => setState(() => _index = i),
      ),
    );
  }
}
