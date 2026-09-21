import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/sos_location_snapshot.dart';
import 'package:guardian/screens/alerts_page.dart';
import 'package:guardian/theme/guardian_themes.dart';

final _now = DateTime(2026, 9, 6, 12);
const _watch = Device(
  imei: 'watch-a',
  online: false,
  nickname: 'Alex',
  simNumber: '+15550101001',
);
const _otherWatch = Device(
  imei: 'watch-b',
  online: true,
  nickname: 'Sam',
  simNumber: '+15550101002',
);

SosLocationSnapshot _snapshot() => SosLocationSnapshot.tryParse({
  'version': 1,
  'policy': 'map_retained_satellite_v1',
  'capturedAt': '2026-09-06T12:00:00Z',
  'state': 'last_known',
  'retainedSatellite': true,
  'location': {
    'lat': -20.25,
    'lng': 57.5,
    'source': 'gps',
    'recordedAt': '2026-09-06T11:53:00Z',
    'placeLabel': 'Example park',
  },
  'latestObservation': {
    'lat': -20.3,
    'lng': 57.6,
    'source': 'wifi',
    'recordedAt': '2026-09-06T11:59:30Z',
    'accuracyMeters': 519,
  },
})!;

GuardianAlert _alert(
  String id, {
  String imei = 'watch-a',
  String type = 'sos',
  bool resolved = false,
  DateTime? at,
  bool snapshot = true,
}) => GuardianAlert(
  id: id,
  imei: imei,
  type: type,
  severity: type == 'sos' ? 'critical' : 'info',
  message: type == 'sos' ? 'Device alarm: sos' : 'Example $type',
  resolved: resolved,
  createdAt: at ?? _now,
  resolvedAt: resolved ? _now : null,
  sosLocationSnapshot: type == 'sos' && snapshot ? _snapshot() : null,
);

class _Harness {
  final alerts = StreamController<List<GuardianAlert>>.broadcast();
  final devices = StreamController<List<Device>>.broadcast();
  final writes = <String>[];
  final calls = <Device>[];
  final maps = <Uri>[];
  Future<void> Function(String)? resolve;
  final bulkCalls = <List<GuardianAlert>>[];
  Future<int> Function(List<GuardianAlert>)? clear;

  Future<void> mount(
    WidgetTester tester,
    List<GuardianAlert> records, {
    double width = 1200,
    double textScale = 1,
    GuardianThemeId theme = GuardianThemeId.islandGlass,
    List<Device> watches = const [_watch, _otherWatch],
  }) async {
    tester.view.devicePixelRatio = 1;
    tester.view.physicalSize = Size(width, 1100);
    addTearDown(() {
      tester.view.resetPhysicalSize();
      tester.view.resetDevicePixelRatio();
    });
    addTearDown(alerts.close);
    addTearDown(devices.close);
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(
          useMaterial3: true,
          brightness: theme.brightness,
          extensions: [theme.semanticColors],
        ),
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: AlertsPage(
          alertsStream: alerts.stream,
          devicesStream: devices.stream,
          clock: () => _now,
          resolveAlert: (id) async {
            writes.add(id);
            await resolve?.call(id);
          },
          resolveAlerts: (records) async {
            bulkCalls.add(List.of(records));
            if (clear != null) return clear!(records);
            return records.length;
          },
          onCallWatch: (device) async {
            calls.add(device);
          },
          openLocation: (uri) async {
            maps.add(uri);
            return true;
          },
        ),
      ),
    );
    devices.add(watches);
    alerts.add(records);
    await tester.pumpAndSettle();
  }
}

