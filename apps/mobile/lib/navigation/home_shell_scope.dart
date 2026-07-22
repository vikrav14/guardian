import 'package:flutter/material.dart';

/// Exposes [HomeShell] tab navigation to nested screens (e.g. dashboard quick
/// actions) so they switch tabs instead of pushing a full-screen route.
class HomeShellScope extends InheritedWidget {
  const HomeShellScope({
    super.key,
    required this.currentIndex,
    required this.goToTab,
    this.sidebarCollapsed = false,
    required super.child,
  });

  final int currentIndex;
  final ValueChanged<int> goToTab;
  final bool sidebarCollapsed;

  static HomeShellScope? maybeOf(BuildContext context) {
    return context.dependOnInheritedWidgetOfExactType<HomeShellScope>();
  }

  @override
  bool updateShouldNotify(HomeShellScope oldWidget) {
    return currentIndex != oldWidget.currentIndex ||
        sidebarCollapsed != oldWidget.sidebarCollapsed;
  }
}
