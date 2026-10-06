import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../widgets/navigation/guardian_navigation.dart';
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
  });

  final GlobalKey<NavigatorState> navigatorKey;
  final List<Widget> pages;
  final Widget Function(ValueChanged<int> goToTab) headerBuilder;
  final int initialIndex;

  @override
  State<GuardianNavigationShell> createState() =>
      _GuardianNavigationShellState();
}

class _GuardianNavigationShellState extends State<GuardianNavigationShell> {
  late int _index = widget.initialIndex;
  final _routes = _ShellRoutes();
  bool _switching = false;

  Future<void> _goToTab(int index) async {
    if (_switching || index < 0 || index >= widget.pages.length) return;
    _switching = true;
    try {
      FocusManager.instance.primaryFocus?.unfocus();
      final navigator = widget.navigatorKey.currentState;
      // Respect a page's PopScope (for example, while saving a recording).
      // popUntil would bypass that protection.
      while (navigator != null && navigator.canPop()) {
        final previous = _routes.top;
        if (!await navigator.maybePop() || !mounted) return;
        if (_routes.top == previous) return;
      }
      if (mounted) setState(() => _index = index);
    } finally {
      _switching = false;
    }
  }

  @override
  Widget build(BuildContext context) => HomeShellScope(
    currentIndex: _index,
    goToTab: _goToTab,
    sidebarCollapsed: true,
    child: Scaffold(
      backgroundColor: context.guardianColors.canvas,
      // Inner page scaffolds own keyboard insets. Resizing both would subtract
      // the keyboard height twice on settings forms.
      resizeToAvoidBottomInset: false,
      bottomNavigationBar: MobileBottomBar(
        currentIndex: _index,
        onTap: _goToTab,
      ),
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
          return MediaQuery(
            data: media.copyWith(
              viewInsets: media.viewInsets.copyWith(bottom: keyboardInset),
            ),
            child: NavigatorPopHandler<Object?>(
              onPopWithResult: (result) =>
                  widget.navigatorKey.currentState!.maybePop(result),
              child: Navigator(
                key: widget.navigatorKey,
                observers: [_routes],
                onGenerateRoute: (_) => MaterialPageRoute<void>(
                  builder: (context) {
                    final index = HomeShellScope.maybeOf(context)!.currentIndex;
                    return Column(
                      children: [
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
          );
        },
      ),
    ),
  );
}

class _ShellRoutes extends NavigatorObserver {
  Route<dynamic>? top;

  @override
  void didChangeTop(Route<dynamic> topRoute, Route<dynamic>? previousTopRoute) {
    top = topRoute;
  }
}
