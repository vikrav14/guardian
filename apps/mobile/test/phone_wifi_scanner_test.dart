import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/phone_wifi_scanner.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const methods = MethodChannel('wifi_scan');
  const events = MethodChannel('wifi_scan/onScannedResultsAvailable');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  Map<String, Object> point(
    String bssid,
    String ssid,
    int timestamp, {
    int frequency = 2412,
  }) => {
    'bssid': bssid,
    'ssid': ssid,
    'timestamp': timestamp,
    'frequency': frequency,
    'capabilities': '',
    'level': -40,
  };
  Future<void> emit(List<Map<String, Object>> points) async {
    await messenger.handlePlatformMessage(
      events.name,
      const StandardMethodCodec().encodeSuccessEnvelope(points),
      (_) {},
    );
  }

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    messenger.setMockMethodCallHandler(events, (_) async => null);
  });
  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
    messenger.setMockMethodCallHandler(methods, null);
    messenger.setMockMethodCallHandler(events, null);
  });
  test(
    'native scan ignores cached entries, 5 GHz, hidden names and invalid radios',
    () async {
      final old = point('02:00:00:00:00:01', 'Old name', 100);
      messenger.setMockMethodCallHandler(methods, (call) async {
        switch (call.method) {
          case 'canStartScan':
          case 'canGetScannedResults':
            return 1;
          case 'getScannedResults':
            return [old];
          case 'startScan':
            scheduleMicrotask(() => emit([old]));
            Timer(
              const Duration(milliseconds: 10),
              () => emit([
                old,
                point('02:00:00:00:00:02', 'Home', 200),
                point('02:00:00:00:00:03', 'Home', 200),
                point('02:00:00:00:00:04', 'Home 5G', 200, frequency: 5180),
                point('02:00:00:00:00:05', '', 200),
                point('ff:ff:ff:ff:ff:ff', 'Invalid', 200),
                point('02:00:00:00:00:06', 'x' * 33, 200),
              ]),
            );
            return true;
        }
        return null;
      });
      final scanner = AndroidPhoneWifiScanner();
      addTearDown(scanner.close);
      final results = await scanner.scan();
      expect(results.map((r) => r.ssid), ['Home', 'Home']);
      expect(results.map((r) => r.bssid).toSet().length, 2);
    },
  );
  test('permission refusal never starts a native scan', () async {
    final calls = <String>[];
    messenger.setMockMethodCallHandler(methods, (call) async {
      calls.add(call.method);
      return 3;
    });
    final scanner = AndroidPhoneWifiScanner();
    addTearDown(scanner.close);
    await expectLater(
      scanner.scan(),
      throwsA(
        isA<PhoneWifiScanException>().having(
          (e) => e.code,
          'code',
          'noLocationPermissionDenied',
        ),
      ),
    );
    expect(calls, ['canStartScan']);
  });
  test(
    'stale-only results time out and release the event subscription',
    () async {
      var cancelled = false;
      messenger.setMockMethodCallHandler(events, (call) async {
        if (call.method == 'cancel') cancelled = true;
        return null;
      });
      final old = point('02:00:00:00:00:01', 'Old', 100);
      messenger.setMockMethodCallHandler(methods, (call) async {
        switch (call.method) {
          case 'canStartScan':
          case 'canGetScannedResults':
            return 1;
          case 'getScannedResults':
            return [old];
          case 'startScan':
            scheduleMicrotask(() => emit([old]));
            return true;
        }
        return null;
      });
      final scanner = AndroidPhoneWifiScanner(
        scanTimeout: const Duration(milliseconds: 40),
      );
      addTearDown(scanner.close);
      await expectLater(
        scanner.scan(),
        throwsA(
          isA<PhoneWifiScanException>().having(
            (e) => e.code,
            'code',
            'timeout',
          ),
        ),
      );
      expect(cancelled, isTrue);
    },
  );
  test('unsupported platform never touches native channels', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    var called = false;
    messenger.setMockMethodCallHandler(methods, (_) async {
      called = true;
      return null;
    });
    final scanner = AndroidPhoneWifiScanner();
    expect(scanner.supported, isFalse);
    await expectLater(scanner.scan(), throwsA(isA<PhoneWifiScanException>()));
    expect(called, isFalse);
    scanner.close();
  });
}
