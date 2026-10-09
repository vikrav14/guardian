import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/navigation/guardian_navigation_shell.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/navigation/guardian_side_menu.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<GlobalKey<NavigatorState>> pumpShell(
    WidgetTester tester, {
    double width = 390,
    double scale = 1,
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = Size(width, 844);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final navigator = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(themeId: GuardianThemeId.flicEnFlac),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: GuardianNavigationShell(
          navigatorKey: navigator,
          watchName: 'Jesh',
          pages: const [
            _FormPage(),
            Text('Zones page'),
            Text('Family page'),
            Text('Watch list'),
            Text('Alerts page'),
            Text('Account page'),
          ],
          headerBuilder: (_) =>
              const SizedBox(height: 60, child: Text('Guardian')),
          watchPageBuilder: (destination) async => Scaffold(
            appBar: AppBar(title: Text('${destination.label} page')),
            body: const TextField(
              decoration: InputDecoration(labelText: 'Detail field'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return navigator;
  }

  testWidgets(
    'phone keeps icons, drawer labels and page input while toggling',
    (tester) async {
      await pumpShell(tester);
      await tester.enterText(find.byType(TextField), 'Keep this draft');
      final fieldBefore = tester.getRect(find.byType(TextField));
      expect(find.byTooltip('Safe zones'), findsOneWidget);
      expect(find.text("JESH'S WATCH"), findsNothing);
      await tester.tap(find.byTooltip('Expand menu'));
      await tester.pumpAndSettle();
      expect(find.text("JESH'S WATCH"), findsOneWidget);
      expect(find.text('Safety & preferences'), findsOneWidget);
      expect(tester.getRect(find.byType(TextField)), fieldBefore);
      await tester.tap(find.byTooltip('Collapse menu'));
      await tester.pumpAndSettle();
      expect(find.text('Keep this draft'), findsOneWidget);
      expect(find.byTooltip('Expand menu'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'drawer navigation collapses and back keeps the selected page state',
    (tester) async {
      final navigator = await pumpShell(tester);
      await tester.enterText(find.byType(TextField), 'Home draft');
      await tester.tap(find.byTooltip('Expand menu'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Journey'));
      await tester.pumpAndSettle();
      expect(find.byType(Drawer), findsNothing);
      expect(find.text('Journey page'), findsOneWidget);
      expect(
        tester.widget<GuardianSideMenu>(find.byType(GuardianSideMenu)).selected,
        GuardianMenuDestination.journey,
      );
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Home draft'), findsOneWidget);
      expect(navigator.currentState!.canPop(), isFalse);
    },
  );

  testWidgets('icon navigation respects save-in-progress PopScope', (
    tester,
  ) async {
    final navigator = await pumpShell(tester);
    navigator.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => const PopScope(
          canPop: false,
          child: Scaffold(body: Text('Saving')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Journey'));
    await tester.pumpAndSettle();
    expect(find.text('Saving'), findsOneWidget);
    expect(find.text('Journey page'), findsNothing);
  });

  testWidgets('screen readers can reach the rail while a detail is open', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await pumpShell(tester);
      void expectMenuAccessible() => expect(
        tester.semantics.simulatedAccessibilityTraversal(),
        containsAll([
          isSemantics(tooltip: 'Expand menu'),
          isSemantics(label: 'Home'),
          isSemantics(label: 'Journey'),
        ]),
      );
      expectMenuAccessible();
      await tester.tap(find.byTooltip('Journey'));
      await tester.pumpAndSettle();
      expectMenuAccessible();
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('desktop sidebar becomes phone rail without resetting a detail', (
    tester,
  ) async {
    final navigator = await pumpShell(tester, width: 1360);
    final state = navigator.currentState;
    expect(find.text("JESH'S WATCH"), findsOneWidget);
    await tester.tap(find.text('Wellness'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Detail draft');
    tester.view.physicalSize = const Size(320, 844);
    await tester.pumpAndSettle();
    expect(navigator.currentState, same(state));
    expect(find.text('Detail draft'), findsOneWidget);
    expect(find.byTooltip('Expand menu'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'small phone and large text keep all menu destinations reachable',
    (tester) async {
      await pumpShell(tester, width: 320, scale: 2);
      await tester.tap(find.byTooltip('Expand menu'));
      await tester.pumpAndSettle();
      final contacts = find.text('Emergency contacts');
      await tester.ensureVisible(contacts);
      await tester.pumpAndSettle();
      await tester.tap(contacts);
      await tester.pumpAndSettle();
      expect(find.text('Emergency contacts page'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}

class _FormPage extends StatelessWidget {
  const _FormPage();
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(16),
    child: TextField(decoration: InputDecoration(labelText: 'Home field')),
  );
}
