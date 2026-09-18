import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/screens/watch_preferences_page.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/wellness/wellness_routine.dart';
import 'package:guardian/wellness/wellness_settings_card.dart';

GuardianSubscription subscriptionFor(String plan, {String status = 'active'}) =>
    GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'plan': plan,
      'status': status,
    });

void main() {
  const descriptions = {
    'essential':
        'Today’s activity is available on your dashboard. Watch readings require Guardian Care.',
    'family':
        'Seven days of activity history and basic watch estimates, including today. Automatic reading routines require consent and gateway availability.',
    'care':
        'All available activity and watch-reading history during active service, plus advanced Care services.',
  };
  for (final plan in descriptions.keys) {
    testWidgets(
      '$plan has the same routine choices and correct history allowance',
      (tester) async {
        final subscription = subscriptionFor(plan);
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: WellnessSettingsCard(
                subscription: subscription,
                onOpen: () {},
              ),
            ),
          ),
        );
        expect(find.text(descriptions[plan]!), findsOneWidget);
        expect(
          tester
              .widget<OutlinedButton>(
                find.widgetWithText(OutlinedButton, 'Wellness routine'),
              )
              .onPressed,
          plan == 'essential' ? isNull : isNotNull,
        );
        await tester.pumpWidget(
          MaterialApp(
            home: WellnessRoutinePage(
              imei: 'synthetic',
              subscription: subscription,
            ),
          ),
        );
        expect(find.text('Manual'), findsOneWidget);
        expect(find.text('Gentle rhythm'), findsOneWidget);
        expect(find.text('Balanced rhythm'), findsOneWidget);
        expect(find.text('Apply routine'), findsNothing);
        expect(
          find.textContaining(
            plan == 'essential'
                ? 'Automatic readings require Guardian Family or Guardian Care.'
                : 'Wellness service is not connected yet.',
          ),
          findsOneWidget,
        );
        for (final button in tester.widgetList<OutlinedButton>(
          find.byType(OutlinedButton),
        )) {
          expect(button.onPressed, isNull);
        }
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  for (final width in [320.0, 390.0, 1280.0]) {
    testWidgets(
      'Care preferences and routine route work at $width with large text',
      (tester) async {
        tester.view.physicalSize = Size(width, 900);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            builder: (context, child) => MediaQuery(
              data: MediaQuery.of(
                context,
              ).copyWith(textScaler: const TextScaler.linear(2)),
              child: child!,
            ),
            home: WatchPreferencesPage(
              device: const Device(
                imei: 'synthetic',
                nickname: 'Sample wearer',
                online: false,
              ),
              subscription: subscriptionFor('care'),
            ),
          ),
        );
        expect(find.text('Safety and Wellness'), findsOneWidget);
        expect(
          find.text('Wellbeing and activity summaries is not included'),
          findsNothing,
        );
        await tester.ensureVisible(find.text('Wellness routine'));
        await tester.tap(find.text('Wellness routine'));
        await tester.pumpAndSettle();
        expect(find.byType(WellnessRoutinePage), findsOneWidget);
        await tester.ensureVisible(find.text('Balanced rhythm'));
        expect(tester.takeException(), isNull);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.byType(WatchPreferencesPage), findsOneWidget);
        await tester.ensureVisible(find.text('Care extras'));
        expect(tester.takeException(), isNull);
        await tester.pumpWidget(const SizedBox());
      },
    );
  }

  testWidgets('Essential shows routine choices but cannot apply them', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: WellnessRoutinePage(
          imei: 'synthetic',
          subscription: subscriptionFor('essential'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Automatic readings require Guardian Family or Guardian Care.'), findsOneWidget);
    expect(find.text('Balanced rhythm'), findsOneWidget);
    expect(find.text('Apply routine'), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets(
    'routine status errors disable writes even with a save callback',
    (tester) async {
      var saves = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: WellnessRoutineControls(
                status: const {},
                unavailableReason: 'Status unavailable',
                onSave: (_) async {
                  saves++;
                },
              ),
            ),
          ),
        ),
      );
      expect(
        tester
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Apply routine'),
            )
            .onPressed,
        isNull,
      );
      expect(saves, 0);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
