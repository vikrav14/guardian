import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/wellness/wellness_routine.dart';

Widget controls({
  Map<String, dynamic> status = const {},
  Map<String, dynamic> request = const {},
  Future<void> Function(WellnessRoutineSelection)? onSave,
  String? unavailableReason,
}) => MaterialApp(
  home: Scaffold(
    body: SingleChildScrollView(
      child: WellnessRoutineControls(
        status: status,
        request: request,
        onSave: onSave,
        unavailableReason: unavailableReason,
      ),
    ),
  ),
);

Future<void> editTime(WidgetTester tester, int index, String hour, String minute) async {
  final button = find.byKey(ValueKey('routine-time-$index'));
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pumpAndSettle();
  final fields = find.descendant(
    of: find.byType(TimePickerDialog),
    matching: find.byType(TextField),
  );
  expect(fields, findsNWidgets(2));
  await tester.enterText(fields.at(0), hour);
  await tester.enterText(fields.at(1), minute);
  await tester.tap(find.text('OK'));
  await tester.pumpAndSettle();
}

Future<void> applyRoutine(WidgetTester tester) async {
  final button = find.text('Apply routine');
  await tester.ensureVisible(button);
  await tester.tap(button);
  await tester.pump();
}

void main() {
  test('daily selection writes sorted v2 times and the fixed Mauritius timezone', () {
    final selected = WellnessRoutineSelection(
      routine: 'balanced', times: ['20:00', '08:00', '14:00'],
    );
    final request = selected.toRequest('viewer');
    expect(request.keys.toSet(), {
      'version', 'routine', 'times', 'timeZone', 'requestedBy', 'updatedAt',
    });
    expect(request['version'], 2);
    expect(request['routine'], 'balanced');
    expect(request['times'], ['08:00', '14:00', '20:00']);
    expect(request['timeZone'], 'Indian/Mauritius');
    expect(request['requestedBy'], 'viewer');
    expect(request['updatedAt'], isA<FieldValue>());
    expect(WellnessRoutineSelection(routine: 'manual', times: []).toRequest('viewer')['times'], isEmpty);
  });

  test('daily times enforce exact count, valid times and spacing across midnight', () {
    for (final times in [
      ['08:00'], ['08:00', '14:00', '20:00'], ['08:00', '08:00'],
      ['24:00', '08:00'], ['8:00', '20:00'], ['08:60', '20:00'],
      ['08:00\n', '20:00'],
      ['08:00', '08:04'], ['23:58', '00:02'],
    ]) {
      expect(wellnessRoutineTimeError('gentle', times), isNotNull);
    }
    expect(wellnessRoutineTimeError('gentle', ['23:58', '00:03']), isNull);
    expect(wellnessRoutineTimeError('gentle', ['08:00', '08:05']), isNull);
    expect(wellnessRoutineTimeError('manual', ['08:00']), isNotNull);
    expect(wellnessRoutineTimeError('unknown', []), isNotNull);
    expect(() => WellnessRoutineSelection(routine: 'balanced', times: ['08:00']), throwsArgumentError);
  });

  test('current and legacy statuses distinguish saved times, pending stops and unavailable readings', () {
    final now = DateTime.utc(2026, 10, 1, 10);
    Map<String, dynamic> state(String phase, [String? reason]) => {
      'phase': phase, 'reason': reason, 'updatedAt': Timestamp.fromDate(now),
    };
    expect(wellnessRoutineMessage(state('scheduled'), now), contains('daily reading times'));
    expect(wellnessRoutineMessage(state('manual'), now), contains('are off'));
    expect(wellnessRoutineMessage(state('running'), now), contains('Checking readings'));
    expect(wellnessRoutineMessage(state('manual', 'native_schedule_stop_pending'), now), contains('previous watch schedule'));
    expect(wellnessRoutineMessage(state('blocked', 'legacy_routine_requires_times'), now), contains('Choose your daily times'));
    expect(wellnessRoutineMessage(state('blocked', 'diagnostic_quarantine_active'), now), contains('current watch test'));
    expect(wellnessRoutineMessage(state('awaiting_readings'), now), contains('not yet verified'));
    expect(wellnessRoutineMessage(state('stop_pending_offline'), now), contains('may still be running'));
    expect(wellnessRoutineMessage(state('blocked', 'wearing_unconfirmed'), now), contains('Paused'));
    expect(wellnessRoutineMessage(state('blocked', 'watch_removed'), now), contains('watch removed'));
    expect(wellnessRoutineMessage(state('stop_sent', 'temperature_mode_unconfirmed'), now), contains('not confirmed'));
    expect(wellnessRoutineMessage(state('scheduled'), now.add(const Duration(minutes: 3))), contains('Waiting for an update'));
  });

  test('next check and last result use Mauritius dates across midnight without stale promises', () {
    final now = DateTime.utc(2026, 10, 1, 19, 58);
    final status = <String, dynamic>{
      'phase': 'scheduled', 'updatedAt': Timestamp.fromDate(now),
      'nextCheckAt': '2026-10-01T20:05:00Z',
      'lastAttempt': {
        'scheduledAt': '2026-10-01T16:00:00Z',
        'finishedAt': Timestamp.fromDate(DateTime.utc(2026, 10, 1, 16, 1)),
        'outcome': 'temperature_skipped', 'reason': 'unusable_oxygen',
      },
    };
    expect(wellnessRoutineNextCheck(status, now), 'Next check · tomorrow, 00:05');
    expect(wellnessRoutineLastResult(status, now), contains('today, 20:01'));
    expect(wellnessRoutineLastResult(status, now), contains('No usable readings'));
    expect(wellnessRoutineNextCheck(status, now.add(const Duration(minutes: 3))), isNull);
    expect(wellnessRoutineNextCheck({...status, 'phase': 'manual'}, now), isNull);
    expect(wellnessRoutineNextCheck({...status, 'nextCheckAt': 'not a date'}, now), isNull);
  });

  testWidgets('Gentle and Balanced defaults save exact daily times; Manual clears the times', (tester) async {
    final saved = <WellnessRoutineSelection>[];
    await tester.pumpWidget(controls(onSave: (value) async => saved.add(value)));
    expect(find.text('Every 8 hours · about three times daily'), findsNothing);
    await tester.tap(find.text('Gentle rhythm'));
    await tester.pump();
    expect(find.text('Times in Mauritius'), findsOneWidget);
    expect(find.text('08:00'), findsOneWidget);
    expect(find.text('20:00'), findsOneWidget);
    await applyRoutine(tester);
    expect(saved.last.routine, 'gentle');
    expect(saved.last.times, ['08:00', '20:00']);
    expect(find.text('Choice saved. Waiting for the gateway to apply it.'), findsOneWidget);
    await tester.ensureVisible(find.text('Balanced rhythm'));
    await tester.tap(find.text('Balanced rhythm'));
    await tester.pump();
    expect(find.text('14:00'), findsOneWidget);
    await applyRoutine(tester);
    expect(saved.last.times, ['08:00', '14:00', '20:00']);
    await tester.ensureVisible(find.text('Manual'));
    await tester.tap(find.text('Manual'));
    await tester.pump();
    expect(find.text('Times in Mauritius'), findsNothing);
    await applyRoutine(tester);
    expect(saved.last.routine, 'manual');
    expect(saved.last.times, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('persisted request initializes picker times and edits survive periodic status updates', (tester) async {
    final saved = <WellnessRoutineSelection>[];
    final persisted = <String, dynamic>{
      'version': 2, 'routine': 'gentle', 'times': ['09:15', '19:45'],
      'timeZone': 'Indian/Mauritius',
    };
    Future<void> save(WellnessRoutineSelection value) async => saved.add(value);
    await tester.pumpWidget(controls(request: persisted, onSave: save));
    expect(find.text('09:15'), findsOneWidget);
    expect(find.text('19:45'), findsOneWidget);
    await editTime(tester, 0, '21', '30');
    expect(find.text('21:30'), findsOneWidget);
    await tester.pumpWidget(controls(
      request: persisted,
      status: {'routine': 'balanced', 'times': ['08:00', '14:00', '20:00'],
        'timeZone': 'Indian/Mauritius', 'updatedAt': Timestamp.now()},
      onSave: save,
    ));
    await tester.pump(const Duration(seconds: 20));
    expect(find.text('21:30'), findsOneWidget);
    expect(find.text('09:15'), findsNothing);
    await applyRoutine(tester);
    expect(saved.single.routine, 'gentle');
    expect(saved.single.times, ['19:45', '21:30']);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('late saved status initializes untouched controls', (tester) async {
    Future<void> save(WellnessRoutineSelection value) async {}
    await tester.pumpWidget(controls(onSave: save));
    await tester.pumpWidget(controls(status: {
      'routine': 'balanced', 'times': ['07:00', '13:00', '19:00'],
      'timeZone': 'Indian/Mauritius',
    }, onSave: save));
    expect(find.text('07:00'), findsOneWidget);
    expect(find.text('13:00'), findsOneWidget);
    expect(find.text('19:00'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('duplicate picker times explain the problem and prevent saving', (tester) async {
    final saved = <WellnessRoutineSelection>[];
    await tester.pumpWidget(controls(status: {
      'routine': 'gentle', 'times': ['08:00', '20:00'], 'timeZone': 'Indian/Mauritius',
    }, onSave: (value) async => saved.add(value)));
    await editTime(tester, 0, '20', '00');
    expect(find.text('Choose a different time for each reading.'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Apply routine'));
    expect(button.onPressed, isNull);
    expect(saved, isEmpty);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('failed writes keep edited times and never report an applied schedule', (tester) async {
    await tester.pumpWidget(controls(onSave: (_) async => throw StateError('denied')));
    await tester.tap(find.text('Gentle rhythm'));
    await tester.pump();
    await applyRoutine(tester);
    expect(find.textContaining('Could not save'), findsOneWidget);
    expect(find.textContaining('Choice saved'), findsNothing);
    expect(find.text('20:00'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unavailable access disables both time editing and applying', (tester) async {
    await tester.pumpWidget(controls(status: {
      'routine': 'gentle', 'times': ['08:00', '20:00'], 'timeZone': 'Indian/Mauritius',
    }, onSave: (_) async {}, unavailableReason: 'Family or Care access unavailable.'));
    final timeButton = tester.widget<OutlinedButton>(find.byKey(const ValueKey('routine-time-0')));
    final applyButton = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Apply routine'));
    expect(timeButton.onPressed, isNull);
    expect(applyButton.onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('daily controls remain scrollable on narrow screens with enlarged text', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)),
        child: child!,
      ),
      home: Scaffold(body: SingleChildScrollView(child: WellnessRoutineControls(
        status: const {'routine': 'balanced'}, onSave: (_) async {},
      ))),
    ));
    await tester.ensureVisible(find.text('Apply routine'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
