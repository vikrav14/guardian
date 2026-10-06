import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/widgets/navigation/guardian_navigation_icon.dart';

Future<void> _pumpBar(
  WidgetTester tester, {
  ValueChanged<int>? onTap,
  double width = 390,
  double textScale = 1,
  bool dark = false,
  bool highContrast = false,
  bool reducedMotion = false,
  int currentIndex = 0,
  Locale locale = const Locale('en'),
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 730);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  final colors = highContrast
      ? GuardianThemeColors.elderCare
      : dark
      ? GuardianThemeColors.dark
      : GuardianThemeColors.light;
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
          highContrast: highContrast,
          disableAnimations: reducedMotion,
        ),
        child: child!,
      ),
      home: Scaffold(
        body: const SizedBox.expand(key: ValueKey('page-body')),
        bottomNavigationBar: MobileBottomBar(
          currentIndex: currentIndex,
          onTap: onTap ?? (_) {},
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('two-tone icons share a baseline at enlarged text', (
    tester,
  ) async {
    await _pumpBar(
      tester,
      width: 320,
      textScale: 2,
      locale: const Locale('fr'),
    );
    final icons = find.byType(GuardianNavigationIcon);
    expect(icons, findsNWidgets(4));
    final top = tester.getTopLeft(icons.first).dy;
    for (var i = 1; i < 4; i++) {
      expect(tester.getTopLeft(icons.at(i)).dy, closeTo(top, .5));
    }
    expect(tester.takeException(), isNull);
  });

  testWidgets('selected tab respects semantics, contrast and reduced motion', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    try {
      await _pumpBar(
        tester,
        currentIndex: 3,
        highContrast: true,
        reducedMotion: true,
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('Account')),
        matchesSemantics(
          label: 'Account',
          isButton: true,
          hasSelectedState: true,
          isSelected: true,
          hasTapAction: true,
        ),
      );
      for (final icon in tester.widgetList<GuardianNavigationIcon>(
        find.byType(GuardianNavigationIcon),
      )) {
        expect(icon.highContrast, isTrue);
      }
      for (final mark in tester.widgetList<AnimatedContainer>(
        find.descendant(
          of: find.byType(MobileBottomBar),
          matching: find.byType(AnimatedContainer),
        ),
      )) {
        expect(mark.duration, Duration.zero);
      }
      expect(tester.takeException(), isNull);
    } finally {
      semantics.dispose();
    }
  });

  testWidgets('each destination keeps its existing shell index', (
    tester,
  ) async {
    final destinations = <int>[];
    await _pumpBar(tester, onTap: destinations.add);

    for (final label in ['Home', 'Safe zones', 'Alerts', 'Account']) {
      await tester.tap(find.text(label));
    }
    expect(destinations, [0, 1, 2, 3]);
  });

  testWidgets('bottom bar has main destinations and no alarm or photo action', (
    tester,
  ) async {
    await _pumpBar(tester);
    expect(find.text('SOS'), findsNothing);
    expect(find.text('Photos'), findsNothing);
    expect(find.text('Hold 3 sec'), findsNothing);
    expect(find.byType(GuardianNavigationIcon), findsNWidgets(4));
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
        for (final target
            in find
                .descendant(
                  of: find.byType(MobileBottomBar),
                  matching: find.byType(InkWell),
                )
                .evaluate()) {
          final size = target.size!;
          expect(size.width, greaterThanOrEqualTo(48));
          expect(size.height, greaterThanOrEqualTo(48));
        }
      });
    }
  }
}
