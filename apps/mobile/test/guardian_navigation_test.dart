import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';

Future<void> _pumpBar(
  WidgetTester tester, {
  VoidCallback? onSos,
  ValueChanged<int>? onTap,
  double width = 390,
  double textScale = 1,
  bool dark = false,
  Locale locale = const Locale('en'),
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 730);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  final colors = dark ? GuardianThemeColors.dark : GuardianThemeColors.light;
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      theme: ThemeData(
        brightness: dark ? Brightness.dark : Brightness.light,
        extensions: [colors],
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: Scaffold(
        body: const SizedBox.expand(key: ValueKey('page-body')),
        bottomNavigationBar: MobileBottomBar(
          currentIndex: 0,
          onTap: onTap ?? (_) {},
          onSos: onSos ?? () {},
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('each destination keeps its existing shell index', (tester) async {
    final destinations = <int>[];
    var sosCount = 0;
    await _pumpBar(
      tester,
      onTap: destinations.add,
      onSos: () => sosCount++,
    );

    for (final label in ['Home', 'Safe zones', 'Alerts', 'Account']) {
      await tester.tap(find.text(label));
    }
    expect(destinations, [0, 1, 2, 3]);
    expect(sosCount, 0);
  });

  testWidgets('a tap cannot send SOS', (tester) async {
    var sent = 0;
    await _pumpBar(tester, onSos: () => sent++);

    await tester.tap(find.text('SOS'));
    await tester.pump(const Duration(seconds: 4));

    expect(sent, 0);
    expect(find.text('Hold 3 sec'), findsOneWidget);
  });

  testWidgets('early release cancels SOS and the next hold starts over', (
    tester,
  ) async {
    var sent = 0;
    await _pumpBar(tester, onSos: () => sent++);
    var gesture = await tester.startGesture(tester.getCenter(find.text('SOS')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 2900));
    await gesture.up();
    await tester.pump(const Duration(seconds: 1));
    expect(sent, 0);

    gesture = await tester.startGesture(tester.getCenter(find.text('SOS')));
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 2900));
    expect(sent, 0);
    await tester.pump(const Duration(milliseconds: 100));
    expect(sent, 1);
    await gesture.up();
  });

  testWidgets('a completed hold sends SOS once until the pointer is released', (
    tester,
  ) async {
    var sent = 0;
    await _pumpBar(tester, onSos: () => sent++);
    final gesture = await tester.startGesture(
      tester.getCenter(find.text('SOS')),
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 2900));
    expect(sent, 0);
    await tester.pump(const Duration(milliseconds: 100));
    expect(sent, 1);
    await tester.pump(const Duration(seconds: 3));
    expect(sent, 1);
    await gesture.up();
  });

  testWidgets('a cancelled gesture cannot send SOS later', (tester) async {
    var sent = 0;
    await _pumpBar(tester, onSos: () => sent++);
    final gesture = await tester.startGesture(
      tester.getCenter(find.text('SOS')),
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(seconds: 2));
    await gesture.cancel();
    await tester.pump(const Duration(seconds: 3));

    expect(sent, 0);
    expect(find.text('Hold 3 sec'), findsOneWidget);
  });

  testWidgets('disposing navigation cancels an unfinished SOS hold', (
    tester,
  ) async {
    var sent = 0;
    await _pumpBar(tester, onSos: () => sent++);
    final gesture = await tester.startGesture(
      tester.getCenter(find.text('SOS')),
    );
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(seconds: 2));
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 3));
    await gesture.up();

    expect(sent, 0);
    expect(tester.takeException(), isNull);
  });

  for (final dark in [false, true]) {
    for (final textScale in [1.0, 2.0]) {
      testWidgets('navigation fits 320 px, dark $dark, ${textScale}x text', (
        tester,
      ) async {
        await _pumpBar(
          tester,
          width: 320,
          textScale: textScale,
          dark: dark,
          locale: const Locale('fr'),
        );

        expect(tester.takeException(), isNull);
        expect(find.text('Zones sûres'), findsOneWidget);
        final nav = tester.getRect(find.byType(MobileBottomBar));
        final body = tester.getRect(find.byKey(const ValueKey('page-body')));
        expect(body.bottom, lessThanOrEqualTo(nav.top));
        for (final target in find.descendant(
          of: find.byType(MobileBottomBar),
          matching: find.byType(InkWell),
        ).evaluate()) {
          final size = target.size!;
          expect(size.width, greaterThanOrEqualTo(48));
          expect(size.height, greaterThanOrEqualTo(48));
        }
      });
    }
  }
}
