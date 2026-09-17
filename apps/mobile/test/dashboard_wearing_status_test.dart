import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/dashboard/wearing_presentation.dart';
import 'package:guardian/models/wear_check.dart';
import 'package:guardian/models/wear_status.dart';
import 'package:guardian/widgets/dashboard/dashboard_wearing_status.dart';
import 'package:guardian/widgets/dashboard/guardian_overview_header.dart';

import 'support/dashboard_fixture.dart';

void main() {
  final start = DateTime.utc(2026, 9, 16, 14);
  WearStatus worn() => WearStatus(
    state: 'worn',
    deviceAccepted: true,
    observedAt: start,
    expiresAt: start.add(const Duration(seconds: 120)),
  );

  test(
    'connection, zero bits and dated removal never imply positive wearing',
    () {
      final unknown = WearingPresentation.at(now: start, connected: true);
      expect(unknown.title, 'Wearing not confirmed');
      final report = WearStatus(lastRemovalReportedAt: start);
      expect(report.stateAt(start), 'unknown');
      for (final connected in [true, false]) {
        final view = WearingPresentation.at(
          now: start.add(const Duration(days: 1)),
          connected: connected,
          status: report,
        );
        expect(view.title, 'Removal reported');
        expect(view.detail, '1d ago · Wearing now is unconfirmed');
      }
    },
  );

  test(
    'automatic wearing requires acceptance, connection and unexpired evidence',
    () {
      expect(
        WearingPresentation.at(
          now: start,
          connected: true,
          status: worn(),
        ).title,
        'Wearing detected',
      );
      expect(
        WearingPresentation.at(
          now: start,
          connected: false,
          status: worn(),
        ).tone,
        WearingTone.neutral,
      );
      expect(
        WearingPresentation.at(
          now: start.add(const Duration(seconds: 120)),
          connected: true,
          status: worn(),
        ).title,
        'Wearing not confirmed',
      );
      expect(
        WearingPresentation.at(
          now: start.subtract(const Duration(seconds: 1)),
          connected: true,
          status: worn(),
        ).title,
        'Wearing not confirmed',
      );
    },
  );

  test('family checks stay historical and newer removal supersedes them', () {
    final check = WearCheck(
      state: 'worn',
      observedAt: start,
      recordedAt: start,
    );
    final manual = WearingPresentation.at(
      now: start.add(const Duration(minutes: 40)),
      connected: true,
      check: check,
    );
    expect(manual.title, 'Last checked on wrist');
    expect(manual.detail, 'Family check · 40m ago');
    expect(manual.tone, WearingTone.neutral);
    final removal = WearStatus(
      lastRemovalReportedAt: start.add(const Duration(minutes: 1)),
    );
    expect(
      WearingPresentation.at(
        now: start.add(const Duration(minutes: 2)),
        connected: true,
        status: removal,
        check: check,
      ).title,
      'Removal reported',
    );
    final newerCheck = WearCheck(
      state: 'worn',
      observedAt: start.add(const Duration(minutes: 3)),
      recordedAt: start.add(const Duration(minutes: 3)),
    );
    expect(
      WearingPresentation.at(
        now: start.add(const Duration(minutes: 4)),
        connected: true,
        status: removal,
        check: newerCheck,
      ).title,
      'Last checked on wrist',
    );
    expect(removal.stateAt(start), 'unknown');
  });

  test(
    'same-time or newer contradictory observations suppress green sensor status',
    () {
      final manual = WearCheck(
        state: 'removed',
        observedAt: start,
        recordedAt: start,
      );
      expect(
        WearingPresentation.at(
          now: start,
          connected: true,
          status: worn(),
          check: manual,
        ).title,
        'Last checked off wrist',
      );
      final contradictory = WearStatus(
        state: 'worn',
        deviceAccepted: true,
        observedAt: start,
        expiresAt: start.add(const Duration(seconds: 120)),
        lastRemovalReportedAt: start,
      );
      expect(
        WearingPresentation.at(
          now: start,
          connected: true,
          status: contradictory,
        ).title,
        'Removal reported',
      );
    },
  );

  test(
    'uncommitted, malformed and unknown-version family checks are rejected',
    () {
      final valid = {
        'version': 1,
        'state': 'worn',
        'observedAt': Timestamp.fromDate(start),
        'recordedAt': Timestamp.fromDate(start),
      };
      expect(WearCheck.fromMap(valid), isNotNull);
      for (final override in [
        {'recordedAt': null},
        {'version': 2},
        {'state': 'probably'},
        {
          'recordedAt': Timestamp.fromDate(
            start.add(const Duration(minutes: 5)),
          ),
        },
      ]) {
        expect(WearCheck.fromMap({...valid, ...override}), isNull);
      }
    },
  );

  testWidgets(
    'sensor freshness expires on a quiet dashboard; errors clear the claim',
    (tester) async {
      final statuses = StreamController<WearStatus>();
      final checks = StreamController<WearCheck?>();
      var now = start;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: DashboardWearingStatus(
              device: dashboardFixtureDevice(),
              watchStatus: (_) => statuses.stream,
              watchChecks: (_) => checks.stream,
              recordCheck: (_, _) async {},
              clock: () => now,
            ),
          ),
        ),
      );
      statuses.add(worn());
      checks.add(null);
      await tester.pump();
      expect(find.text('Wearing detected'), findsOneWidget);
      now = start.add(const Duration(seconds: 121));
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Wearing detected'), findsNothing);
      expect(find.text('Wearing not confirmed'), findsOneWidget);
      statuses.addError(StateError('permission denied'));
      await tester.pumpAndSettle();
      expect(find.text('Wearing status unavailable'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.runAsync(() async {
        await statuses.close();
        await checks.close();
      });
    },
  );

  testWidgets(
    'switching watches clears old data and a failed family save remains explicit',
    (tester) async {
      final statuses = {
        'a': StreamController<WearStatus>(),
        'b': StreamController<WearStatus>(),
      };
      final checks = {
        'a': StreamController<WearCheck?>(),
        'b': StreamController<WearCheck?>(),
      };
      String? savedImei;
      Widget host(String imei) => MaterialApp(
        home: Scaffold(
          body: DashboardWearingStatus(
            device: dashboardFixtureDevice(imei: imei),
            watchStatus: (id) => statuses[id]!.stream,
            watchChecks: (id) => checks[id]!.stream,
            recordCheck: (id, state) async {
              savedImei = id;
              throw StateError('offline');
            },
          ),
        ),
      );
      await tester.pumpWidget(host('a'));
      statuses['a']!.add(WearStatus(lastRemovalReportedAt: DateTime.now()));
      checks['a']!.add(null);
      await tester.pump();
      expect(find.text('Removal reported'), findsOneWidget);
      await tester.pumpWidget(host('b'));
      expect(find.text('Removal reported'), findsNothing);
      statuses['b']!.add(const WearStatus());
      checks['b']!.add(null);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Wearing not confirmed'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('I checked: on wrist'));
      await tester.pumpAndSettle();
      expect(savedImei, 'b');
      expect(find.textContaining('Check could not be saved.'), findsOneWidget);
      expect(find.text('Last checked on wrist'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.runAsync(() async {
        for (final controller in statuses.values) {
          await controller.close();
        }
        for (final controller in checks.values) {
          await controller.close();
        }
      });
    },
  );

  for (final width in [320.0, 390.0, 1280.0]) {
    for (final scale in [1.0, 2.0]) {
      testWidgets('wearing row fits $width width at $scale text scale', (
        tester,
      ) async {
        tester.view.physicalSize = Size(width, 1600);
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(
                size: Size(width, 1600),
                textScaler: TextScaler.linear(scale),
              ),
              child: Scaffold(
                body: SingleChildScrollView(
                  child: GuardianOverviewHeader(
                    device: dashboardFixtureDevice(),
                    helpEnabled: true,
                    watchCheckStatus: WearingStatusTile(
                      presentation: WearingPresentation.at(
                        now: start.add(const Duration(minutes: 10)),
                        connected: true,
                        status: WearStatus(lastRemovalReportedAt: start),
                      ),
                      onTap: () {},
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        expect(find.text('Removal reported'), findsOneWidget);
        expect(find.text('Watch connected'), findsOneWidget);
        expect(tester.takeException(), isNull);
      });
    }
  }
}

