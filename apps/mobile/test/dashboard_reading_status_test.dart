import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/dashboard/dashboard_reading_status.dart';

void main() {
  final start = DateTime.utc(2026, 9, 17, 14, 31);

  Map<String, dynamic> result({
    String outcome = 'temperature_upload_observed',
    String? reason,
    DateTime? at,
  }) => {
    'phase': 'scheduled',
    'updatedAt': Timestamp.fromDate(start),
    'lastAttempt': {
      'terminal': true,
      'outcome': outcome,
      'reason': reason,
      'finishedAt': Timestamp.fromDate(at ?? start),
    },
  };

  Map<String, dynamic> running() => {
    'phase': 'running',
    'inFlight': true,
    'updatedAt': start,
    'lastAttempt': {
      'terminal': false,
      'outcome': 'optical_request_handed_off',
      'startedAt': start,
      'activeUntil': start.add(const Duration(minutes: 4)),
    },
  };

  test('active checks need fresh gateway state and a live attempt window', () {
    final status = running();
    expect(ReadingPresentation.at(now: start, status: status).title,
        'Checking readings');
    for (final patch in [
      {'updatedAt': start.subtract(const Duration(minutes: 2))},
      {'updatedAt': start.add(const Duration(seconds: 1))},
      {'inFlight': false},
      {
        'lastAttempt': {
          ...status['lastAttempt'] as Map<String, dynamic>,
          'activeUntil': start,
        },
      },
    ]) {
      expect(ReadingPresentation.at(now: start, status: {...status, ...patch}).title,
          'Check result unavailable');
    }
    expect(
      ReadingPresentation.at(
        now: start.add(const Duration(minutes: 2)), status: status).title,
      'Check result unavailable',
    );
  });

  test('received result is dated; emphasis expires without claiming wearing', () {
    final recent = ReadingPresentation.at(now: start, status: result());
    expect(recent.title, 'Readings received');
    expect(recent.detail, 'Scheduled check · today, 18:31');
    expect(recent.tone, ReadingTone.received);
    final old = ReadingPresentation.at(
      now: start.add(const Duration(days: 1)), status: result());
    expect(old.title, 'Readings received');
    expect(old.detail, 'Scheduled check · 17/9/2026, 18:31');
    expect(old.tone, ReadingTone.neutral);
    expect(ReadingPresentation.at(
      now: start, status: result(at: start.add(const Duration(seconds: 1)))).title,
      'Check status unavailable');
  });

  test('unusable optical results suggest fit briefly; timeouts do not', () {
    for (final reason in ['unusable_heart_bp', 'unusable_oxygen']) {
      final status = result(outcome: 'temperature_skipped', reason: reason);
      final recent = ReadingPresentation.at(now: start, status: status);
      expect(recent.title, 'Check watch fit');
      expect(recent.detail, contains('No usable readings'));
      expect(recent.tone, ReadingTone.attention);
      final old = ReadingPresentation.at(
        now: start.add(const Duration(minutes: 6)), status: status);
      expect(old.title, 'Last check incomplete');
      expect(old.tone, ReadingTone.neutral);
    }
    final timeout = ReadingPresentation.at(now: start,
      status: result(outcome: 'temperature_skipped', reason: 'optical_timeout'));
    expect(timeout.title, 'Readings incomplete');
    expect(timeout.tone, ReadingTone.neutral);
    final successAfterRemoval = ReadingPresentation.at(now: start, status: {
      ...result(),
      'lastRemovalReportedAt': start.subtract(const Duration(hours: 21)),
      'state': 'removed',
      'wearingConfirmed': false,
    });
    expect(successAfterRemoval.title, 'Readings received');
    expect('${successAfterRemoval.title} ${successAfterRemoval.detail}',
        isNot(contains('worn')));
  });

  test('skipped slots and missing attempts do not become fit or wearing claims', () {
    for (final reason in ['watch_offline', 'missed', 'removal_reported']) {
      final view = ReadingPresentation.at(now: start,
        status: result(outcome: 'skipped', reason: reason));
      expect(view.title, 'Check skipped');
      expect(view.tone, ReadingTone.neutral);
    }
    final empty = ReadingPresentation.at(now: start, status: {
      'phase': 'scheduled',
      'updatedAt': start,
      'nextCheckAt': start.add(const Duration(hours: 1)),
      'lastRemovalReportedAt': start.subtract(const Duration(hours: 21)),
    });
    expect(empty.title, 'Awaiting first check');
    expect(empty.detail, 'Next check · today, 19:31');
  });

  testWidgets('quiet streams expire active state and recover after a new result',
      (tester) async {
    final stream = StreamController<Map<String, dynamic>>();
    var now = start;
    await tester.pumpWidget(MaterialApp(home: Scaffold(
      body: DashboardReadingStatus(
        imei: 'a', watchStatus: (_) => stream.stream, clock: () => now),
    )));
    stream.add(running());
    await tester.pump();
    expect(find.text('Checking readings'), findsOneWidget);
    now = start.add(const Duration(minutes: 2));
    await tester.pump(const Duration(seconds: 20));
    expect(find.text('Checking readings'), findsNothing);
    expect(find.text('Check result unavailable'), findsOneWidget);
    stream.add(result(at: now));
    await tester.pump();
    expect(find.text('Readings received'), findsOneWidget);
    now = now.add(const Duration(minutes: 6));
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    final tile = tester.widget<ReadingStatusTile>(find.byType(ReadingStatusTile));
    expect(tile.presentation.tone, ReadingTone.neutral);
    await tester.pumpWidget(const SizedBox.shrink());
    await stream.close();
  });

  testWidgets('watch changes and access errors clear previous results',
      (tester) async {
    final streams = {
      'a': StreamController<Map<String, dynamic>>(),
      'b': StreamController<Map<String, dynamic>>(),
    };
    Stream<Map<String, dynamic>> watch(String imei) => streams[imei]!.stream;
    Widget host(String imei) => MaterialApp(home: Scaffold(
      body: DashboardReadingStatus(
        imei: imei, watchStatus: watch, clock: () => start),
    ));
    await tester.pumpWidget(host('a'));
    streams['a']!.add(result());
    await tester.pump();
    expect(find.text('Readings received'), findsOneWidget);
    await tester.pumpWidget(host('b'));
    expect(find.text('Readings received'), findsNothing);
    expect(find.text('Loading check status'), findsOneWidget);
    streams['a']!.add(result());
    streams['b']!.add(result(outcome: 'temperature_skipped', reason: 'unusable_oxygen'));
    await tester.pump();
    expect(find.text('Check watch fit'), findsOneWidget);
    expect(find.text('Readings received'), findsNothing);
    streams['b']!.addError(StateError('permission denied'));
    await tester.pump();
    expect(find.text('Check watch fit'), findsNothing);
    expect(find.text('Check status unavailable'), findsOneWidget);
    streams['b']!.add({});
    await tester.pump();
    expect(find.text('Awaiting first check'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    for (final stream in streams.values) {
      await stream.close();
    }
  });

  testWidgets('dated guidance fits a narrow screen with larger text', (tester) async {
    tester.view.physicalSize = const Size(320, 1000);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var opened = false;
    await tester.pumpWidget(MaterialApp(home: MediaQuery(
      data: const MediaQueryData(size: Size(320, 1000), textScaler: TextScaler.linear(2)),
      child: Scaffold(body: Padding(
        padding: const EdgeInsets.all(16),
        child: ReadingStatusTile(
          presentation: ReadingPresentation.at(now: start,
            status: result(outcome: 'temperature_skipped', reason: 'unusable_oxygen')),
          onTap: () => opened = true,
        ),
      )),
    )));
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Check watch fit'));
    expect(opened, isTrue);
  });
}
