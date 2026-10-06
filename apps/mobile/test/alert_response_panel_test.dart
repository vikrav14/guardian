import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/alerts/alert_response_panel.dart';

void main() {
  testWidgets(
    'response requires loaded data and shows confirmation only from the backend stream',
    (tester) async {
      final stream = StreamController<List<Map<String, dynamic>>>();
      addTearDown(stream.close);
      final sent = Completer<void>();
      var calls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AlertResponsePanel(
              imei: '999999999999991',
              alertId: 'sos',
              resolved: false,
              uid: 'me',
              responses: stream.stream,
              respond: () {
                calls++;
                return sent.future;
              },
            ),
          ),
        ),
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      stream.add([]);
      await tester.pump();
      await tester.tap(find.text('I’m responding'));
      await tester.pump();
      expect(calls, 1);
      expect(find.text('Confirming…'), findsOneWidget);
      expect(find.text('You are responding'), findsNothing);
      sent.completeError(StateError('Offline'));
      await tester.pump();
      expect(
        find.text('Your response could not be confirmed. Try again.'),
        findsOneWidget,
      );
      stream.add([
        {'uid': 'me', 'name': 'Vikesh'},
      ]);
      await tester.pump();
      expect(find.text('You are responding'), findsOneWidget);
      expect(find.text('Vikesh is responding'), findsOneWidget);
      expect(
        find.text('Your response could not be confirmed. Try again.'),
        findsNothing,
      );
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      stream.addError(StateError('Access revoked'));
      await tester.pump();
      expect(find.text('Vikesh is responding'), findsNothing);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
    },
  );

  testWidgets(
    'resolved incidents show responders without an action at narrow width',
    (tester) async {
      tester.view.resetPhysicalSize();
      tester.view.physicalSize = const Size(320, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: AlertResponsePanel(
              imei: '999999999999991',
              alertId: 'sos',
              resolved: true,
              uid: 'me',
              responses: Stream.value([
                {'uid': 'me', 'name': 'Vikesh'},
              ]),
              respond: () async {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Vikesh responded'), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
}