Future<void> _tap(WidgetTester tester, String key) async {
  final target = find.byKey(Key(key));
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets(
    'review, call, map and cancellation leave both SOS incidents open',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [
        _alert('first'),
        _alert('second', imei: 'watch-b'),
      ]);
      expect(find.byKey(const Key('alert-row-first')), findsOneWidget);
      expect(find.byKey(const Key('alert-row-second')), findsOneWidget);
      expect(find.text('Device alarm: sos'), findsNothing);
      await _tap(tester, 'alert-row-second');
      await _tap(tester, 'alert-call-watch');
      await _tap(tester, 'alert-incident-map');
      expect(h.calls.single.imei, 'watch-b');
      expect(h.calls.single.simNumber, '+15550101002');
      expect(h.maps.single.queryParameters['q'], '-20.25,57.5');
      await _tap(tester, 'alert-resolve');
      await _tap(tester, 'alert-keep-open');
      expect(h.writes, isEmpty);
      expect(find.text('Open (2)'), findsOneWidget);
    },
  );

  testWidgets('only confirmation writes, and history waits for the stream', (
    tester,
  ) async {
    final h = _Harness();
    final pending = Completer<void>();
    h.resolve = (_) => pending.future;
    await h.mount(tester, [_alert('first'), _alert('second', imei: 'watch-b')]);
    await _tap(tester, 'alert-row-second');
    await _tap(tester, 'alert-resolve');
    expect(h.writes, isEmpty);
    await tester.tap(find.byKey(const Key('alert-confirm-resolve')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(h.writes, ['second']);
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('alerts-clear-all')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('alert-resolve')))
          .onPressed,
      isNull,
    );
    expect(find.byKey(const Key('alert-row-second')), findsOneWidget);
    pending.complete();
    await tester.pump();
    expect(find.byKey(const Key('alert-row-second')), findsOneWidget);
    h.alerts.add([
      _alert('first'),
      _alert('second', imei: 'watch-b', resolved: true),
    ]);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('alert-row-second')), findsNothing);
    expect(find.text('Marked as resolved'), findsOneWidget);
    await _tap(tester, 'alerts-history');
    expect(find.byKey(const Key('alert-row-second')), findsOneWidget);
    expect(find.byKey(const Key('alert-row-first')), findsNothing);
    expect(find.byKey(const Key('alert-resolve')), findsNothing);
    expect(h.writes, ['second']);
  });

  testWidgets('failed resolution remains open and permits retry', (
    tester,
  ) async {
    final h = _Harness()
      ..resolve = (_) => Future<void>.error(StateError('denied'));
    await h.mount(tester, [_alert('first')]);
    await _tap(tester, 'alert-resolve');
    await _tap(tester, 'alert-confirm-resolve');
    expect(find.byKey(const Key('alert-resolve-error')), findsOneWidget);
    expect(find.text('Open (1)'), findsOneWidget);
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('alert-resolve')))
          .onPressed,
      isNotNull,
    );
    await _tap(tester, 'alert-resolve');
    await _tap(tester, 'alert-confirm-resolve');
    expect(h.writes, ['first', 'first']);
  });

  for (final changed in ['resolved', 'unlinked']) {
    testWidgets('confirmation rechecks an incident that became $changed', (
      tester,
    ) async {
      final h = _Harness();
      await h.mount(tester, [_alert('first')]);
      await _tap(tester, 'alert-resolve');
      h.alerts.add(
        changed == 'resolved' ? [_alert('first', resolved: true)] : [],
      );
      await tester.pumpAndSettle();
      await _tap(tester, 'alert-confirm-resolve');
      expect(h.writes, isEmpty);
    });
  }

  testWidgets(
    'categories, history and calendar groups use the actual records',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [
        _alert('sos'),
        _alert(
          'battery',
          type: 'low_battery',
          at: DateTime(2026, 9, 5, 23, 59),
        ),
        _alert('place', type: 'geofence_enter', at: DateTime(2026, 8, 20)),
        _alert('past', resolved: true),
      ]);
      expect(find.text('Today'), findsOneWidget);
      expect(find.text('Yesterday'), findsOneWidget);
      expect(find.text('20 Aug 2026'), findsOneWidget);
      expect(find.byKey(const Key('alert-row-past')), findsNothing);
      for (final pair in [
        ('safety', 'sos'),
        ('device', 'battery'),
        ('places', 'place'),
      ]) {
        await _tap(tester, 'alerts-category-${pair.$1}');
        for (final id in ['sos', 'battery', 'place']) {
          expect(
            find.byKey(Key('alert-row-$id')),
            id == pair.$2 ? findsOneWidget : findsNothing,
          );
        }
      }
      await _tap(tester, 'alerts-category-all');
      await _tap(tester, 'alerts-history');
      expect(find.byKey(const Key('alert-row-past')), findsOneWidget);
      expect(h.writes, isEmpty);
    },
  );

  testWidgets('incident map and age stay frozen after the live watch moves', (
    tester,
  ) async {
    final h = _Harness();
    await h.mount(tester, [_alert('first')]);
    await _tap(tester, 'alert-incident-map');
    h.devices.add([
      const Device(
        imei: 'watch-a',
        online: true,
        nickname: 'Alex',
        simNumber: '+15550101001',
        location: DeviceLocation(lat: -19, lng: 58),
      ),
    ]);
    await tester.pumpAndSettle();
    await _tap(tester, 'alert-incident-map');
    expect(h.maps, [h.maps.first, h.maps.first]);
    expect(h.maps.last.queryParameters['q'], '-20.25,57.5');
    expect(find.text('7 min before SOS receipt'), findsOneWidget);
    expect(find.text('Current position unconfirmed.'), findsOneWidget);
    expect(h.writes, isEmpty);
  });

  testWidgets('legacy SOS has no map and missing SIM has no call action', (
    tester,
  ) async {
    final h = _Harness();
    await h.mount(
      tester,
      [_alert('legacy', snapshot: false)],
      watches: [
        const Device(
          imei: 'watch-a',
          online: true,
          location: DeviceLocation(lat: -19, lng: 58),
        ),
      ],
    );
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('alert-incident-map')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<FilledButton>(find.byKey(const Key('alert-call-watch')))
          .onPressed,
      isNull,
    );
    expect(find.text('Location unavailable'), findsOneWidget);
    expect(h.maps, isEmpty);
    expect(h.calls, isEmpty);
  });

  testWidgets(
    'watch stream failure disables stale calls but retains incident evidence',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [_alert('first')]);
      h.devices.addError(StateError('unavailable'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<FilledButton>(find.byKey(const Key('alert-call-watch')))
            .onPressed,
        isNull,
      );
      await _tap(tester, 'alert-incident-map');
      expect(h.maps, hasLength(1));
      h.alerts.addError(StateError('unavailable'));
      await tester.pumpAndSettle();
      expect(find.text('Alerts could not be loaded'), findsOneWidget);
      expect(find.byKey(const Key('alert-detail-first')), findsNothing);
      expect(h.writes, isEmpty);
    },
  );

  for (final width in [320.0, 360.0, 1200.0]) {
    testWidgets(
      'review and resolution fit width $width with large dark-theme text',
      (tester) async {
        final h = _Harness();
        await h.mount(
          tester,
          [_alert('first')],
          width: width,
          textScale: 1.6,
          theme: GuardianThemeId.leMorne,
        );
        await _tap(tester, 'alert-row-first');
        expect(find.byKey(const Key('alert-detail-first')), findsOneWidget);
        await _tap(tester, 'alert-resolve');
        await _tap(tester, 'alert-keep-open');
        if (width < 880) {
          // The Back row is lazily removed after scrolling through a long
          // incident. Bring it back into the viewport before tapping it.
          await tester.scrollUntilVisible(
            find.byKey(const Key('alerts-back')),
            -300,
            scrollable: find.byType(Scrollable).first,
          );
          await _tap(tester, 'alerts-back');
          expect(find.byKey(const Key('alert-row-first')), findsOneWidget);
          expect(find.byKey(const Key('alert-detail-first')), findsNothing);
        }
        expect(tester.takeException(), isNull);
        expect(h.writes, isEmpty);
      },
    );
  }

  testWidgets(
    'Clear all confirms the selected category and cancellation writes nothing',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [
        _alert('sos'),
        _alert('place', type: 'geofence_enter'),
        _alert('battery', type: 'low_battery'),
        _alert('history', resolved: true),
      ]);
      await _tap(tester, 'alerts-category-places');
      expect(find.text('Clear all (1)'), findsOneWidget);
      await _tap(tester, 'alerts-clear-all');
      expect(find.text('Clear 1 open alert?'), findsOneWidget);
      expect(find.textContaining('in the Places category'), findsOneWidget);
      expect(find.textContaining('SOS or fall alert'), findsNothing);
      await _tap(tester, 'alerts-cancel-clear');
      expect(h.bulkCalls, isEmpty);
      expect(h.writes, isEmpty);

      h.clear = (records) async {
        h.alerts.add([
          _alert('sos'),
          _alert('place', type: 'geofence_enter', resolved: true),
          _alert('battery', type: 'low_battery'),
          _alert('history', resolved: true),
        ]);
        return records.length;
      };
      await _tap(tester, 'alerts-clear-all');
      await _tap(tester, 'alerts-confirm-clear');
      expect(h.bulkCalls.single.map((a) => a.id), ['place']);
      expect(find.text('Open (2)'), findsOneWidget);
      await _tap(tester, 'alerts-history');
      expect(find.byKey(const Key('alert-row-place')), findsOneWidget);
      expect(find.byKey(const Key('alerts-clear-all')), findsNothing);
      expect(h.writes, isEmpty);
    },
  );

  testWidgets(
    'Clear all freezes IDs before confirmation and keeps a new SOS open',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [
        _alert('old-sos'),
        _alert('place', type: 'geofence_enter'),
      ]);
      await _tap(tester, 'alerts-clear-all');
      expect(find.text('Clear 2 open alerts?'), findsOneWidget);
      expect(
        find.textContaining('Includes 1 SOS or fall alert'),
        findsOneWidget,
      );
      h.alerts.add([
        _alert('new-sos'),
        _alert('old-sos'),
        _alert('place', type: 'geofence_enter'),
      ]);
      await tester.pumpAndSettle();
      expect(find.text('Clear 2 open alerts?'), findsOneWidget);
      h.clear = (records) async {
        h.alerts.add([
          _alert('new-sos'),
          _alert('old-sos', resolved: true),
          _alert('place', type: 'geofence_enter', resolved: true),
        ]);
        return records.length;
      };
      await _tap(tester, 'alerts-confirm-clear');
      expect(h.bulkCalls.single.map((a) => a.id), ['old-sos', 'place']);
      expect(find.text('Open (1)'), findsOneWidget);
      expect(find.byKey(const Key('alert-row-new-sos')), findsOneWidget);
      expect(h.calls, isEmpty);
      expect(h.maps, isEmpty);
      expect(h.writes, isEmpty);
    },
  );

  testWidgets(
    'Clear all rechecks resolution and linked visibility after confirmation',
    (tester) async {
      final h = _Harness();
      await h.mount(tester, [
        _alert('resolved-elsewhere'),
        _alert('unlinked'),
        _alert('remaining'),
      ]);
      await _tap(tester, 'alerts-clear-all');
      h.alerts.add([
        _alert('resolved-elsewhere', resolved: true),
        _alert('remaining'),
      ]);
      await tester.pumpAndSettle();
      h.clear = (records) async {
        h.alerts.add([
          _alert('resolved-elsewhere', resolved: true),
          _alert('remaining', resolved: true),
        ]);
        return records.length;
      };
      await _tap(tester, 'alerts-confirm-clear');
      expect(h.bulkCalls.single.map((a) => a.id), ['remaining']);
    },
  );

  testWidgets('Clear all skips writes if its entire group disappears', (
    tester,
  ) async {
    final h = _Harness();
    await h.mount(tester, [_alert('unlinked')]);
    await _tap(tester, 'alerts-clear-all');
    h.alerts.add([]);
    await tester.pumpAndSettle();
    await _tap(tester, 'alerts-confirm-clear');
    expect(h.bulkCalls, isEmpty);
    expect(h.writes, isEmpty);
  });

  testWidgets('Clear all failure keeps the group open and offers a retry', (
    tester,
  ) async {
    final h = _Harness()
      ..clear = (_) => Future<int>.error(StateError('denied'));
    await h.mount(tester, [_alert('first'), _alert('second')]);
    await _tap(tester, 'alerts-clear-all');
    await _tap(tester, 'alerts-confirm-clear');
    expect(find.byKey(const Key('alerts-clear-error')), findsOneWidget);
    expect(find.text('Open (2)'), findsOneWidget);
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('alerts-clear-all')))
          .onPressed,
      isNotNull,
    );
    h.clear = (records) async {
      h.alerts.add([
        _alert('first', resolved: true),
        _alert('second', resolved: true),
      ]);
      return records.length;
    };
    await _tap(tester, 'alerts-clear-all');
    await _tap(tester, 'alerts-confirm-clear');
    expect(h.bulkCalls, hasLength(2));
    expect(find.byKey(const Key('alerts-clear-error')), findsNothing);
    expect(find.text('Open (0)'), findsOneWidget);
  });

  testWidgets('Clear all blocks repeat submission while the group is saving', (
    tester,
  ) async {
    final pending = Completer<int>();
    final h = _Harness()..clear = (_) => pending.future;
    await h.mount(tester, [_alert('first')]);
    await _tap(tester, 'alerts-clear-all');
    await tester.tap(find.byKey(const Key('alerts-confirm-clear')));
    await tester.pump(const Duration(milliseconds: 400));
    expect(h.bulkCalls, hasLength(1));
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('alerts-clear-all')))
          .onPressed,
      isNull,
    );
    expect(
      tester
          .widget<OutlinedButton>(find.byKey(const Key('alert-resolve')))
          .onPressed,
      isNull,
    );
    expect(find.byKey(const Key('alert-row-first')), findsOneWidget);
    pending.complete(1);
    h.alerts.add([_alert('first', resolved: true)]);
    await tester.pumpAndSettle();
    expect(h.bulkCalls, hasLength(1));
  });

  testWidgets('Clear all is disabled for an empty Open view', (tester) async {
    final h = _Harness();
    await h.mount(tester, []);
    expect(
      tester
          .widget<TextButton>(find.byKey(const Key('alerts-clear-all')))
          .onPressed,
      isNull,
    );
    await _tap(tester, 'alerts-history');
    expect(find.byKey(const Key('alerts-clear-all')), findsNothing);
  });

  testWidgets('Clear all confirmation fits a narrow screen with large text', (
    tester,
  ) async {
    final h = _Harness();
    await h.mount(
      tester,
      [_alert('first'), _alert('second')],
      width: 320,
      textScale: 1.6,
      theme: GuardianThemeId.leMorne,
    );
    await _tap(tester, 'alerts-clear-all');
    expect(
      find.textContaining('Includes 2 SOS or fall alerts'),
      findsOneWidget,
    );
    await _tap(tester, 'alerts-cancel-clear');
    expect(tester.takeException(), isNull);
    expect(h.bulkCalls, isEmpty);
  });
}
