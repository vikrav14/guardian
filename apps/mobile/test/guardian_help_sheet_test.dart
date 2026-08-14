import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/dashboard/guardian_help_sheet.dart';

void main() {
  testWidgets('Guardian help separates local checks from optional WhatsApp', (
    tester,
  ) async {
    var statusOpened = false;
    var whatsappOpened = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => showGuardianHelpSheet(
                context,
                deviceName: 'Jesh',
                onLocation: () {},
                onWatchStatus: () => statusOpened = true,
                onAlerts: () {},
                onJourney: () {},
                onWhatsApp: () => whatsappOpened = true,
              ),
              child: const Text('Open help'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open help'));
    await tester.pumpAndSettle();

    expect(find.text('Guardian help for Jesh'), findsOneWidget);
    expect(find.text('Location check'), findsOneWidget);
    expect(
      find.text('See source, precision and when it was recorded'),
      findsOneWidget,
    );
    expect(find.text('Battery and watch status'), findsOneWidget);
    expect(find.text('Recent alerts'), findsOneWidget);
    expect(find.text('Recent journey'), findsOneWidget);
    expect(find.text('Continue on WhatsApp'), findsOneWidget);
    expect(find.textContaining('do not call an AI service'), findsOneWidget);

    await tester.tap(find.byKey(const Key('guardian-help-status')));
    await tester.pumpAndSettle();
    expect(statusOpened, isTrue);
    expect(whatsappOpened, isFalse);
  });

  testWidgets('WhatsApp is opened only from its explicit help action', (
    tester,
  ) async {
    var whatsappOpened = false;

    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () => showGuardianHelpSheet(
                context,
                deviceName: 'Jesh',
                onLocation: () {},
                onWatchStatus: () {},
                onAlerts: () {},
                onJourney: () {},
                onWhatsApp: () => whatsappOpened = true,
              ),
              child: const Text('Open help'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open help'));
    await tester.pumpAndSettle();
    expect(whatsappOpened, isFalse);

    await tester.tap(find.byKey(const Key('guardian-help-whatsapp')));
    await tester.pumpAndSettle();
    expect(whatsappOpened, isTrue);
  });
}
