import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/l10n/app_localizations_mfe.dart';
import 'package:guardian/main.dart';
import 'package:guardian/navigation/home_shell_scope.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/guardian_widgets.dart';
import 'package:guardian/widgets/dashboard/desktop_dashboard_layout.dart';
import 'package:guardian/widgets/dashboard/responsive_layout.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/theme/theme_picker.dart';

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

      await tester.tap(find.text('Alerts'));
      expect(tapped, 2);
    },
  );

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
      _wrap(DesktopSidebar(currentIndex: 0, onTap: (i) => tapped = i)),
    );

    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Safe zones'), findsOneWidget);
    expect(find.text('Alerts'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);

    await tester.tap(find.text('Account'));
    expect(tapped, 3);
  });

  testWidgets('Theme sidebar toggle and dialog do not crash', (tester) async {
    tester.view.physicalSize = const Size(1200, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      _wrap(DesktopSidebar(currentIndex: 0, onTap: (_) {})),
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
                  DesktopSidebar(currentIndex: 0, onTap: (_) {}),
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
}
