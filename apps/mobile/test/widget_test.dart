import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/l10n/app_localizations_mfe.dart';
import 'package:guardian/main.dart';
import 'package:guardian/navigation/home_shell_scope.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/guardian_widgets.dart';
import 'package:guardian/widgets/dashboard/dashboard_desktop_top_bar.dart';
import 'package:guardian/widgets/dashboard/desktop_dashboard_layout.dart';
import 'package:guardian/widgets/dashboard/responsive_layout.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/theme/theme_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

Widget _wrap(Widget child, {Locale locale = const Locale('en')}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: guardianLocalizationsDelegates,
    home: GuardianThemeScope(
      themeId: GuardianThemeId.defaultTheme,
      onThemeChanged: (_) {},
      child: Theme(
        data: buildGuardianTheme(),
        child: Scaffold(body: child),
      ),
    ),
  );
}

class _TestDesktopSidebarHost extends StatefulWidget {
  const _TestDesktopSidebarHost({required this.onTap});

  final ValueChanged<int> onTap;

  @override
  State<_TestDesktopSidebarHost> createState() => _TestDesktopSidebarHostState();
}

class _TestDesktopSidebarHostState extends State<_TestDesktopSidebarHost> {
  bool _collapsed = false;

  @override
  Widget build(BuildContext context) {
    return DesktopSidebar(
      currentIndex: 0,
      collapsed: _collapsed,
      onCollapsedChanged: (collapsed) => setState(() => _collapsed = collapsed),
      onTap: widget.onTap,
    );
  }
}

