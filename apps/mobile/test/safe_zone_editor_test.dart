import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/navigation/guardian_navigation_shell.dart';
import 'package:guardian/screens/safe_zone_editor_page.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';

const _devices = [
  Device(
    imei: 'test-watch',
    online: true,
    nickname: 'Amira',
    location: DeviceLocation(lat: -20.2, lng: 57.5),
  ),
  Device(imei: 'test-watch-2', online: false, nickname: 'Marcel'),
];

Future<GlobalKey<NavigatorState>> _pump(
  WidgetTester tester, {
  required Future<void> Function(Geofence) save,
  double width = 390,
  double scale = 1,
  List<Device> devices = _devices,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 844);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetViewInsets);
  final nav = GlobalKey<NavigatorState>();
  await tester.pumpWidget(
    MaterialApp(
      theme: buildGuardianTheme(themeId: GuardianThemeId.chamarel),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: GuardianNavigationShell(
        navigatorKey: nav,
        headerBuilder: (_) => const SizedBox.shrink(),
        pages: const [
          Text('Home page'),
          Text('Zones page'),
          Text('Family page'),
          Text('Watch page'),
        ],
      ),
    ),
  );
  await tester.pumpAndSettle();
  nav.currentState!.push(
    MaterialPageRoute<bool>(
      builder: (_) => SafeZoneEditorPage(
        devices: devices,
        onCreate: save,
        mapBuilder: (_, zone) =>
            Center(child: Text('Map preview ${zone.radiusMeters}')),
        pickerBuilder: (_, _, _) => Builder(
          builder: (context) => Scaffold(
            appBar: AppBar(title: const Text('Choose centre')),
            body: FilledButton(
              onPressed: () =>
                  Navigator.pop(context, const LatLng(-20.25, 57.48)),
              child: const Text('Use this location'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return nav;
}

Finder _field(String label) => find.byWidgetPredicate(
  (w) => w is TextField && w.decoration?.labelText == label,
);

Future<void> _chooseCentre(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Choose on map'));
  await tester.tap(find.text('Choose on map'));
  await tester.pumpAndSettle();
  expect(find.byType(MobileBottomBar), findsOneWidget);
  await tester.tap(find.text('Use this location'));
  await tester.pumpAndSettle();
  expect(tester.testTextInput.isVisible, isFalse);
}

void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  for (final (width, scale) in [(320.0, 2.0), (390.0, 1.0), (1100.0, 1.0)]) {
    testWidgets('form and save stay usable with keyboard at $width / $scale', (
      tester,
    ) async {
      await _pump(tester, width: width, scale: scale, save: (_) async {});
      await tester.ensureVisible(_field('Place name'));
      await tester.enterText(_field('Place name'), 'Grand-mère’s house');
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      final save = find.widgetWithText(FilledButton, 'Create safe zone');
      expect(save.hitTestable(), findsOneWidget);
      expect(tester.getBottomLeft(save).dy, lessThanOrEqualTo(844 - 300));
      expect(tester.getBottomLeft(save).dy, greaterThan(844 - 300 - 40));
      expect(find.byType(MobileBottomBar), findsOneWidget);
      await tester.ensureVisible(_field('Radius'));
      await tester.enterText(_field('Radius'), '250');
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(_field('Radius').hitTestable(), findsOneWidget);
    });
  }

  testWidgets('validates name, radius and confirmed centre before creating', (
    tester,
  ) async {
    final saved = <Geofence>[];
    await _pump(tester, save: (zone) async => saved.add(zone));
    await tester.enterText(_field('Place name'), '');
    await tester.tap(find.text('Create safe zone'));
    await tester.pumpAndSettle();
    expect(find.text('Give this place a name.'), findsOneWidget);
    await tester.enterText(_field('Place name'), 'School');
    await tester.ensureVisible(_field('Radius'));
    for (final invalid in ['NaN', '0', '49', '5001']) {
      await tester.enterText(_field('Radius'), invalid);
      await tester.tap(find.text('Create safe zone'));
      await tester.pumpAndSettle();
      expect(
        find.text('Enter a radius from 50 to 5,000 metres.'),
        findsOneWidget,
      );
    }
    await tester.enterText(_field('Radius'), '250');
    await tester.tap(find.text('Create safe zone'));
    await tester.pumpAndSettle();
    expect(
      find.text('Choose a centre on the map before saving.'),
      findsOneWidget,
    );
    expect(saved, isEmpty);
    await _chooseCentre(tester);
    await tester.tap(find.text('Create safe zone'));
    await tester.pumpAndSettle();
    expect(saved.single.name, 'School');
    expect(saved.single.radiusMeters, 250);
    expect(saved.single.lat, -20.25);
    expect(saved.single.lng, 57.48);
    expect(saved.single.imei, 'test-watch');
    expect(find.byType(SafeZoneEditorPage), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('picker back and switching tabs cancel without creating a zone', (
    tester,
  ) async {
    var saves = 0;
    final nav = await _pump(
      tester,
      save: (_) async {
        saves++;
      },
    );
    await tester.enterText(_field('Place name'), 'Grand-mère’s house');
    await tester.ensureVisible(find.text('Choose on map'));
    await tester.tap(find.text('Choose on map'));
    await tester.pumpAndSettle();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(
      tester.widget<TextField>(_field('Place name')).controller!.text,
      'Grand-mère’s house',
    );
    await tester.ensureVisible(find.text('Choose on map'));
    await tester.tap(find.text('Choose on map'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Family'));
    await tester.pumpAndSettle();
    expect(saves, 0);
    expect(nav.currentState!.canPop(), isFalse);
    expect(find.text('Family page'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'saving blocks repeat taps and back; failed save keeps the draft',
    (tester) async {
      final pending = Completer<void>();
      var calls = 0;
      await _pump(
        tester,
        devices: [_devices.first],
        save: (_) {
          calls++;
          return pending.future;
        },
      );
      expect(find.text('For Amira'), findsOneWidget);
      await _chooseCentre(tester);
      await tester.tap(find.text('Create safe zone'));
      await tester.pump();
      await tester.binding.handlePopRoute();
      await tester.tap(find.text('Family'));
      await tester.pump();
      expect(find.byType(SafeZoneEditorPage), findsOneWidget);
      expect(
        tester
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Saving…'))
            .onPressed,
        isNull,
      );
      expect(calls, 1);
      pending.completeError(StateError('offline'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Could not save this zone. Your details are kept. Please try again.',
        ),
        findsOneWidget,
      );
      expect(
        tester.widget<TextField>(_field('Place name')).controller!.text,
        'Home',
      );
      expect(find.text('Adjust location'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
