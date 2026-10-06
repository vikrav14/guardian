import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/theme/app_theme.dart';

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);
  for (final palette in GuardianThemeId.values) {
    testWidgets(
      '${palette.name} actions meet text contrast on every control surface',
      (tester) async {
        final theme = buildGuardianTheme(themeId: palette);
        final scheme = theme.colorScheme;
        final colors = palette.semanticColors;
        expect(
          guardianContrast(scheme.primary, scheme.onPrimary),
          greaterThanOrEqualTo(4.5),
        );
        for (final surface in [
          colors.surface,
          colors.surfaceMuted,
          colors.canvas,
          colors.accentMuted,
        ]) {
          expect(
            guardianContrast(scheme.primary, surface),
            greaterThanOrEqualTo(4.5),
          );
        }
      },
    );
    testWidgets(
      '${palette.name} controls fit 320px at 2x text and retain disabled behaviour',
      (tester) async {
        tester.view.physicalSize = const Size(320, 1000);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        var taps = 0;
        await tester.pumpWidget(
          MaterialApp(
            theme: buildGuardianTheme(themeId: palette),
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: Scaffold(
              body: Builder(
                builder: (context) => ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    FilledButton(
                      onPressed: () => taps++,
                      child: const Text('Save changes'),
                    ),
                    OutlinedButton(
                      onPressed: () => taps++,
                      child: const Text('View watch settings'),
                    ),
                    TextButton(
                      onPressed: () => taps++,
                      child: const Text('Learn about your plan'),
                    ),
                    const FilledButton(
                      onPressed: null,
                      child: Text('Please wait'),
                    ),
                    FilledButton(
                      style: GuardianControlStyles.destructive(context),
                      onPressed: () {},
                      child: const Text('Remove access'),
                    ),
                    IconButton(
                      tooltip: 'Refresh',
                      onPressed: () {},
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        for (final label in [
          'Save changes',
          'View watch settings',
          'Learn about your plan',
        ]) {
          final target = find
              .ancestor(
                of: find.text(label),
                matching: find.byWidgetPredicate(
                  (widget) => widget is ButtonStyleButton,
                ),
              )
              .first;
          expect(tester.getSize(target).height, greaterThanOrEqualTo(48));
          await tester.tap(find.text(label));
        }
        await tester.tap(find.text('Please wait'));
        final removal = tester.widget<FilledButton>(
          find.ancestor(
            of: find.text('Remove access'),
            matching: find.byType(FilledButton),
          ),
        );
        final context = tester.element(find.text('Remove access'));
        final style = removal.style!;
        expect(
          style.backgroundColor!.resolve({}),
          GuardianControlStyles.dangerColor(context),
        );
        expect(
          guardianContrast(
            style.backgroundColor!.resolve({})!,
            style.foregroundColor!.resolve({})!,
          ),
          greaterThanOrEqualTo(4.5),
        );
        final link = GuardianControlStyles.destructiveLink(context);
        expect(
          link.foregroundColor!.resolve({}),
          GuardianControlStyles.dangerColor(context),
        );
        expect(
          link.foregroundColor!.resolve({WidgetState.disabled}),
          context.guardianColors.textSecondary,
        );
        expect(taps, 3);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
