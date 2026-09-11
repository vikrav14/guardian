import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/theme/colors.dart';

import 'support/dashboard_fixture.dart';

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
  await tester.pump();
}

void main() {
  for (final width in [320.0, 390.0, 768.0, 1280.0]) {
    for (final dark in [false, true]) {
      for (final textScale in [1.0, 2.0]) {
        testWidgets(
          'overview fits $width px, ${dark ? 'dark' : 'light'}, ${textScale}x text',
          (tester) async {
            final device = dashboardFixtureDevice(
              name: 'Alex Morgan With A Longer Family Name',
            );
            await _pump(
              tester,
              dashboardFixtureOverview(
                device: device,
                devices: [
                  device,
                  dashboardFixtureDevice(
                    imei: 'demo-watch-b',
                    name: 'Robin Taylor With A Longer Family Name',
                  ),
                ],
                careEnabled: true,
                onCall: () {},
                onJourney: () {},
                onHelp: () {},
                onWatchStatus: () {},
                onLocationDetails: () {},
                onSafeZones: () {},
              ),
              width: width,
              dark: dark,
              textScale: textScale,
            );

            expect(tester.takeException(), isNull);
            expect(find.text('Family overview'), findsOneWidget);
            await tester.ensureVisible(find.text('Manage safe zones'));
            await tester.pump();
            expect(tester.takeException(), isNull);
            await tester.ensureVisible(
              find.text('No activity reading in this sample.'),
            );
            await tester.pump();
            expect(tester.takeException(), isNull);
            expect(find.text('Guardian insight'), findsOneWidget);
            final context = tester.element(find.text('Family overview'));
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

  testWidgets('overview keeps every supplied watch action reachable', (
    tester,
  ) async {
    final calls = <String>[];
    await _pump(
      tester,
      dashboardFixtureOverview(
        onCall: () => calls.add('call'),
        onJourney: () => calls.add('journey'),
        onHelp: () => calls.add('help'),
        onWatchStatus: () => calls.add('watch'),
        onLocationDetails: () => calls.add('location'),
        onSafeZones: () => calls.add('zones'),
      ),
    );

    await _tap(tester, find.text('Call watch'));
    await _tap(tester, find.text('View journey'));
    await _tap(tester, find.text('Guardian help'));
    await _tap(tester, find.text('Watch connected'));
    await _tap(tester, find.text('Location details'));
    await _tap(tester, find.text('Manage safe zones'));

    expect(calls, ['call', 'journey', 'help', 'watch', 'location', 'zones']);
    expect(tester.takeException(), isNull);
  });

  testWidgets('locked help remains reachable for the existing plan flow', (
    tester,
  ) async {
    var opened = 0;
    await _pump(
      tester,
      dashboardFixtureOverview(
        aiEnabled: false,
        helpEnabled: false,
        onHelp: () => opened++,
      ),
    );

    expect(find.byIcon(Icons.lock_outline_rounded), findsOneWidget);
    expect(
      find.byTooltip('Guardian help requires a Family plan'),
      findsOneWidget,
    );
    await _tap(tester, find.text('Guardian help'));
    expect(opened, 1);
    expect(find.text('Guardian insight'), findsNothing);
  });

  testWidgets('missing callbacks leave call and journey disabled', (
    tester,
  ) async {
    await _pump(tester, dashboardFixtureOverview());

    final call = tester.widget<FilledButton>(
      find.ancestor(of: find.text('Call watch'), matching: find.byType(FilledButton)),
    );
    final journey = tester.widget<OutlinedButton>(
      find.ancestor(
        of: find.text('View journey'),
        matching: find.byType(OutlinedButton),
      ),
    );
    expect(call.onPressed, isNull);
    expect(journey.onPressed, isNull);
  });

  testWidgets('family selection reports the chosen device identity', (
    tester,
  ) async {
    final first = dashboardFixtureDevice();
    final second = dashboardFixtureDevice(
      imei: 'demo-watch-b',
      name: 'Robin Taylor',
    );
    String? selected;
    await _pump(
      tester,
      dashboardFixtureOverview(
        device: first,
        devices: [first, second],
        onSelect: (imei) => selected = imei,
      ),
    );

    final firstChip = find.widgetWithText(ChoiceChip, first.displayName);
    final secondChip = find.widgetWithText(ChoiceChip, second.displayName);
    expect(tester.widget<ChoiceChip>(firstChip).selected, isTrue);
    expect(tester.widget<ChoiceChip>(secondChip).selected, isFalse);
    await _tap(tester, secondChip);
    expect(selected, second.imei);
  });

  testWidgets('a single watch does not add a redundant family selector', (
    tester,
  ) async {
    await _pump(tester, dashboardFixtureOverview());
    expect(find.byType(ChoiceChip), findsNothing);
  });

  testWidgets('AI and care content follow their independent entitlements', (
    tester,
  ) async {
    for (final aiEnabled in [false, true]) {
      for (final careEnabled in [false, true]) {
        await _pump(
          tester,
          dashboardFixtureOverview(
            aiEnabled: aiEnabled,
            careEnabled: careEnabled,
          ),
        );
        expect(
          find.text('Guardian insight'),
          aiEnabled ? findsOneWidget : findsNothing,
        );
        expect(
          find.text(dashboardFixtureInsight),
          aiEnabled ? findsOneWidget : findsNothing,
        );
        expect(find.text('Today'), careEnabled ? findsOneWidget : findsNothing);
        expect(
          find.text('No activity reading in this sample.'),
          careEnabled ? findsOneWidget : findsNothing,
        );
      }
    }
  });

  testWidgets('empty and loading states never imply a connected watch', (
    tester,
  ) async {
    var linked = 0;
    await _pump(
      tester,
      dashboardFixtureOverview(empty: true, onLinkWatch: () => linked++),
    );
    expect(find.text('Bring your family into view'), findsOneWidget);
    expect(find.text('Watch connected'), findsNothing);
    expect(find.byType(DashboardFixtureMap), findsNothing);
    await _tap(tester, find.text('Link a watch'));
    expect(linked, 1);

    await _pump(
      tester,
      dashboardFixtureOverview(empty: true, loading: true),
    );
    expect(find.text('Loading your watches'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Link a watch'), findsNothing);
    expect(find.text('Watch connected'), findsNothing);
  });

  testWidgets('read failure is visible with and without cached watch data', (
    tester,
  ) async {
    await _pump(
      tester,
      dashboardFixtureOverview(empty: true, hasError: true),
    );
    expect(find.text('Watch updates are unavailable'), findsOneWidget);
    expect(find.text('Bring your family into view'), findsNothing);
    expect(find.text('Link a watch'), findsNothing);

    await _pump(tester, dashboardFixtureOverview(hasError: true));
    expect(find.text('Watch updates are unavailable'), findsOneWidget);
    expect(
      find.text('Showing the last information received. Check your connection.'),
      findsOneWidget,
    );
    expect(find.text('Alex Morgan'), findsOneWidget);
    expect(find.byType(DashboardFixtureMap), findsOneWidget);
  });

  testWidgets('location without coordinates uses a factual waiting state', (
    tester,
  ) async {
    final now = DateTime.now();
    await _pump(
      tester,
      dashboardFixtureOverview(
        device: Device(
          imei: 'demo-watch-a',
          nickname: 'Alex Morgan',
          online: true,
          connectionState: 'live',
          lastHeartbeatAt: now,
        ),
      ),
    );

    expect(find.text('Watch connected'), findsOneWidget);
    expect(find.text('Waiting for a location'), findsOneWidget);
    expect(find.byType(DashboardFixtureMap), findsOneWidget);
    final mapSemantics = tester.widget<ExcludeSemantics>(
      find.ancestor(
        of: find.byType(DashboardFixtureMap),
        matching: find.byType(ExcludeSemantics),
      ),
    );
    expect(mapSemantics.excluding, isTrue);
    expect(find.byIcon(Icons.location_searching_rounded), findsOneWidget);
    expect(find.text('Battery unavailable'), findsOneWidget);
  });

  testWidgets('connected watch retains GPS place and age over newer Wi-Fi', (
    tester,
  ) async {
    final device = dashboardFixtureDevice(now: DateTime.now());
    await _pump(tester, dashboardFixtureOverview(device: device));

    expect(find.text('Watch connected'), findsOneWidget);
    expect(find.text('Watch checked in 1m ago'), findsOneWidget);
    expect(find.text('Last reliable fix'), findsOneWidget);
    expect(find.text('Last reliable GPS fix 13m ago'), findsOneWidget);
    expect(find.text('Sample network estimate'), findsNothing);
    expect(
      find.textContaining('The pin stays at the last reliable GPS position.'),
      findsOneWidget,
    );
    expect(device.mapDisplayLocation, same(device.lastSatelliteLocation));
    expect(device.location?.placeLabel, 'Sample network estimate');
    expect(find.text('Sample garden'), findsNWidgets(2));
  });

  testWidgets('safe zone count excludes another watch, inactive and unset zones', (
    tester,
  ) async {
    await _pump(
      tester,
      dashboardFixtureOverview(
        geofences: const [
          dashboardFixtureZone,
          Geofence(
            id: 'other', imei: 'demo-watch-b', name: 'Other family member zone',
            active: true, lat: -20.2, lng: 57.6, radiusMeters: 100,
          ),
          Geofence(
            id: 'inactive', imei: 'demo-watch-a', name: 'Inactive zone',
            active: false, lat: -20.2, lng: 57.6, radiusMeters: 100,
          ),
          Geofence(
            id: 'unset', imei: 'demo-watch-a', name: 'Unset zone',
            active: true, lat: 0, lng: 0, radiusMeters: 100,
          ),
        ],
      ),
    );

    expect(find.text('1 active zone'), findsOneWidget);
    expect(find.text('Other family member zone'), findsNothing);
    expect(find.text('Inactive zone'), findsNothing);
    expect(find.text('Unset zone'), findsNothing);
    expect(find.text('Protection active'), findsNothing);
  });
}
