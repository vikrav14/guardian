import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/screens/home_wifi_setup_page.dart';
import 'package:guardian/services/home_wifi_service.dart';

const zone = Geofence(
  id: 'home',
  imei: '359633100123456',
  name: 'Home',
  active: true,
  lat: -20.1,
  lng: 57.1,
  radiusMeters: 150,
);

class FakeWifiClient implements HomeWifiClient {
  bool fail = false;
  bool failRead = false;
  int writes = 0;
  int removals = 0;
  int version = 0;
  bool enabled = false;
  DateTime at = DateTime.now();
  @override
  Future<HomeWifiState> load(String imei, String geofenceId) async {
    if (failRead) throw const HomeWifiException('owner_required');
    return HomeWifiState(
      version: version,
      enabled: enabled,
      connected: true,
      homeKey: 'key',
      name: enabled ? 'My Home' : null,
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: zone.radiusMeters,
      networks: [
        for (final id in ['one', 'two'])
          HomeWifiNetwork(
            id: id,
            name: 'My Home',
            radioHint: id == 'one' ? '00:01' : '00:02',
            signalDbm: -60,
            observedAt: at,
            expiresAt: at.add(const Duration(minutes: 2)),
          ),
      ],
    );
  }

  @override
  Future<void> save(
    String imei,
    String geofenceId, {
    required String candidateId,
    required int expectedVersion,
    required String homeKey,
  }) async {
    writes++;
    expect(expectedVersion, version);
    if (fail) throw TimeoutException('lost response');
    version++;
    enabled = true;
  }

  @override
  Future<void> remove(String imei, {required int expectedVersion}) async {
    expect(expectedVersion, version);
    removals++;
    version++;
    enabled = false;
  }

  @override
  void close() {}
}

Widget screen(FakeWifiClient client, {double scale = 1}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: HomeWifiSetupPage(
    zone: zone,
    client: client,
    mapBuilder: (_) => const Text('Home map'),
  ),
);
final save = find.widgetWithText(FilledButton, 'Save Home Wi-Fi');
Future<void> selectAndConfirm(WidgetTester tester) async {
  await tester.ensureVisible(find.byKey(const ValueKey('one')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('one')));
  await tester.pump();
  await tester.ensureVisible(find.byType(CheckboxListTile));
  await tester.pumpAndSettle();
  await tester.tap(find.byType(CheckboxListTile));
  await tester.pump();
  await tester.ensureVisible(save);
  await tester.pumpAndSettle();
}

void main() {
  test(
    'service uses authenticated scoped API and never sends raw radio/name fields',
    () async {
      final seen = <http.Request>[];
      final service = HomeWifiService(
        gatewayUrl: 'https://guardian.example',
        token: () async => 'token',
        client: MockClient((request) async {
          seen.add(request);
          return http.Response(
            jsonEncode({
              'saved': {'version': 1, 'enabled': false},
              'networks': [],
            }),
            200,
          );
        }),
      );
      await service.load(zone.imei, zone.id);
      await service.save(
        zone.imei,
        zone.id,
        candidateId: 'opaque',
        expectedVersion: 0,
        homeKey: 'pin',
      );
      await service.remove(zone.imei, expectedVersion: 1);
      expect(seen.map((r) => r.method), ['GET', 'POST', 'DELETE']);
      expect(seen.first.url.queryParameters, {
        'imei': zone.imei,
        'geofenceId': zone.id,
      });
      expect(
        seen.every((r) => r.headers['Authorization'] == 'Bearer token'),
        isTrue,
      );
      expect(jsonDecode(seen[1].body), {
        'candidateId': 'opaque',
        'expectedVersion': 0,
        'geofenceId': 'home',
        'homeKey': 'pin',
      });
      service.close();
    },
  );
  testWidgets(
    'selection requires pin confirmation; saving is explicit and never claims Home',
    (tester) async {
      final client = FakeWifiClient();
      await tester.pumpWidget(screen(client));
      await tester.pumpAndSettle();
      expect(client.writes, 0);
      expect(find.text('My Home'), findsNWidgets(2));
      await selectAndConfirm(tester);
      expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(client.writes, 1);
      expect(
        find.text('Home Wi-Fi saved. Waiting for fresh watch reports.'),
        findsOneWidget,
      );
      expect(find.textContaining('Home Wi-Fi detected at'), findsNothing);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'unknown save outcome blocks resubmission until a read-only refresh',
    (tester) async {
      final client = FakeWifiClient()..fail = true;
      await tester.pumpWidget(screen(client));
      await tester.pumpAndSettle();
      await selectAndConfirm(tester);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(client.writes, 1);
      expect(tester.widget<FilledButton>(save).onPressed, isNull);
      expect(find.textContaining('save result is unconfirmed'), findsOneWidget);
      await tester.pump(const Duration(seconds: 30));
      expect(client.writes, 1);
      await tester.ensureVisible(find.byTooltip('Refresh list'));
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Refresh list'));
      await tester.pumpAndSettle();
      expect(client.writes, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('expired scans and owner denial cannot be saved', (tester) async {
    final client = FakeWifiClient()
      ..at = DateTime.now().subtract(const Duration(minutes: 3));
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('one')), findsNothing);
    await tester.ensureVisible(save);
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
    client.failRead = true;
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(
      find.text('Only the service owner can manage Home Wi-Fi.'),
      findsOneWidget,
    );
    expect(client.writes, 0);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
    'remove is confirmed and clears selection without deleting the zone',
    (tester) async {
      final client = FakeWifiClient()
        ..enabled = true
        ..version = 1;
      await tester.pumpWidget(screen(client));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Remove saved network'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Remove saved network'));
      await tester.pumpAndSettle();
      expect(client.removals, 0);
      await tester.tap(find.text('Remove'));
      await tester.pumpAndSettle();
      expect(client.removals, 1);
      expect(find.text('Home Wi-Fi removed.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets(
    'network picker remains usable on narrow screens with large text',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(screen(FakeWifiClient(), scale: 1.5));
      await tester.pumpAndSettle();
      await selectAndConfirm(tester);
      expect(tester.widget<FilledButton>(save).onPressed, isNotNull);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
