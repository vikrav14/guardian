import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/navigation/guardian_navigation_shell.dart';
import 'package:guardian/screens/family_access_page.dart';
import 'package:guardian/services/family_sharing_service.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function(Map<String, dynamic>) save,
  double width = 390,
  double scale = 1,
  Map<String, dynamic>? member,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 844);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetViewInsets);
  final navigator = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      theme: buildGuardianTheme(themeId: GuardianThemeId.chamarel),
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
        headerBuilder: (_) => const SizedBox.shrink(),
        pages: const [
          Text('Home page'),
          Text('Zones page'),
          Text('Family page'),
          Text('Watch page'),
        ],
      ),
    ),
  );
  await tester.pumpAndSettle();
  navigator.currentState!.push(
    MaterialPageRoute<bool>(
      builder: (_) =>
          FamilyAccessPage(wearer: 'Amira', member: member, onSave: save),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _switch(WidgetTester tester, String key) async {
  final target = find.byKey(ValueKey('access-$key'));
  await tester.ensureVisible(target);
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  testWidgets(
    'email validation and keyboard layouts keep navigation and save reachable',
    (tester) async {
      for (final layout in [(320.0, 2.0), (390.0, 1.0), (1100.0, 1.0)]) {
        var saves = 0;
        await _pump(
          tester,
          width: layout.$1,
          scale: layout.$2,
          save: (_) async {
            saves++;
          },
        );
        await tester.tap(find.text('Create invitation'));
        await tester.pumpAndSettle();
        expect(find.text('Enter a valid email address.'), findsOneWidget);
        expect(saves, 0);
        await tester.enterText(
          find.byType(TextFormField),
          'grandma@example.test',
        );
        tester.view.viewInsets = const FakeViewPadding(bottom: 300);
        await tester.pumpAndSettle();
        final bottom = tester
            .getBottomRight(
              find.widgetWithText(FilledButton, 'Create invitation'),
            )
            .dy;
        expect(bottom, lessThanOrEqualTo(844 - 300));
        expect(bottom, greaterThan(844 - 300 - 40));
        expect(find.byType(MobileBottomBar), findsOneWidget);
        expect(tester.takeException(), isNull);
        tester.view.resetViewInsets();
        await tester.pumpWidget(const SizedBox());
      }
    },
  );

  testWidgets(
    'custom permissions enforce location dependencies and preserve the payload',
    (tester) async {
      Map<String, dynamic>? sent;
      await _pump(
        tester,
        save: (value) async {
          sent = value;
        },
      );
      await tester.enterText(
        find.byType(TextFormField),
        '  grandma@example.test  ',
      );
      await _switch(tester, 'history');
      await _switch(tester, 'zones');
      await _switch(tester, 'location');
      for (final key in ['location', 'history', 'zones']) {
        expect(
          tester
              .widget<SwitchListTile>(find.byKey(ValueKey('access-$key')))
              .value,
          isFalse,
        );
      }
      await _switch(tester, 'history');
      await tester.tap(find.text('Create invitation'));
      await tester.pumpAndSettle();
      expect(sent!['email'], 'grandma@example.test');
      expect(sent!['role'], 'viewer');
      expect(sent!['permissions'], {
        ...familyPreset('viewer'),
        'history': true,
      });
      expect(sent!['untilMs'], isNull);
      expect(sent!.containsKey('whatsapp'), isFalse);
      expect(find.byType(FamilyAccessPage), findsNothing);
    },
  );

  testWidgets(
    'role presets and a temporary invitation use the selected access',
    (tester) async {
      Map<String, dynamic>? sent;
      await _pump(
        tester,
        save: (value) async {
          sent = value;
        },
      );
      await tester.enterText(
        find.byType(TextFormField),
        'relative@example.test',
      );
      await tester.ensureVisible(find.text('Viewer'));
      await tester.tap(find.text('Viewer'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Caregiver').last);
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Ongoing'));
      await tester.tap(find.text('Ongoing'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('7 days').last);
      await tester.pumpAndSettle();
      final before = DateTime.now()
          .add(const Duration(days: 7))
          .millisecondsSinceEpoch;
      await tester.tap(find.text('Create invitation'));
      await tester.pumpAndSettle();
      expect(sent!['role'], 'caregiver');
      expect(sent!['permissions'], familyPreset('caregiver'));
      expect(sent!['untilMs'], inInclusiveRange(before, before + 2000));
    },
  );

  testWidgets('editing retains expiry and does not send an invitation email', (
    tester,
  ) async {
    Map<String, dynamic>? sent;
    final until = DateTime.now()
        .add(const Duration(days: 3))
        .millisecondsSinceEpoch;
    await _pump(
      tester,
      save: (value) async {
        sent = value;
      },
      member: {
        'name': 'Marcel',
        'role': 'viewer',
        'permissions': familyPreset('viewer'),
        'untilMs': until,
      },
    );
    expect(find.byType(TextFormField), findsNothing);
    await tester.tap(find.text('Save access'));
    await tester.pumpAndSettle();
    expect(sent!['untilMs'], until);
    expect(sent!.containsKey('email'), isFalse);
  });

  testWidgets(
    'failed save retains draft, blocks duplicates while saving and allows retry',
    (tester) async {
      final pending = Completer<void>();
      var saves = 0;
      await _pump(
        tester,
        save: (_) async {
          saves++;
          if (saves == 1) await pending.future;
        },
      );
      await tester.enterText(
        find.byType(TextFormField),
        'relative@example.test',
      );
      await tester.tap(find.text('Create invitation'));
      await tester.pump();
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Saving…'))
            .onPressed,
        isNull,
      );
      await tester.tap(find.text('Home'));
      await tester.pumpAndSettle();
      expect(find.byType(FamilyAccessPage), findsOneWidget);
      pending.completeError(
        const FamilySharingException('invitation_already_pending'),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('An invitation is already waiting for this email address.'),
        findsOneWidget,
      );
      expect(find.text('relative@example.test'), findsOneWidget);
      expect(saves, 1);
      await tester.tap(find.text('Create invitation'));
      await tester.pumpAndSettle();
      expect(saves, 2);
      expect(find.byType(FamilyAccessPage), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'leaving an invitation with a focused draft never grants access',
    (tester) async {
      var saves = 0;
      await _pump(
        tester,
        save: (_) async {
          saves++;
        },
      );
      await tester.enterText(
        find.byType(TextFormField),
        'unfinished@example.test',
      );
      await tester.tap(find.text('Watch'));
      await tester.pumpAndSettle();
      expect(find.byType(FamilyAccessPage), findsNothing);
      expect(find.text('Watch page'), findsOneWidget);
      expect(saves, 0);
      expect(tester.takeException(), isNull);
    },
  );
}
