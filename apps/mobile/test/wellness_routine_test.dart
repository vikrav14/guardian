import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/wellness/wellness_routine.dart';

void main() {
  test('stale status and socket handoff never imply successful measurements', () {
    final now = DateTime.utc(2026, 10, 1, 10);
    Map<String, dynamic> state(String phase, [String? reason]) => {
      'phase': phase, 'reason': reason, 'updatedAt': Timestamp.fromDate(now),
    };
    expect(wellnessRoutineMessage(state('awaiting_readings'), now), contains('not yet verified'));
    expect(wellnessRoutineMessage(state('stop_pending_offline'), now), contains('may still be running'));
    expect(wellnessRoutineMessage(state('blocked', 'wearing_unconfirmed'), now), contains('Paused'));
    expect(wellnessRoutineMessage(state('blocked', 'watch_removed'), now), contains('watch removed'));
    expect(wellnessRoutineMessage(state('stop_sent', 'temperature_mode_unconfirmed'), now), contains('not confirmed'));
    expect(wellnessRoutineMessage(state('awaiting_readings'), now.add(const Duration(minutes: 3))), contains('Waiting for an update'));
  });

  testWidgets('presets save exact routine IDs and describe pending application', (tester) async {
    final saved = <String>[];
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(
      child: WellnessRoutineControls(status: const {}, onSave: (value) async => saved.add(value)),
    ))));
    expect(find.text('Gentle rhythm'), findsOneWidget);
    expect(find.text('Every 8 hours · about three times daily'), findsOneWidget);
    await tester.tap(find.text('Balanced rhythm'));
    await tester.ensureVisible(find.text('Apply routine'));
    await tester.tap(find.text('Apply routine')); await tester.pump();
    expect(saved, ['balanced']);
    expect(find.text('Choice saved. Waiting for the gateway to apply it.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('failed writes show failure without reporting an applied schedule', (tester) async {
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: SingleChildScrollView(
      child: WellnessRoutineControls(status: const {}, onSave: (_) async => throw StateError('denied')),
    ))));
    await tester.ensureVisible(find.text('Apply routine'));
    await tester.tap(find.text('Apply routine')); await tester.pump();
    expect(find.textContaining('Could not save'), findsOneWidget);
    expect(find.textContaining('Choice saved'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('narrow screens and enlarged text remain scrollable', (tester) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(MaterialApp(builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)), child: child!,
    ), home: Scaffold(body: SingleChildScrollView(child: WellnessRoutineControls(
      status: const {}, onSave: (_) async {},
    )))));
    await tester.ensureVisible(find.text('Apply routine'));
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
