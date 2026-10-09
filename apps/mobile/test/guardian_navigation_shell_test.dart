import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/navigation/guardian_navigation_shell.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Future<GlobalKey<NavigatorState>> pumpShell(WidgetTester tester) async {
    final navigator = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Theme(
          data: buildGuardianTheme(themeId: GuardianThemeId.sugarBeach),
          child: GuardianNavigationShell(
            navigatorKey: navigator,
            pages: const [
              _Page('Home page'),
              _Page('Zones page'),
              _Page('Family page'),
              _Page('Watch page'),
            ],
            headerBuilder: (_) => const Text('App header'),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return navigator;
  }

  testWidgets('detail and nested settings keep one bar, theme and back stack', (
    tester,
  ) async {
    final navigator = await pumpShell(tester);
    await tester.tap(find.text('Watch'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Open Watch page'));
    await tester.pumpAndSettle();
    expect(find.text('App header'), findsNothing);
    expect(find.byType(MobileBottomBar), findsOneWidget);
    final detailContext = tester.element(find.text('Detail'));
    expect(detailContext.guardianColors, GuardianThemeColors.sugarBeach);
    await tester.tap(find.text('Open nested settings'));
    await tester.pumpAndSettle();
    expect(find.text('Nested settings'), findsOneWidget);
    expect(find.byType(MobileBottomBar), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Detail'), findsOneWidget);
    await tester.tap(find.text('Family'));
    await tester.pumpAndSettle();
    expect(find.text('Open Family page'), findsOneWidget);
    expect(navigator.currentState!.canPop(), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Android back returns to the current tab before leaving app', (
    tester,
  ) async {
    await pumpShell(tester);
    await tester.tap(find.text('Open Home page'));
    await tester.pumpAndSettle();
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Open Home page'), findsOneWidget);
    expect(find.byType(MobileBottomBar), findsOneWidget);
  });

  testWidgets('resizing between sidebar and phone keeps the open route', (
    tester,
  ) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = const Size(1360, 1000);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPhysicalSize);
    final navigator = await pumpShell(tester);
    final state = navigator.currentState;
    await tester.tap(find.text('Open Home page'));
    await tester.pumpAndSettle();
    expect(find.text('Detail'), findsOneWidget);
    tester.view.physicalSize = const Size(390, 844);
    await tester.pumpAndSettle();
    expect(navigator.currentState, same(state));
    expect(find.text('Detail'), findsOneWidget);
    expect(find.byType(MobileBottomBar), findsOneWidget);
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('Open Home page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tab change respects a settings page that blocks leaving', (
    tester,
  ) async {
    final navigator = await pumpShell(tester);
    navigator.currentState!.push(
      MaterialPageRoute<void>(
        builder: (_) => const PopScope(
          canPop: false,
          child: Scaffold(body: Text('Saving a recording')),
        ),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Family'));
    await tester.pumpAndSettle();
    expect(find.text('Saving a recording'), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.text('Saving a recording'), findsOneWidget);
  });

  testWidgets('leaving a map picker cancels its result and containing flow', (
    tester,
  ) async {
    final navigator = await pumpShell(tester);
    final dialog = navigator.currentState!.push<bool>(
      DialogRoute<bool>(
        context: navigator.currentContext!,
        builder: (_) => const AlertDialog(content: Text('Unsaved zone')),
      ),
    );
    await tester.pumpAndSettle();
    final picker = navigator.currentState!.push<String>(
      MaterialPageRoute<String>(
        builder: (_) => const Scaffold(body: Text('Map picker')),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Family'));
    await tester.pumpAndSettle();
    expect(await picker, isNull);
    expect(await dialog, isNull);
    expect(find.text('Open Family page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('root confirmation stays modal over navigation', (tester) async {
    await pumpShell(tester);
    final context = tester.element(find.text('Open Home page'));
    showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Confirm action'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
        ],
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Family').hitTestable(), findsNothing);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Family').hitTestable(), findsOneWidget);
  });
}

class _Page extends StatelessWidget {
  const _Page(this.title);
  final String title;

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: FilledButton(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (context) => Scaffold(
              appBar: AppBar(title: const Text('Detail')),
              body: FilledButton(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => Scaffold(
                      appBar: AppBar(title: const Text('Nested settings')),
                    ),
                  ),
                ),
                child: const Text('Open nested settings'),
              ),
            ),
          ),
        ),
        child: Text('Open $title'),
      ),
    ),
  );
}
