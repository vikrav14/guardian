import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/brand/dodo_ai_icon.dart';

void main() {
  testWidgets('GuardianAiIcon renders dodo badge and warning state', (
    tester,
  ) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Row(
            children: [
              GuardianAiIcon(),
              GuardianAiIcon(
                warning: true,
                backgroundColor: GuardianColors.warningBg,
                accentColor: GuardianColors.warning,
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.byType(GuardianAiIcon), findsNWidgets(2));
    expect(find.byType(Image), findsOneWidget);
    expect(find.text('AI'), findsOneWidget);
    expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
    expect(find.bySemanticsLabel('Guardian AI'), findsOneWidget);
  });

  testWidgets('GuardianBrandMark renders brand asset', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: GuardianBrandMark(size: 38),
        ),
      ),
    );

    expect(find.byType(GuardianBrandMark), findsOneWidget);
    expect(find.byType(Image), findsOneWidget);
  });
}