void main() {
  testWidgets('GuardianHeaderAvatar listens to guardian avatar stream', (
    tester,
  ) async {
    final controller = StreamController<String?>();
    addTearDown(controller.close);

    await tester.pumpWidget(
      _wrap(
        GuardianHeaderAvatar(
          initials: 'VI',
          color: Colors.green,
          avatarUrls: controller.stream,
        ),
      ),
    );

    expect(find.text('VI'), findsOneWidget);

    controller.add(
      'https://firebasestorage.googleapis.com/v0/b/guardian-fbadd.firebasestorage.app/o/'
      'guardianAvatars%2Fuser-1%2Favatar?alt=media&token=abc-123',
    );
    await tester.pump();

    // Stream update rebuilds the avatar; photo bytes need Firebase at runtime.
    expect(tester.takeException(), isNull);
    expect(find.byType(GuardianHeaderAvatar), findsOneWidget);
  });

  testWidgets('dashboard-style avatars are display-only', (tester) async {
    await tester.pumpWidget(
      _wrap(
        const Center(
          child: AvatarBubble(
            initials: 'GU',
            color: Colors.green,
            size: 38,
            imageUrl: 'https://example.com/avatar.jpg',
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.camera_alt_rounded), findsNothing);
    expect(find.byType(InkWell), findsNothing);
    expect(find.byType(InkResponse), findsNothing);
  });

  testWidgets('Account photo controls are obvious and accessible', (
    tester,
  ) async {
    var changes = 0;
    var removals = 0;
    final semantics = tester.ensureSemantics();

    await tester.pumpWidget(
      _wrap(
        PhotoManagementControls(
          subjectName: 'Mum',
          hasPhoto: true,
          onChange: () => changes++,
          onRemove: () => removals++,
        ),
      ),
    );

    expect(find.text('Change photo'), findsOneWidget);
    expect(find.text('Remove photo'), findsOneWidget);
    expect(find.bySemanticsLabel('Change photo for Mum'), findsOneWidget);
    expect(find.bySemanticsLabel('Remove photo for Mum'), findsOneWidget);

    await tester.tap(find.text('Change photo'));
    await tester.tap(find.text('Remove photo'));
    expect(changes, 1);
    expect(removals, 1);
    semantics.dispose();
  });

  testWidgets(
    'GuardianBottomNav shows localized English labels and reports taps',
    (tester) async {
      var tapped = -1;
      await tester.pumpWidget(
        _wrap(GuardianBottomNav(currentIndex: 0, onTap: (i) => tapped = i)),
      );

      expect(find.text('Home'), findsOneWidget);
      expect(find.text('Safe zones'), findsOneWidget);
      expect(find.text('Alerts'), findsOneWidget);
      expect(find.text('Account'), findsOneWidget);
      expect(find.text('3 SEC'), findsOneWidget);

      await tester.tap(find.text('Alerts'));
      expect(tapped, 2);
    },
  );

  testWidgets('SOS requires a full three-second hold', (tester) async {
    var sosTriggered = false;
    await tester.pumpWidget(
      _wrap(
        MobileBottomBar(
          currentIndex: 0,
          onTap: (_) {},
          onSos: () => sosTriggered = true,
        ),
      ),
    );

    final gesture = await tester.startGesture(
      tester.getCenter(find.text('SOS')),
    );
    await tester.pump(const Duration(milliseconds: 2900));
    expect(sosTriggered, isFalse);

    await tester.pump(const Duration(milliseconds: 100));
    expect(sosTriggered, isTrue);
    await gesture.up();
  });

  testWidgets('GuardianBottomNav shows French labels when locale is fr', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        GuardianBottomNav(currentIndex: 0, onTap: (_) {}),
        locale: const Locale('fr'),
      ),
    );

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Zones sûres'), findsOneWidget);
    expect(find.text('Alertes'), findsOneWidget);
    expect(find.text('Compte'), findsOneWidget);
  });

  testWidgets('DesktopSidebar uses the same destinations and reports taps', (
    tester,
  ) async {
    var tapped = -1;
    await tester.pumpWidget(
      _wrap(_TestDesktopSidebarHost(onTap: (i) => tapped = i)),
    );

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Safe zones'), findsOneWidget);
    expect(find.text('Alerts'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);

    await tester.tap(find.text('Account'));
    expect(tapped, 3);
  });

  testWidgets('DesktopSidebar collapse toggle hides labels', (tester) async {
    SharedPreferences.setMockInitialValues({});
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _wrap(_TestDesktopSidebarHost(onTap: (_) {})),
    );
    await tester.pumpAndSettle();

    expect(find.text('Safe zones'), findsOneWidget);
    expect(find.text('Proudly Mauritian'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.chevron_left_rounded));
    await tester.pumpAndSettle(const Duration(milliseconds: 300));

    expect(find.text('Safe zones'), findsNothing);
    expect(find.text('Proudly Mauritian'), findsNothing);
    expect(find.byIcon(Icons.home_outlined), findsOneWidget);

    await tester.tap(find.byIcon(Icons.chevron_right_rounded));
    await tester.pumpAndSettle(const Duration(milliseconds: 300));

    expect(find.text('Safe zones'), findsOneWidget);
    expect(find.text('Proudly Mauritian'), findsOneWidget);
  });

  testWidgets('Theme sidebar toggle and dialog do not crash', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _wrap(_TestDesktopSidebarHost(onTap: (_) {})),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Theme'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(find.text('Island Glass'), findsOneWidget);

    GuardianThemeId? selected;
    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(),
        localizationsDelegates: guardianLocalizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: GuardianThemeScope(
          themeId: GuardianThemeId.defaultTheme,
          onThemeChanged: (theme) => selected = theme,
          child: Theme(
            data: buildGuardianTheme(),
            child: Builder(
              builder: (context) => Scaffold(
                body: FilledButton(
                  onPressed: () => showThemePickerDialog(context),
                  child: const Text('open-theme'),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('open-theme'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Le Morne'));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
    expect(selected, GuardianThemeId.leMorne);
  });

  testWidgets('Theme flyout stays visible beside main content', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    GuardianThemeId? selected;
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: guardianLocalizationsDelegates,
        home: GuardianThemeScope(
          themeId: GuardianThemeId.defaultTheme,
          onThemeChanged: (theme) => selected = theme,
          child: Theme(
            data: buildGuardianTheme(),
            child: Scaffold(
              body: Row(
                children: [
                  _TestDesktopSidebarHost(onTap: (_) {}),
                  Expanded(
                    child: Container(color: Colors.blue),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Theme'));
    await tester.pumpAndSettle();

    expect(find.text('Island Glass'), findsOneWidget);
    expect(find.text('Le Morne'), findsOneWidget);
    expect(find.text('Elder Care'), findsOneWidget);

    await tester.tap(find.text('Le Morne'));
    await tester.pumpAndSettle();

    expect(selected, GuardianThemeId.leMorne);
    expect(find.text('Le Morne'), findsNothing);
  });

  testWidgets('Theme flyout uses light text on dark overlay', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _wrap(_TestDesktopSidebarHost(onTap: (_) {})),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Theme'));
    await tester.pumpAndSettle();

    final title = tester.widget<Text>(find.text('Theme').last);
    expect(title.style?.color, Colors.white);

    final unselected = tester.widget<Text>(find.text('Le Morne'));
    expect(unselected.style?.color, const Color(0xB3FFFFFF));

    final selected = tester.widget<Text>(find.text('Island Glass'));
    expect(selected.style?.color, GuardianColors.safeText);
  });

  testWidgets('ResponsiveLayout switches at the desktop breakpoint', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    tester.view.physicalSize = const Size(500, 800);
    await tester.pumpWidget(
      _wrap(
        const ResponsiveLayout(
          mobile: Text('mobile-layout'),
          desktop: Text('desktop-layout'),
        ),
      ),
    );
    expect(find.text('mobile-layout'), findsOneWidget);

    tester.view.physicalSize = const Size(1200, 800);
    await tester.pumpAndSettle();
    expect(find.text('desktop-layout'), findsOneWidget);
  });

  testWidgets('HomeShellScope exposes sidebar collapse to descendants', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: HomeShellScope(
          currentIndex: 0,
          goToTab: (_) {},
          sidebarCollapsed: true,
          child: Builder(
            builder: (context) {
              final collapsed =
                  HomeShellScope.maybeOf(context)?.sidebarCollapsed ?? false;
              return Text(collapsed ? 'sidebar-collapsed' : 'sidebar-expanded');
            },
          ),
        ),
      ),
    );

    expect(find.text('sidebar-collapsed'), findsOneWidget);
  });

  testWidgets('HomeShellScope forwards tab changes to the shell', (
    tester,
  ) async {
    var tab = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: HomeShellScope(
          currentIndex: tab,
          goToTab: (index) => tab = index,
          child: Builder(
            builder: (context) => FilledButton(
              onPressed: () => HomeShellScope.maybeOf(context)?.goToTab(1),
              child: const Text('open-safe-zones'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('open-safe-zones'));
    expect(tab, 1);
  });

  testWidgets('Desktop dashboard grid renders without overflow', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1000, 920);
    addTearDown(tester.view.reset);

    Widget panel(String label) => ColoredBox(
      color: Colors.white,
      child: Center(child: Text(label)),
    );

    await tester.pumpWidget(
      _wrap(
        DesktopDashboardLayout(
          topBar: panel('header'),
          safetySummary: panel('safety'),
          liveStatus: panel('status'),
          map: panel('map'),
          devices: panel('devices'),
          aiInsight: panel('ai'),
          timeline: panel('timeline'),
          quickActions: panel('actions'),
          bottomStatus: panel('bottom'),
        ),
      ),
    );

    expect(find.text('map'), findsOneWidget);
    expect(find.text('timeline'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('Kreol Morisien translations are present for the core nav labels', () {
    final t = AppLocalizationsMfe();
    expect(t.navMap, 'Kart');
    expect(t.navAlerts, 'Alert');
    expect(t.navAccount, 'Kont');
  });

  testWidgets(
    'locale mfe does not crash a widget that requires MaterialLocalizations',
    (tester) async {
      // Regression test: Flutter's built-in Material/Cupertino/Widgets
      // localizations don't ship an 'mfe' translation. Without the fallback
      // delegates in guardianLocalizationsDelegates, any widget requiring
      // MaterialLocalizations (PopupMenuButton, here) throws as soon as the
      // app locale is set to 'mfe' -- this is exactly what happened on the
      // Safe Zones page's per-zone menu the first time this was tried live.
      await tester.pumpWidget(
        _wrap(
          PopupMenuButton<String>(
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'a', child: Text('A')),
            ],
          ),
          locale: const Locale('mfe'),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(find.byType(PopupMenuButton<String>), findsOneWidget);
    },
  );

  testWidgets('DashboardDesktopTopBar hides left title when sidebar is expanded', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        HomeShellScope(
          currentIndex: 0,
          goToTab: (_) {},
          sidebarCollapsed: false,
          child: DashboardDesktopTopBar(
            userInitials: 'VK',
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    expect(find.text('Home'), findsNothing);
    expect(find.text('Guardian'), findsNothing);
    expect(find.byType(DashboardGuardianSloganText), findsNothing);
  });

  testWidgets('DashboardDesktopTopBar shows brand when sidebar is collapsed', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        HomeShellScope(
          currentIndex: 0,
          goToTab: (_) {},
          sidebarCollapsed: true,
          child: DashboardDesktopTopBar(
            userInitials: 'VK',
            avatarUrls: Stream<String?>.value(null),
          ),
        ),
      ),
    );

    expect(find.text('Guardian'), findsOneWidget);
    expect(find.byType(DashboardGuardianSloganText), findsOneWidget);
    expect(find.text('Home'), findsNothing);
  });

  testWidgets('DashboardDesktopTopBar reacts when sidebar collapse toggles', (
    tester,
  ) async {
    var collapsed = false;

    await tester.pumpWidget(
      MaterialApp(
        home: GuardianThemeScope(
          themeId: GuardianThemeId.defaultTheme,
          onThemeChanged: (_) {},
          child: Theme(
            data: buildGuardianTheme(),
            child: StatefulBuilder(
              builder: (context, setState) {
                return HomeShellScope(
                  currentIndex: 0,
                  goToTab: (_) {},
                  sidebarCollapsed: collapsed,
                  child: Column(
                    children: [
                      DashboardDesktopTopBar(
                        userInitials: 'VK',
                        avatarUrls: Stream<String?>.value(null),
                      ),
                      TextButton(
                        onPressed: () => setState(() => collapsed = !collapsed),
                        child: const Text('toggle-sidebar'),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      ),
    );

    expect(find.text('Home'), findsNothing);
    expect(find.text('Guardian'), findsNothing);

    await tester.tap(find.text('toggle-sidebar'));
    await tester.pumpAndSettle();

    expect(find.text('Guardian'), findsOneWidget);
    expect(find.byType(DashboardGuardianSloganText), findsOneWidget);
    expect(find.text('Home'), findsNothing);

    await tester.tap(find.text('toggle-sidebar'));
    await tester.pumpAndSettle();

    expect(find.text('Home'), findsNothing);
    expect(find.text('Guardian'), findsNothing);
  });
}
