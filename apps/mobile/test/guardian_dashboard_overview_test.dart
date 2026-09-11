import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/models/home_wifi_presence.dart';
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
  for (final width in [320.0, 1280.0]) {
    testWidgets('Home/GPS disagreement is visible at $width px with large text', (tester) async {
      final now = DateTime.now().toUtc();
      final gps = DeviceLocation(lat: -20.16, lng: 57.15, source: 'gps', gpsValid: true,
        recordedAt: now.subtract(const Duration(seconds: 1)), placeLabel: 'Recorded GPS place');
      final device = Device(imei: 'demo-watch-a', online: true,
        nickname: 'Alex Morgan', connectionState: 'live', lastHeartbeatAt: now,
        batteryPercent: 60, lastSatelliteLocation: gps,
        homeWifiPresence: HomeWifiPresence(lat: -20.15, lng: 57.15,
          policyVersion: 3, radiusMeters: 50, conflictReason: 'gps_outside_home',
          observedAt: now.subtract(const Duration(seconds: 20)),
          expiresAt: now.add(const Duration(seconds: 40))));
      var calls = 0;
      await _pump(tester, dashboardFixtureOverview(device: device, onCall: () => calls++),
        width: width, textScale: 2);
      expect(tester.takeException(), isNull);
      expect(find.text('Location uncertain'), findsWidgets);
      expect(find.text('Home Wi-Fi detected · location uncertain.'), findsOneWidget);
      expect(find.textContaining('Current position unconfirmed.'), findsOneWidget);
      expect(find.text('At or near saved Home.'), findsNothing);
      expect(device.mapDisplayLocation, same(gps));
      await _tap(tester, find.text('Call watch'));
      expect(calls, 1);
      expect(tester.takeException(), isNull);
    });
  }
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
    await _tap(tester, find.byTooltip('Open Guardian help'));
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
    await _tap(tester, find.byTooltip('Guardian help requires a Family plan'));
    expect(opened, 1);
    expect(find.text('Guardian insight'), findsNothing);
  });

  testWidgets('missing callbacks leave call and journey disabled', (
    tester,
  ) async {
    await _pump(tester, dashboardFixtureOverview());

    final call = tester.widget<FilledButton>(
      find.ancestor(
        of: find.text('Call watch'),
        matching: find.byType(FilledButton),
      ),
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

    await _pump(tester, dashboardFixtureOverview(empty: true, loading: true));
    expect(find.text('Loading your watches'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    expect(find.text('Link a watch'), findsNothing);
    expect(find.text('Watch connected'), findsNothing);
  });

  testWidgets('read failure is visible with and without cached watch data', (
    tester,
  ) async {
    await _pump(tester, dashboardFixtureOverview(empty: true, hasError: true));
    expect(find.text('Watch updates are unavailable'), findsOneWidget);
    expect(find.text('Bring your family into view'), findsNothing);
    expect(find.text('Link a watch'), findsNothing);

    await _pump(tester, dashboardFixtureOverview(hasError: true));
    expect(find.text('Watch updates are unavailable'), findsOneWidget);
    expect(
      find.text(
        'Showing the last information received. Check your connection.',
      ),
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
    expect(find.text('Checked in 1m ago'), findsOneWidget);
    expect(find.text('Last reliable fix'), findsNothing);
    expect(find.text('13m ago'), findsOneWidget);
    expect(find.byTooltip('Last reliable GPS fix 13m ago'), findsOneWidget);
    expect(find.text('Last known location'), findsOneWidget);
    expect(find.text('Sample network estimate'), findsNothing);
    expect(
      find.textContaining(
        'Showing the last reliable GPS position.',
        findRichText: true,
      ),
      findsOneWidget,
    );
    expect(device.mapDisplayLocation, same(device.lastSatelliteLocation));
    expect(device.location?.placeLabel, 'Sample network estimate');
    expect(find.text('Sample garden'), findsNWidgets(2));
  });

  testWidgets(
    'location evidence uses the map timestamp independently of a connected watch',
    (tester) async {
      final now = DateTime.now();
      for (final sample in [
        (
          source: 'gps',
          age: const Duration(hours: 2),
          status: 'Satellite GPS',
          stale: true,
        ),
        (
          source: 'gps',
          age: const Duration(seconds: 20),
          status: 'Satellite GPS',
          stale: false,
        ),
        (
          source: 'wifi',
          age: const Duration(seconds: 20),
          status: 'Approximate area',
          stale: false,
        ),
        (
          source: 'home_wifi',
          age: const Duration(seconds: 20),
          status: 'Home Wi-Fi detected',
          stale: false,
        ),
        (
          source: 'unknown',
          age: const Duration(hours: 2),
          status: 'Last known',
          stale: false,
        ),
      ]) {
        final device = Device(
          imei: 'demo-watch-a',
          online: true,
          connectionState: 'live',
          lastHeartbeatAt: now,
          location: DeviceLocation(
            lat: -20.1,
            lng: 57.5,
            source: sample.source,
            recordedAt: now.subtract(sample.age),
          ),
        );
        await _pump(
          tester,
          dashboardFixtureOverview(device: device, mapStatus: sample.status),
        );
        expect(find.text('Watch connected'), findsOneWidget);
        expect(
          find.text(sample.age.inHours >= 2 ? '2h ago' : 'Just now'),
          findsOneWidget,
        );
        expect(
          find.textContaining('No recent GPS update.', findRichText: true),
          sample.stale ? findsOneWidget : findsNothing,
        );
        if (sample.source == 'unknown') {
          expect(
            find.textContaining(
              'Showing the last GPS position.',
              findRichText: true,
            ),
            findsNothing,
          );
          expect(
            find.textContaining(
              'Showing the last known location.',
              findRichText: true,
            ),
            findsOneWidget,
          );
        }
        if (sample.source == 'wifi') {
          expect(find.text('Approximate area'), findsOneWidget);
          expect(
            find.textContaining(
              'This network estimate may cover a wider area.',
              findRichText: true,
            ),
            findsOneWidget,
          );
        }
        if (sample.source == 'home_wifi') {
          expect(find.text('Home Wi-Fi detected'), findsOneWidget);
          expect(
            find.textContaining('At or near saved Home.', findRichText: true),
            findsOneWidget,
          );
          expect(find.text('Last known location'), findsNothing);
        }
        expect(tester.takeException(), isNull);
      }
    },
  );

  testWidgets('unknown or future map times never appear as a fresh fix', (
    tester,
  ) async {
    for (final recordedAt in [
      null,
      DateTime.now().add(const Duration(hours: 2)),
    ]) {
      await _pump(
        tester,
        dashboardFixtureOverview(
          device: Device(
            imei: 'demo-watch-a',
            online: false,
            location: DeviceLocation(
              lat: -20.1,
              lng: 57.5,
              source: 'gps',
              recordedAt: recordedAt,
            ),
          ),
        ),
      );
      expect(find.text('Time unavailable'), findsOneWidget);
      expect(find.byTooltip('Location time unavailable'), findsOneWidget);
      expect(find.byTooltip('Satellite GPS updated just now'), findsNothing);
      expect(find.text('Just now'), findsNothing);
      expect(
        find.textContaining('No recent GPS update.', findRichText: true),
        findsNothing,
      );
    }
  });

  testWidgets(
    'future service sections are optional and keep the Care summary independent',
    (tester) async {
      await _pump(tester, dashboardFixtureOverview());
      expect(find.text('Activity review sample'), findsNothing);
      await _pump(
        tester,
        dashboardFixtureOverview(
          serviceSections: const [Text('Activity review sample')],
        ),
      );
      expect(find.text('Activity review sample'), findsOneWidget);
      expect(find.text('Today'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'safe zone count excludes another watch, inactive and unset zones',
    (tester) async {
      await _pump(
        tester,
        dashboardFixtureOverview(
          geofences: const [
            dashboardFixtureZone,
            Geofence(
              id: 'other',
              imei: 'demo-watch-b',
              name: 'Other family member zone',
              active: true,
              lat: -20.2,
              lng: 57.6,
              radiusMeters: 100,
            ),
            Geofence(
              id: 'inactive',
              imei: 'demo-watch-a',
              name: 'Inactive zone',
              active: false,
              lat: -20.2,
              lng: 57.6,
              radiusMeters: 100,
            ),
            Geofence(
              id: 'unset',
              imei: 'demo-watch-a',
              name: 'Unset zone',
              active: true,
              lat: 0,
              lng: 0,
              radiusMeters: 100,
            ),
          ],
        ),
      );

      expect(find.text('1 active zone'), findsOneWidget);
      expect(find.text('Other family member zone'), findsNothing);
      expect(find.text('Inactive zone'), findsNothing);
      expect(find.text('Unset zone'), findsNothing);
      expect(find.text('Protection active'), findsNothing);
    },
  );
}
