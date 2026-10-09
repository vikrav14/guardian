import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/navigation/guardian_navigation.dart';
import '../widgets/navigation/guardian_side_menu.dart';
import 'home_shell_scope.dart';

/// Keeps every signed-in page inside the same navigation and theme boundary.
/// Dialogs remain modal; detail pages use the nearest (nested) navigator.
class GuardianNavigationShell extends StatefulWidget {
  const GuardianNavigationShell({
    super.key,
    required this.navigatorKey,
    required this.pages,
    required this.headerBuilder,
    this.initialIndex = 0,
    this.watchName,
    this.watchPageBuilder,
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final List<Widget> pages;
  final Widget Function(ValueChanged<int> goToTab) headerBuilder;
  final int initialIndex;
  final String? watchName;
  final Future<Widget?> Function(GuardianMenuDestination)? watchPageBuilder;

  @override
  State<GuardianNavigationShell> createState() =>
      _GuardianNavigationShellState();
}

class _GuardianNavigationShellState extends State<GuardianNavigationShell> {
  late int _index = widget.initialIndex;
  late final _routes = _ShellRoutes(_routeChanged);
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  GuardianMenuDestination? _routeMenu;
  bool _switching = false;

  void _routeChanged(Route<dynamic> route) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _routes.top != route) return;
      setState(() {
        if (route.isFirst) {
          _routeMenu = null;
        } else {
          for (final item in GuardianMenuDestination.values) {
            if (item.routeName == route.settings.name) _routeMenu = item;
          }
        }
      });
    });
  }

  Future<bool> _backToRoot() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final navigator = widget.navigatorKey.currentState;
    // maybePop preserves unsaved-form and in-flight recording protections.
    while (navigator != null && navigator.canPop()) {
      final previous = _routes.top;
      if (!await navigator.maybePop() || !mounted) return false;
      if (_routes.top == previous) return false;
    }
    return mounted;
  }

  Future<void> _goToMenu(GuardianMenuDestination destination) async {
    _scaffoldKey.currentState?.closeDrawer();
    if (destination.index < GuardianMenuDestination.journey.index) {
      await _goToTab(destination.tab!);
      return;
    }
    if (_switching) return;
    _switching = true;
    try {
      if (!await _backToRoot()) return;
      final page = await widget.watchPageBuilder?.call(destination);
      if (!mounted || page == null) return;
      widget.navigatorKey.currentState!.push<void>(
        MaterialPageRoute<void>(
          settings: RouteSettings(name: destination.routeName),
          builder: (_) => page,
        ),
      );
    } finally {
      _switching = false;
    }
  }

  Future<void> _goToTab(int index) async {
    if (_switching || index < 0 || index >= widget.pages.length) return;
    _switching = true;
    try {
      if (!await _backToRoot()) return;
      setState(() {
        _index = index;
        _routeMenu = null;
      });
    } finally {
      _switching = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide =
        MediaQuery.sizeOf(context).width >= 1100 &&
        MediaQuery.textScalerOf(context).scale(14) <= 20;
    final hasSideMenu = widget.watchPageBuilder != null;
    Widget sideMenu({required bool collapsed, VoidCallback? onToggle}) =>
        GuardianSideMenu(
          selected: _routeMenu ?? GuardianMenuDestination.forTab(_index),
          watchName: widget.watchName,
          collapsed: collapsed,
          onToggle: onToggle,
          onSelected: _goToMenu,
        );
    return HomeShellScope(
      currentIndex: _index,
      goToTab: _goToTab,
      sidebarCollapsed: true,
      child: Scaffold(
        key: _scaffoldKey,
        drawer: hasSideMenu && !wide
            ? Drawer(
                width: 252,
                child: SafeArea(
                  child: sideMenu(
                    collapsed: false,
                    onToggle: () => _scaffoldKey.currentState?.closeDrawer(),
                  ),
                ),
              )
            : null,
        backgroundColor: context.guardianColors.canvas,
        // Inner page scaffolds own keyboard insets. Resizing both would subtract
        // the keyboard height twice on settings forms.
        resizeToAvoidBottomInset: false,
        bottomNavigationBar: wide || hasSideMenu
            ? null
            : MobileBottomBar(currentIndex: _index, onTap: _goToTab),
        body: LayoutBuilder(
          builder: (context, constraints) {
            final media = MediaQuery.of(context);
            // The shell already reserves the bottom bar's height. Only the part
            // of the keyboard overlapping this body belongs to inner scaffolds;
            // passing the full inset would subtract the bar a second time.
            final belowBody = (media.size.height - constraints.maxHeight).clamp(
              0.0,
              media.size.height,
            );
            final keyboardInset = (media.viewInsets.bottom - belowBody).clamp(
              0.0,
              media.viewInsets.bottom,
            );
            return Column(
              children: [
                if (wide || hasSideMenu) widget.headerBuilder(_goToTab),
                Expanded(
                  child: Row(
                    children: [
                      if (hasSideMenu)
                        sideMenu(
                          collapsed: !wide,
                          onToggle: wide
                              ? null
                              : () => _scaffoldKey.currentState?.openDrawer(),
                        )
                      else if (wide)
                        MobileBottomBar(
                          vertical: true,
                          currentIndex: _index,
                          onTap: _goToTab,
                        ),
                      Expanded(
                        child: MediaQuery(
                          data: media.copyWith(
                            viewInsets: media.viewInsets.copyWith(
                              bottom: keyboardInset,
                            ),
                          ),
                          // A nested route must not hide the persistent menu
                          // and header from the platform accessibility tree.
                          child: Semantics(
                            container: true,
                            explicitChildNodes: true,
                            child: NavigatorPopHandler<Object?>(
                              onPopWithResult: (result) => widget
                                  .navigatorKey
                                  .currentState!
                                  .maybePop(result),
                              child: Navigator(
                                key: widget.navigatorKey,
                                observers: [_routes],
                                onGenerateRoute: (_) => MaterialPageRoute<void>(
                                  builder: (context) {
                                    final index = HomeShellScope.maybeOf(
                                      context,
                                    )!.currentIndex;
                                    return Column(
                                      children: [
                                        if (!hasSideMenu &&
                                            (MediaQuery.sizeOf(context).width <
                                                    1100 ||
                                                MediaQuery.textScalerOf(
                                                      context,
                                                    ).scale(14) >
                                                    20))
                                          widget.headerBuilder(_goToTab),
                                        Expanded(
                                          child: IndexedStack(
                                            index: index,
                                            children: widget.pages,
                                          ),
                                        ),
                                      ],
                                    );
                                  },
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _ShellRoutes extends NavigatorObserver {
  _ShellRoutes(this.onChanged);
  final ValueChanged<Route<dynamic>> onChanged;
  Route<dynamic>? top;

  @override
  void didChangeTop(Route<dynamic> topRoute, Route<dynamic>? previousTopRoute) {
    top = topRoute;
    onChanged(topRoute);
  }
}
