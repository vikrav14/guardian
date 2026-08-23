import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/activity_day.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/dashboard/activity_steps_panel.dart';

void main() {
  testWidgets('activity card renders accepted totals and seven-day evidence', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(),
        home: Scaffold(
          body: ActivityStepsCard(
            days: [
              ActivityDay(
                localDate: '2026-08-23',
                steps: 4321,
                lastObservedAt: DateTime.now(),
                quality: 'partial',
              ),
              ActivityDay(
                localDate: '2026-08-22',
                steps: 3000,
                lastObservedAt: DateTime.now().subtract(
                  const Duration(days: 1),
                ),
                quality: 'partial',
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('4,321'), findsWidgets);
    expect(find.textContaining('steps · updated'), findsOneWidget);
    expect(find.textContaining('not medical assessment'), findsOneWidget);
  });

  testWidgets('locked card promotes Guardian Family honestly', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(),
        home: const Scaffold(
          body: ActivityStepsCard.locked(
            message:
                'Steps and daily activity require Guardian Family or Guardian Care.',
          ),
        ),
      ),
    );

    expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    expect(find.textContaining('Guardian Family'), findsOneWidget);
  });
}
