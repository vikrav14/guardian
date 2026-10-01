import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:wifi_scan/wifi_scan.dart';

class PhoneWifiScanException implements Exception {
  const PhoneWifiScanException(this.code);
  final String code;
}

class PhoneWifiNetwork {
  const PhoneWifiNetwork({
    required this.bssid,
    required this.ssid,
    required this.frequency,
  });
  final String bssid;
  final String ssid;
  final int frequency;
  String get radioHint => bssid.substring(bssid.length - 5).toUpperCase();
  Map<String, dynamic> toJson() => {
    'bssid': bssid,
    'ssid': ssid,
    'frequency': frequency,
  };
}

abstract class PhoneWifiScanner {
  bool get supported;
  Future<List<PhoneWifiNetwork>> scan();
  void close();
}

/// Uses the maintained native scanner; never called by the Web build.
/// Android's result list is cached. Only entries whose boot timestamps advance
/// beyond the pre-scan cache may be used to label watch evidence.
class AndroidPhoneWifiScanner implements PhoneWifiScanner {
  AndroidPhoneWifiScanner({
    this.scanTimeout = const Duration(seconds: 20),
    this.permissionTimeout = const Duration(seconds: 45),
  });
  final Duration scanTimeout;
  final Duration permissionTimeout;
  StreamSubscription<List<WiFiAccessPoint>>? _subscription;
  Completer<List<WiFiAccessPoint>>? _pending;
  bool _closed = false;
  bool _busy = false;
  @override
  bool get supported =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  @override
  Future<List<PhoneWifiNetwork>> scan() async {
    if (!supported || _closed) {
      throw const PhoneWifiScanException('unsupported');
    }
    if (_busy) throw const PhoneWifiScanException('busy');
    _busy = true;
    try {
      final plugin = WiFiScan.instance;
      final canStart = await plugin
          .canStartScan(askPermissions: true)
          .timeout(permissionTimeout);
      if (_closed) throw const PhoneWifiScanException('cancelled');
      if (canStart != CanStartScan.yes) {
        throw PhoneWifiScanException(canStart.name);
      }
      final canRead = await plugin
          .canGetScannedResults(askPermissions: true)
          .timeout(permissionTimeout);
      if (_closed) throw const PhoneWifiScanException('cancelled');
      if (canRead != CanGetScannedResults.yes) {
        throw PhoneWifiScanException(canRead.name);
      }
      final before = await plugin.getScannedResults().timeout(scanTimeout);
      if (_closed) throw const PhoneWifiScanException('cancelled');
      final baseline = before.fold<int>(
        0,
        (latest, point) =>
            (point.timestamp ?? 0) > latest ? point.timestamp! : latest,
      );
      final result = Completer<List<WiFiAccessPoint>>();
      _pending = result;
      // Attach the bounded wait before starting the scan (including errors).
      final completed = result.future.timeout(scanTimeout);
      // Ensure a late platform error cannot become an unhandled async error
      // while startScan is still in flight.
      unawaited(
        completed.then<void>((_) {}, onError: (Object _, StackTrace _) {}),
      );
      _subscription = plugin.onScannedResultsAvailable.listen(
        (points) {
          final fresh = points
              .where((point) => (point.timestamp ?? 0) > baseline)
              .toList();
          if (fresh.isNotEmpty && !result.isCompleted) result.complete(fresh);
        },
        onError: (Object error, StackTrace stack) {
          if (!result.isCompleted) result.completeError(error, stack);
        },
      );
      if (!await plugin.startScan().timeout(scanTimeout)) {
        throw const PhoneWifiScanException('scan_rejected');
      }
      final points = await completed;
      if (_closed) throw const PhoneWifiScanException('cancelled');
      points.sort((a, b) => b.level.compareTo(a.level));
      final networks = <String, PhoneWifiNetwork>{};
      for (final point in points) {
        final id = point.bssid.toLowerCase();
        if (!RegExp(r'^([0-9a-f]{2}:){5}[0-9a-f]{2}$').hasMatch(id) ||
            id == '00:00:00:00:00:00' ||
            id == '02:00:00:00:00:00' ||
            int.parse(id.substring(0, 2), radix: 16).isOdd ||
            point.frequency < 2400 ||
            point.frequency > 2500 ||
            utf8.encode(point.ssid).length > 32) {
          continue;
        }
        final name = point.ssid
            .replaceAll(
              RegExp(r'[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]'),
              '',
            )
            .trim();
        if (name.isEmpty || name == '<unknown ssid>') continue;
        networks.putIfAbsent(
          id,
          () => PhoneWifiNetwork(
            bssid: id,
            ssid: name,
            frequency: point.frequency,
          ),
        );
        if (networks.length == 32) break;
      }
      return networks.values.toList(growable: false);
    } on TimeoutException {
      throw const PhoneWifiScanException('timeout');
    } on PhoneWifiScanException {
      rethrow;
    } catch (_) {
      // Never put native exception text, SSIDs or identifiers into diagnostics.
      throw const PhoneWifiScanException('unavailable');
    } finally {
      if (_pending != null && !_pending!.isCompleted) {
        _pending!.complete(const []);
      }
      _pending = null;
      await _subscription?.cancel();
      _subscription = null;
      _busy = false;
    }
  }

  @override
  void close() {
    _closed = true;
    if (_pending != null && !_pending!.isCompleted) {
      _pending!.complete(const []);
    }
    unawaited(_subscription?.cancel());
  }
}
