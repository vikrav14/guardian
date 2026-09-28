import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/wellness/movement_reminder_preview.dart';
import 'package:guardian/wellness/wellness_settings_card.dart';

GuardianSubscription plan(String name) => GuardianSubscription.fromMap({
  'version': 1,
  'managedBy': 'guardian_admin',
  'plan': name,
  'status': 'active',
});

void main() {
  test('preview retains default-off and Care-only access', () {
    expect(canPreviewMovementReminders(plan('care'), enabled: false), isFalse);
    expect(canPreviewMovementReminders(plan('care'), enabled: true), isTrue);
    expect(canPreviewMovementReminders(plan('family'), enabled: true), isFalse);
    expect(
      canPreviewMovementReminders(
        const GuardianSubscription.inactive(),
        enabled: true,
      ),
      isFalse,
    );
  });

  testWidgets('example toggle never claims a watch change or enables saving', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: MovementReminderPreviewContent(name: 'Jesh'),
          ),
        ),
      ),
    );
    expect(find.text('Example: Off'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('movement-preview-switch')));
    await tester.pump();
    expect(find.text('Example: On'), findsOneWidget);
    expect(find.text('Not checked'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(find.text('Sent to watch'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('small screen and large text keep preview controls usable', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(
      const MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(2)),
          child: Scaffold(
            body: SingleChildScrollView(
              padding: EdgeInsets.all(20),
              child: MovementReminderPreviewContent(name: 'Jesh'),
            ),
          ),
        ),
      ),
    );
    await tester.ensureVisible(find.text('Until 20:00'));
    expect(tester.takeException(), isNull);
    await tester.ensureVisible(find.text('Save to watch'));
    expect(tester.takeException(), isNull);
  });

  testWidgets('Family settings retain Wellness without exposing Care preview', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: WellnessSettingsCard(
            subscription: plan('family'),
            onOpen: () {},
            onMovementReminders: () {},
          ),
        ),
      ),
    );
    expect(find.text('Wellness routine'), findsOneWidget);
    expect(find.text('Movement reminders'), findsNothing);
  });

  testWidgets('direct Family route does not bypass preview entitlement', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MovementReminderPreviewPage(
          name: 'Jesh',
          subscription: plan('family'),
        ),
      ),
    );
    expect(find.byType(MovementReminderPreviewContent), findsNothing);
    expect(find.text('Movement reminders are not available yet.'), findsOneWidget);
  });
}
