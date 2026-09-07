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
    DateTime Function()? now,
  }) : _deviceService = deviceService ?? DeviceService(),
       _geofenceService = geofenceService ?? GeofenceService(),
       _now = now ?? DateTime.now;

  final DeviceService _deviceService;
  final GeofenceService _geofenceService;
  final DateTime Function() _now;
  Timer? _homeExpiryTimer;
  String _homeState = '';

  String _homeFingerprint() => devices
      .where((device) => device.homeWifiLocationAt(_now()) != null)
      .map((device) => device.imei).join('|');

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

  void start() {
    // Expire the presentation even if the gateway stops and Firestore is quiet.
    // Only a Home validity change notifies the map; no per-second camera moves.
    _homeExpiryTimer ??= Timer.periodic(const Duration(seconds: 1), (_) {
      final state = _homeFingerprint();
      if (state == _homeState) return;
      _homeState = state;
      notifyListeners();
    });
    _deviceSubscription ??= _deviceService.watchLinkedDevices().listen(
      (nextDevices) {
        devices = nextDevices;
        _homeState = _homeFingerprint();
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
        loading = false;
        error = nextError;
        notifyListeners();
      },
    );
    _geofenceSubscription ??= _geofenceService.watchAll().listen(
      (zones) {
        geofences = zones;
        notifyListeners();
      },
      onError: (Object error) {
        if (kDebugMode) {
          debugPrint('Geofence stream error: $error');
        }
      },
    );
  }

  void select(String imei) {
    if (selectedImei == imei) return;
    selectedImei = imei;
    notifyListeners();
  }

  @override
  void dispose() {
    _homeExpiryTimer?.cancel();
    _deviceSubscription?.cancel();
    _geofenceSubscription?.cancel();
    super.dispose();
  }
}
