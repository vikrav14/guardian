import '../models/device.dart';
import 'device_connectivity.dart';

/// Mirrors the maximum age used for a truthful live connection indicator.
const Duration deviceTelemetryFreshness = deviceLiveContactThreshold;

String deviceMovementLabel(Device device) {
  return switch (device.connectivityPhase()) {
    DeviceConnectivityPhase.live when device.isMoving => 'Moving',
    DeviceConnectivityPhase.live => 'Stationary',
    DeviceConnectivityPhase.reconnecting => 'Linking up',
    DeviceConnectivityPhase.offline => 'Not connected',
  };
}

String deviceLocationStatusLabel(Device device) {
  if (device.hasHomeWifiDisplay) return 'Home Wi-Fi detected';
  // Location provenance is independent of watch connectivity. Keep the source
  // label truthful even when the watch is reconnecting or offline; connection
  // state is already shown separately by the watch status controls.
  if (device.isDisplayingRetainedSatelliteLocation) {
    return 'Last satellite fix';
  }

  final source = device.displayLocationSource;
  if (source == 'wifi' || source == 'lbs') {
    return 'Approximate location';
  }
  if (source == 'gps') {
    return device.connectivityPhase() == DeviceConnectivityPhase.live &&
            device.hasFreshLocation
        ? 'Satellite GPS'
        : 'Last satellite fix';
  }
  if (device.displayLocation?.isValid == true) return 'Last known location';

  return device.connectivityPhase() == DeviceConnectivityPhase.offline
      ? 'Location unavailable'
      : 'Waiting for location';
}

String deviceGpsChipLabel(Device device) {
  if (device.hasHomeWifiDisplay) return 'Home Wi-Fi';
  final base = device.isDisplayingRetainedSatelliteLocation
      ? 'Last GPS fix'
      : device.hasApproximateLocation
      ? 'Approx.'
      : device.hasFreshLocation
      ? 'GPS'
      : device.displayLocation?.isValid == true
      ? 'Last GPS fix'
      : 'Locating';
  final satellites = device.displayLocationSource == 'gps'
      ? device.displayLocation?.satellites
      : null;
  if (satellites == null) return base;
  return base == 'Last GPS fix'
      ? 'Last GPS · $satellites sat'
      : '$base · $satellites sat';
}

String deviceCellularSignalLabel(Device device, {DateTime? now}) {
  final current = now ?? DateTime.now();
  final contactAt = device.lastHeartbeatAt ?? device.updatedAt;
  if (!device.online || contactAt == null) return 'No signal';
  final contactAge = current.difference(contactAt);
  if (contactAge > deviceLiveContactThreshold ||
      contactAge < const Duration(minutes: -1)) {
    return 'No signal';
  }

  final signal = device.cellularSignalPercent;
  final signalAt = device.cellularSignalUpdatedAt;
  if (signal == null || signalAt == null) return 'Signal —';
  final signalAge = current.difference(signalAt);
  if (signalAge > deviceTelemetryFreshness ||
      signalAge < const Duration(minutes: -1)) {
    return 'Signal —';
  }
  return 'Signal $signal%';
}

String deviceUpdatedLabel(Device device, {DateTime? now}) {
  if (device.homeWifiLocationAt(now ?? DateTime.now()) != null) {
    return deviceHomeWifiFixLabel(device, now: now);
  }
  final timestamp =
      device.displayLocation?.recordedAt ??
      device.updatedAt ??
      device.lastHeartbeatAt;
  if (timestamp == null) return 'Update time unavailable';
  final age = (now ?? DateTime.now()).difference(timestamp);
  if (age.inSeconds < 10) return 'Updated now';
  if (age.inMinutes < 1) return 'Updated ${age.inSeconds}s ago';
  if (age.inHours < 1) return 'Updated ${age.inMinutes}m ago';
  return 'Updated ${age.inHours}h ago';
}

String deviceWatchCheckInLabel(Device device, {DateTime? now}) {
  final timestamp = device.lastHeartbeatAt ?? device.updatedAt;
  if (timestamp == null) return 'Watch check-in time unavailable';
  return _freshnessLabel(
    timestamp,
    now: now,
    justNow: 'Watch checked in just now',
    prefix: 'Watch checked in',
  );
}

String deviceLocationFixLabel(Device device, {DateTime? now}) {
  if (device.homeWifiLocationAt(now ?? DateTime.now()) != null) {
    return deviceHomeWifiFixLabel(device, now: now);
  }
  final timestamp = device.displayLocation?.recordedAt;
  if (timestamp == null) return 'Location time unavailable';
  if (device.isDisplayingRetainedSatelliteLocation) {
    return _freshnessLabel(
      timestamp,
      now: now,
      justNow: 'Last satellite fix was just now',
      prefix: 'Last satellite fix',
    );
  }
  if (device.displayLocationSource == 'wifi' ||
      device.displayLocationSource == 'lbs') {
    return _freshnessLabel(
      timestamp,
      now: now,
      justNow: 'Approximate network location updated just now',
      prefix: 'Approximate network location updated',
    );
  }
  if (device.displayLocationSource != 'gps') {
    return _freshnessLabel(
      timestamp,
      now: now,
      justNow: 'Location recorded just now',
      prefix: 'Location recorded',
    );
  }
  return _freshnessLabel(
    timestamp,
    now: now,
    justNow: 'Satellite GPS updated just now',
    prefix: 'Satellite GPS updated',
  );
}

String deviceMapLocationStatusLabel(Device device) {
  if (device.hasHomeWifiDisplay) return 'Home Wi-Fi detected';
  if (device.isMapDisplayingLastSatelliteLocation) return 'Last reliable fix';
  return deviceLocationStatusLabel(device);
}

String deviceMapLocationFixLabel(Device device, {DateTime? now}) {
  if (device.homeWifiLocationAt(now ?? DateTime.now()) != null) {
    return deviceHomeWifiFixLabel(device, now: now);
  }
  if (!device.isMapDisplayingLastSatelliteLocation) {
    return deviceLocationFixLabel(device, now: now);
  }
  final timestamp = device.mapDisplayLocation?.recordedAt;
  if (timestamp == null) return 'Reliable location time unavailable';
  return _freshnessLabel(
    timestamp,
    now: now,
    justNow: 'Last reliable GPS fix was just now',
    prefix: 'Last reliable GPS fix',
  );
}

String deviceHomeWifiFixLabel(Device device, {DateTime? now}) {
  final current = now ?? DateTime.now();
  final home = device.homeWifiLocationAt(current);
  if (home?.recordedAt == null) return 'Home Wi-Fi evidence expired';
  return _freshnessLabel(home!.recordedAt!, now: current,
    justNow: 'Home Wi-Fi detected just now', prefix: 'Home Wi-Fi detected');
}

String deviceRetainedGpsLabel(Device device, {DateTime? now}) {
  final at = device.lastSatelliteLocation?.recordedAt;
  if (at == null) return 'No retained GPS fix';
  return _freshnessLabel(at, now: now,
    justNow: 'Last GPS fix recorded just now', prefix: 'Last GPS fix');
}

String _freshnessLabel(
  DateTime timestamp, {
  required String justNow,
  required String prefix,
  DateTime? now,
}) {
  final age = (now ?? DateTime.now()).difference(timestamp);
  if (age.isNegative || age.inMinutes < 1) return justNow;
  if (age.inMinutes < 60) return '$prefix ${age.inMinutes}m ago';
  if (age.inHours < 24) return '$prefix ${age.inHours}h ago';
  return '$prefix ${age.inDays}d ago';
}
