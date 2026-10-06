import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/screens/home_wifi_setup_page.dart';
import 'package:guardian/services/home_wifi_service.dart';
import 'package:guardian/services/phone_wifi_scanner.dart';

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
  bool unnamed = false;
  bool phoneMatch = true;
  final phoneRequests = <List<PhoneWifiNetwork>>[];
  DateTime at = DateTime.now();
  @override
  Future<HomeWifiState> load(
    String imei,
    String geofenceId, {
    List<PhoneWifiNetwork> phoneNetworks = const [],
    String? homeKey,
  }) async {
    if (failRead) throw const HomeWifiException('owner_required');
    phoneRequests.add(phoneNetworks);
    return HomeWifiState(
      version: version,
      enabled: enabled,
      connected: true,
      homeKey: 'key',
      name: enabled ? 'My Home' : null,
      lat: zone.lat,
      lng: zone.lng,
      radiusMeters: zone.radiusMeters,
      phoneMatches: phoneMatch && phoneNetworks.isNotEmpty ? [0] : [],
      networks: [
        for (final id in ['one', 'two'])
          HomeWifiNetwork(
            id: id,
            name: unnamed
                ? (phoneMatch && phoneNetworks.isNotEmpty && id == 'one'
                      ? phoneNetworks.first.ssid
                      : 'Unnamed network')
                : 'My Home',
            nameSource:
                unnamed && phoneMatch && phoneNetworks.isNotEmpty && id == 'one'
                ? 'phone'
                : null,
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

class FakePhoneScanner implements PhoneWifiScanner {
  FakePhoneScanner({this.supported = true});
  @override
  final bool supported;
  String? error;
  int calls = 0;
  @override
  Future<List<PhoneWifiNetwork>> scan() async {
    calls++;
    if (error != null) throw PhoneWifiScanException(error!);
    return const [
      PhoneWifiNetwork(
        bssid: '02:00:00:00:00:01',
        ssid: 'Real Home',
        frequency: 2412,
      ),
    ];
  }

  @override
  void close() {}
}

Widget screen(
  FakeWifiClient client, {
  double scale = 1,
  PhoneWifiScanner? scanner,
}) => MaterialApp(
  builder: (context, child) => MediaQuery(
    data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
    child: child!,
  ),
  home: HomeWifiSetupPage(
    zone: zone,
    client: client,
    scanner: scanner ?? FakePhoneScanner(supported: false),
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
    'phone scan is authenticated, bound to Home, and never submitted as enrollment',
    () async {
      final seen = <http.Request>[];
      final service = HomeWifiService(
        gatewayUrl: 'https://guardian.example',
        token: () async => 'token',
        client: MockClient((request) async {
          seen.add(request);
          return http.Response(
            jsonEncode({
              'saved': {'version': 0, 'enabled': false},
              'networks': [],
              'phoneMatches': [0],
            }),
            200,
          );
        }),
      );
      final state = await service.load(
        zone.imei,
        zone.id,
        homeKey: 'pin',
        phoneNetworks: const [
          PhoneWifiNetwork(
            bssid: '02:00:00:00:00:01',
            ssid: 'Home',
            frequency: 2412,
          ),
        ],
      );
      expect(seen.single.url.path, '/app/home-wifi/phone-scan');
      expect(seen.single.url.queryParameters['geofenceId'], zone.id);
      expect(seen.single.headers['Authorization'], 'Bearer token');
      expect(jsonDecode(seen.single.body), {
        'homeKey': 'pin',
        'networks': [
          {'bssid': '02:00:00:00:00:01', 'ssid': 'Home', 'frequency': 2412},
        ],
      });
      expect(state.phoneMatches, [0]);
      expect(state.enabled, isFalse);
      service.close();
    },
  );
  testWidgets(
    'explicit Android scan names verified choices without automatic saving',
    (tester) async {
      final client = FakeWifiClient()..unnamed = true;
      final scanner = FakePhoneScanner();
      await tester.pumpWidget(screen(client, scanner: scanner));
      await tester.pumpAndSettle();
      expect(scanner.calls, 0);
      await tester.ensureVisible(find.text('Find Wi-Fi names'));
      await tester.tap(find.text('Find Wi-Fi names'));
      await tester.pumpAndSettle();
      expect(scanner.calls, 1);
      expect(find.text('Real Home'), findsOneWidget);
      expect(
        find.textContaining('1 also reported by the watch'),
        findsOneWidget,
      );
      expect(client.writes, 0);
      await selectAndConfirm(tester);
      await tester.tap(save);
      await tester.pumpAndSettle();
      expect(client.writes, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );
  testWidgets('phone-only networks are visible but cannot be selected', (
    tester,
  ) async {
    final client = FakeWifiClient()
      ..unnamed = true
      ..phoneMatch = false;
    await tester.pumpWidget(
      screen(client, scanner: FakePhoneScanner(), scale: 1.5),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Find Wi-Fi names'));
    await tester.tap(find.text('Find Wi-Fi names'));
    await tester.pumpAndSettle();
    final row = find.widgetWithText(ListTile, 'Real Home');
    await tester.ensureVisible(row);
    expect(tester.widget<ListTile>(row).onTap, isNull);
    expect(
      find.textContaining('Waiting for the watch to report this network'),
      findsOneWidget,
    );
    await tester.ensureVisible(save);
    expect(tester.widget<FilledButton>(save).onPressed, isNull);
    expect(tester.takeException(), isNull);
    expect(client.writes, 0);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets(
    'permission and timeout errors stop the spinner and allow retry',
    (tester) async {
      for (final code in [
        'noLocationPermissionDenied',
        'noLocationServiceDisabled',
        'timeout',
      ]) {
        final scanner = FakePhoneScanner()..error = code;
        await tester.pumpWidget(screen(FakeWifiClient(), scanner: scanner));
        await tester.pumpAndSettle();
        await tester.ensureVisible(find.text('Find Wi-Fi names'));
        await tester.tap(find.text('Find Wi-Fi names'));
        await tester.pumpAndSettle();
        expect(find.text(phoneWifiMessage(code)), findsOneWidget);
        expect(find.byType(LinearProgressIndicator), findsNothing);
        expect(
          tester
              .widget<OutlinedButton>(
                find.widgetWithText(OutlinedButton, 'Find Wi-Fi names'),
              )
              .onPressed,
          isNotNull,
        );
        await tester.pumpWidget(const SizedBox());
      }
    },
  );
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
