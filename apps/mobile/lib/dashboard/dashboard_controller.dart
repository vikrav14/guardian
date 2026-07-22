import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';

class DashboardController extends ChangeNotifier {
  DashboardController({
    DeviceService? deviceService,
    GeofenceService? geofenceService,
  })  : _deviceService = deviceService ?? DeviceService(),
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

  void start() {
    _deviceSubscription ??= _deviceService.watchLinkedDevices().listen(
      (nextDevices) {
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
        loading = false;
        error = nextError;
        notifyListeners();
      },
    );
    _geofenceSubscription ??= _geofenceService.watchAll().listen((zones) {
      geofences = zones;
      notifyListeners();
    });
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
