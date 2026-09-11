import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/safe_zones/safe_zones_overview.dart';

import 'support/dashboard_fixture.dart';
import 'support/safe_zones_fixture.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget overview, {
  double width = 390,
  bool dark = false,
  double textScale = 1,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 844);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    dashboardFixtureHost(overview, dark: dark, textScale: textScale),
  );
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  for (final width in [320.0, 390.0, 1280.0]) {
    for (final dark in [false, true]) {
      for (final scale in [1.0, 2.0]) {
        testWidgets(
          'safe zones fit $width px, ${dark ? 'dark' : 'light'}, ${scale}x text',
          (tester) async {
            await _pump(
              tester,
              safeZonesFixtureOverview(
                zones: [
                  safeZoneFixture(name: 'Grandparents home and family garden'),
                  safeZoneFixture(
                    id: 'preview-zone-school',
                    name: 'Primary school and afternoon activity centre',
                    active: false,
                  ),
                ],
                devices: [
                  dashboardFixtureDevice(
                    name: 'Alex Morgan With A Longer Family Name',
                  ),
                ],
                alerts: [safeZoneAlertFixture(type: 'sos')],
              ),
              width: width,
              dark: dark,
              textScale: scale,
            );

            expect(tester.takeException(), isNull);
            expect(find.text('Safe zones'), findsOneWidget);
            await tester.ensureVisible(find.text('Delete zone'));
            await tester.pump();
            expect(tester.takeException(), isNull);
            expect(find.text('Unresolved emergency alert'), findsOneWidget);
            final context = tester.element(find.text('Safe zones'));
            expect(
              context.guardianColors.surface,
              dark
                  ? GuardianThemeColors.dark.surface
                  : GuardianThemeColors.light.surface,
            );
          },
        );
      }
    }
  }

  testWidgets('same-name zones are selected by their saved ID', (tester) async {
    final first = safeZoneFixture();
    final second = safeZoneFixture(id: 'second-home', radius: 300);
    var zones = [first, second];
    late ValueChanged<List<Geofence>> replaceZones;
    await _pump(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          replaceZones = (next) => setState(() => zones = next);
          return safeZonesFixtureOverview(zones: zones);
        },
      ),
    );

    replaceZones([second, first]);
    await tester.pump();
    expect(
      find.byKey(const ValueKey('safe-zone-fixture-map-preview-zone-home')),
      findsOneWidget,
    );
    await _tap(tester, find.byKey(const ValueKey('select-zone-second-home')));

    expect(
      find.byKey(const ValueKey('safe-zone-fixture-map-second-home')),
      findsOneWidget,
    );
    expect(find.text('300 m radius'), findsOneWidget);
    expect(find.text('150 m radius'), findsNothing);
    expect(
      tester
          .widget<ChoiceChip>(
            find.byKey(const ValueKey('select-zone-second-home')),
          )
          .selected,
      isTrue,
    );
  });

  testWidgets('removing the selected zone falls back to a remaining zone', (
    tester,
  ) async {
    var zones = [
      safeZoneFixture(),
      safeZoneFixture(id: 'second-home', radius: 300),
    ];
    late ValueChanged<List<Geofence>> replaceZones;
    await _pump(
      tester,
      StatefulBuilder(
        builder: (context, setState) {
          replaceZones = (next) => setState(() => zones = next);
          return safeZonesFixtureOverview(
            zones: zones,
            onDelete: (zone) => setState(() {
              zones = zones.where((item) => item.id != zone.id).toList();
            }),
          );
        },
      ),
    );
    await _tap(tester, find.byKey(const ValueKey('select-zone-second-home')));
    await _tap(tester, find.text('Delete zone'));

    expect(
      find.byKey(const ValueKey('safe-zone-fixture-map-preview-zone-home')),
      findsOneWidget,
    );
    expect(find.text('150 m radius'), findsOneWidget);
    expect(find.text('1 active · 1 saved'), findsOneWidget);
    replaceZones([
      safeZoneFixture(id: 'second-home', radius: 300),
      safeZoneFixture(),
    ]);
    await tester.pump();
    expect(
      find.byKey(const ValueKey('safe-zone-fixture-map-preview-zone-home')),
      findsOneWidget,
    );
    expect(find.text('150 m radius'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'zone actions reach their supplied callbacks with the selection',
    (tester) async {
      final calls = <String>[];
      final zone = safeZoneFixture();
      await _pump(
        tester,
        safeZonesFixtureOverview(
          zones: [zone],
          alerts: [safeZoneAlertFixture(type: 'sos')],
          onAdd: () => calls.add('add'),
          onExpand: (value) => calls.add('expand:${value.id}'),
          onToggle: (value) => calls.add('toggle:${value.id}'),
          onDelete: (value) => calls.add('delete:${value.id}'),
          onAlerts: () => calls.add('alerts'),
        ),
      );

      await _tap(tester, find.text('Add zone'));
      await _tap(tester, find.text('Expand map'));
      await _tap(tester, find.text('Review alerts'));
      await _tap(tester, find.text('Pause zone'));
      await _tap(tester, find.text('Delete zone'));

      expect(calls, [
        'add',
        'expand:${zone.id}',
        'alerts',
        'toggle:${zone.id}',
        'delete:${zone.id}',
      ]);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('a pending write disables further toggle and delete actions', (
    tester,
  ) async {
    await _pump(
      tester,
      safeZonesFixtureOverview(busyZoneIds: {'preview-zone-home'}),
    );

    final toggle = tester.widget<OutlinedButton>(
      find.ancestor(
        of: find.text('Updating…'),
        matching: find.byType(OutlinedButton),
      ),
    );
    final delete = tester.widget<TextButton>(
      find.ancestor(
        of: find.text('Delete zone'),
        matching: find.byType(TextButton),
      ),
    );
    expect(toggle.onPressed, isNull);
    expect(delete.onPressed, isNull);
  });

  testWidgets('paused configuration does not hide an unresolved watch SOS', (
    tester,
  ) async {
    await _pump(
      tester,
      safeZonesFixtureOverview(
        zones: [safeZoneFixture(active: false)],
        alerts: [safeZoneAlertFixture(type: 'sos', geofenceId: null)],
      ),
    );

    expect(find.text('Zone paused'), findsOneWidget);
    expect(find.text('Activate zone'), findsOneWidget);
    expect(find.text('Unresolved emergency alert'), findsOneWidget);
    expect(
      find.textContaining('does not establish its current location'),
      findsOneWidget,
    );
    expect(find.text('SAFE'), findsNothing);
    expect(find.text('OUTSIDE'), findsNothing);
  });

  testWidgets(
    'recorded events require both the exact zone and assigned watch',
    (tester) async {
      final now = DateTime.now();
      await _pump(
        tester,
        safeZonesFixtureOverview(
          alerts: [
            safeZoneAlertFixture(
              id: 'correct-arrival',
              createdAt: now.subtract(const Duration(minutes: 20)),
            ),
            safeZoneAlertFixture(
              id: 'different-zone',
              type: 'geofence_exit',
              geofenceId: 'another-zone',
              createdAt: now.subtract(const Duration(minutes: 2)),
            ),
            safeZoneAlertFixture(
              id: 'different-watch',
              type: 'geofence_exit',
              imei: 'another-watch',
              createdAt: now.subtract(const Duration(minutes: 1)),
            ),
          ],
        ),
      );

      expect(find.textContaining('Arrival recorded ·'), findsOneWidget);
      expect(find.textContaining('Departure recorded ·'), findsNothing);
    },
  );

  testWidgets(
    'an event without a zone ID is not claimed as this zone history',
    (tester) async {
      await _pump(
        tester,
        safeZonesFixtureOverview(
          alerts: [safeZoneAlertFixture(geofenceId: null)],
        ),
      );

      expect(find.textContaining('Arrival recorded ·'), findsNothing);
      expect(
        find.text(
          'No arrival or departure in the available history for this zone.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets('empty zones offer the existing add flow', (tester) async {
    var adds = 0;
    await _pump(
      tester,
      safeZonesFixtureOverview(zones: const <Geofence>[], onAdd: () => adds++),
    );

    expect(find.text('Add a place that matters'), findsOneWidget);
    expect(find.byType(SafeZoneFixtureMap), findsNothing);
    await _tap(tester, find.text('Add zone'));
    expect(adds, 1);
  });

  testWidgets('loading history is not presented as an empty alert history', (
    tester,
  ) async {
    await _pump(tester, safeZonesFixtureOverview(alertsLoading: true));

    expect(find.text('Checking alert history…'), findsOneWidget);
    expect(find.textContaining('No arrival or departure'), findsNothing);
    expect(find.text('Latest recorded event'), findsNothing);
  });

  testWidgets('unavailable history is explicit without hiding zone controls', (
    tester,
  ) async {
    await _pump(tester, safeZonesFixtureOverview(alertsUnavailable: true));

    expect(
      find.textContaining('Alert history is unavailable.'),
      findsOneWidget,
    );
    expect(find.textContaining('No arrival or departure'), findsNothing);
    expect(find.text('Pause zone'), findsOneWidget);
    expect(find.text('Expand map'), findsOneWidget);
  });

  for (final outcome in ['Keep zone', 'dismiss', 'Delete zone']) {
    testWidgets('delete confirmation handles $outcome deliberately', (
      tester,
    ) async {
      bool? result;
      await _pump(
        tester,
        Builder(
          builder: (context) => FilledButton(
            onPressed: () async {
              result = await confirmSafeZoneDeletion(
                context,
                safeZoneFixture(),
              );
            },
            child: const Text('Open deletion confirmation'),
          ),
        ),
        width: outcome == 'Delete zone' ? 320 : 390,
        textScale: outcome == 'Delete zone' ? 2 : 1,
      );
      await _tap(tester, find.text('Open deletion confirmation'));
      expect(find.text('Delete safe zone?'), findsOneWidget);
      expect(result, isNull);

      if (outcome == 'dismiss') {
        await tester.tapAt(const Offset(4, 4));
        await tester.pumpAndSettle();
      } else {
        await _tap(tester, find.text(outcome));
      }

      expect(result, outcome == 'Delete zone');
      expect(find.text('Delete safe zone?'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  }
}
