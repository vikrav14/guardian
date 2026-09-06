import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/services/watch_call_actions.dart';

Future<void> _mount(
  WidgetTester tester,
  Device watch,
  Future<bool> Function(Uri) launcher,
) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: FilledButton(
            onPressed: () => callWatch(context, watch, launcher: launcher),
            child: const Text('Call'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Call'));
  await tester.pumpAndSettle();
}

void main() {
  const watch = Device(
    imei: 'synthetic-watch',
    online: false,
    nickname: 'Alex',
    simNumber: '+15550101001',
  );

  testWidgets(
    'Android uses the selected saved SIM even when data is offline',
    (tester) async {
      final calls = <Uri>[];
      await _mount(tester, watch, (uri) async {
        calls.add(uri);
        return true;
      });
      expect(calls.single.scheme, 'tel');
      expect(calls.single.path, '+15550101001');
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );

  testWidgets(
    'desktop presents the number and waits for an explicit handoff',
    (tester) async {
      final calls = <Uri>[];
      await _mount(tester, watch, (uri) async {
        calls.add(uri);
        return true;
      });
      expect(calls, isEmpty);
      expect(find.text('+15550101001'), findsOneWidget);
      expect(find.textContaining('Voice may still work'), findsOneWidget);
      await tester.tap(find.text('Try this device'));
      await tester.pumpAndSettle();
      expect(calls.single.path, '+15550101001');
    },
    variant: TargetPlatformVariant.only(TargetPlatform.windows),
  );

  testWidgets(
    'missing SIM and failed dialler handoff give actionable feedback',
    (tester) async {
      var calls = 0;
      await _mount(
        tester,
        const Device(imei: 'synthetic-watch', online: true),
        (_) async {
          calls++;
          return true;
        },
      );
      expect(calls, 0);
      expect(find.textContaining('No SIM number'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await _mount(tester, watch, (_) async => false);
      expect(find.textContaining('No calling app opened'), findsOneWidget);
    },
    variant: TargetPlatformVariant.only(TargetPlatform.android),
  );
}
