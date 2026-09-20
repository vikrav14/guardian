import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/cards/guardian_surface.dart';

void main() {
  for (final palette in [
    GuardianThemeColors.light,
    GuardianThemeColors.dark,
    GuardianThemeColors.elderCare,
  ]) {
    testWidgets('card controls retain ink and expansion with $palette', (
      tester,
    ) async {
      var taps = 0;
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(
            brightness: palette == GuardianThemeColors.dark
                ? Brightness.dark
                : Brightness.light,
            extensions: [palette],
          ),
          home: Scaffold(
            body: GuardianSurface(
              tonal: true,
              tint: Colors.pink,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ListTile(
                    title: const Text('Open record'),
                    onTap: () => taps++,
                  ),
                  const ExpansionTile(
                    title: Text('Reading log'),
                    children: [Text('Saved reading')],
                  ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open record'));
      expect(taps, 1);
      await tester.tap(find.text('Reading log'));
      await tester.pumpAndSettle();
      expect(find.text('Saved reading').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
      if (palette == GuardianThemeColors.elderCare) {
        final ink = tester.widget<Ink>(
          find
              .descendant(
                of: find.byType(GuardianSurface),
                matching: find.byType(Ink),
              )
              .first,
        );
        expect((ink.decoration! as BoxDecoration).gradient, isNull);
      }
    });
  }

  testWidgets('system high contrast removes decorative gradients', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(highContrast: true),
          child: GuardianSurface(child: Text('Record')),
        ),
      ),
    );
    final ink = tester.widget<Ink>(find.byType(Ink));
    expect((ink.decoration! as BoxDecoration).gradient, isNull);
    expect(tester.takeException(), isNull);
  });
}
