import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import 'device_connectivity.dart';

class DashboardController extends ChangeNotifier {
  DashboardController({
    DeviceService? deviceService,
    GeofenceService? geofenceService,
  }) : _deviceService = deviceService ?? DeviceService(),
       _geofenceService = geofenceService ?? GeofenceService();

  final DeviceService _deviceService;
  final GeofenceService _geofenceService;

  StreamSubscription<List<Device>>? _deviceSubscription;
  StreamSubscription<List<Geofence>>? _geofenceSubscription;

  List<Device> devices = const [];
  List<Geofence> geofences = const [];
  String? selectedImei;
  Object? error;
  bool loading = true;

  Device? get selected {
    if (devices.isEmpty) return null;
    return devices.firstWhere(
      (device) => device.imei == selectedImei,
      orElse: () => devices.first,
    );
  }

  DeviceConnectivityPhase connectivityPhase(Device device, {DateTime? now}) =>
      device.connectivityPhase(now: now);

  bool isReconnecting(Device device, {DateTime? now}) =>
      connectivityPhase(device, now: now) ==
      DeviceConnectivityPhase.reconnecting;

  bool isLive(Device device, {DateTime? now}) =>
      connectivityPhase(device, now: now) == DeviceConnectivityPhase.live;

  /// Diagnostic flags to isolate Firestore listener errors.
  /// Set to false to skip that listener during diagnostics.
  /// Start with only user listener, then enable device, then geofence one at a time.
  static const enableUserListener = true;
  static const enableDeviceListener = false; // DIAGNOSTIC: disabled for isolation
  static const enableGeofenceListener = false; // DIAGNOSTIC: disabled for isolation

  void start() {
    if (kDebugMode) {
      debugPrint('[DashboardController.start]');
      debugPrint('  userListener: $enableUserListener');
      debugPrint('  deviceListener: $enableDeviceListener');
      debugPrint('  geofenceListener: $enableGeofenceListener');
    }

    if (enableDeviceListener) {
      _deviceSubscription ??= _deviceService.watchLinkedDevices().listen(
        (nextDevices) {
          if (kDebugMode) {
            debugPrint('[watchLinkedDevices] Received ${nextDevices.length} devices');
            for (final d in nextDevices) {
              debugPrint('  - ${d.imei}: ${d.displayName}');
            }
          }
          devices = nextDevices;
          loading = false;
          error = null;
          if (selectedImei == null && nextDevices.isNotEmpty) {
            selectedImei = nextDevices.first.imei;
          } else if (nextDevices.every((device) => device.imei != selectedImei)) {
            selectedImei = nextDevices.isEmpty ? null : nextDevices.first.imei;
          }
          notifyListeners();
        },
        onError: (Object nextError) {
          if (kDebugMode) {
            debugPrint('[watchLinkedDevices] ERROR: $nextError');
          }
          loading = false;
          error = nextError;
          notifyListeners();
        },
      );
    } else if (kDebugMode) {
      debugPrint('[DashboardController] Device listener disabled (diagnostic)');
    }

    if (enableGeofenceListener) {
      _geofenceSubscription ??= _geofenceService.watchAll().listen(
        (zones) {
          if (kDebugMode) {
            debugPrint('[watchAll geofences] Received ${zones.length} geofences');
          }
          geofences = zones;
          notifyListeners();
        },
        onError: (Object error) {
          if (kDebugMode) {
            debugPrint('[watchAll geofences] ERROR: $error');
          }
        },
      );
    } else if (kDebugMode) {
      debugPrint('[DashboardController] Geofence listener disabled (diagnostic)');
    }
  }

  void select(String imei) {
    if (selectedImei == imei) return;
    selectedImei = imei;
    notifyListeners();
  }

  @override
  void dispose() {
    _deviceSubscription?.cancel();
    _geofenceSubscription?.cancel();
    super.dispose();
  }
}
