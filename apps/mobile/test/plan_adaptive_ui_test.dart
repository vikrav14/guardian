import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/widgets/dashboard/around_them_panel.dart';
import 'package:guardian/widgets/dashboard/guardian_now_hero.dart';

void main() {
  const device = Device(
    imei: '861397052547492',
    online: true,
    nickname: 'Jesh',
    batteryPercent: 70,
    careProfile: 'senior',
  );

  testWidgets('Essential dashboard uses factual status and locks WhatsApp', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GuardianNowHero(
            device: device,
            aiInterpretation: 'AI interpretation',
            guardianAiEnabled: false,
            askGuardianEnabled: false,
            onAskGuardian: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Watch status'), findsOneWidget);
    expect(find.text('Guardian AI'), findsNothing);
    expect(find.text('Family plan required'), findsOneWidget);
  });

  testWidgets('Family dashboard exposes Guardian AI and WhatsApp action', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: GuardianNowHero(
            device: device,
            aiInterpretation: 'AI interpretation',
            guardianAiEnabled: true,
            askGuardianEnabled: true,
            onAskGuardian: _noop,
          ),
        ),
      ),
    );

    expect(find.text('Guardian AI'), findsOneWidget);
    expect(find.text('On WhatsApp'), findsOneWidget);
    expect(find.text('Family plan required'), findsNothing);
  });

  testWidgets('Care cards never leak into Family or Essential', (tester) async {
    Future<void> pump({required bool care}) {
      return tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AroundThemPanel(
              device: device,
              geofences: const [],
              guardianIntelligence: 'All calm',
              guardianAiEnabled: true,
              careEnabled: care,
              medicationEnabled: care,
            ),
          ),
        ),
      );
    }

    await pump(care: false);
    expect(find.text('Wellbeing'), findsNothing);
    expect(find.text('Medication'), findsNothing);

    await pump(care: true);
    expect(find.text('Wellbeing'), findsOneWidget);
    expect(find.text('Medication'), findsOneWidget);
  });
}

void _noop() {}
