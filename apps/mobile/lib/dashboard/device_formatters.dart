import '../models/device.dart';
import 'device_connectivity.dart';

String deviceMovementLabel(Device device) {
  return switch (device.connectivityPhase()) {
    DeviceConnectivityPhase.live when device.isMoving => 'Moving',
    DeviceConnectivityPhase.live => 'Stationary',
    DeviceConnectivityPhase.reconnecting => 'Linking up',
    DeviceConnectivityPhase.offline => 'Not connected',
  };
}

String deviceLocationStatusLabel(Device device) {
  return switch (device.connectivityPhase()) {
    DeviceConnectivityPhase.reconnecting => 'Last known location',
    DeviceConnectivityPhase.offline =>
      device.location?.isValid == true
          ? 'Last known location'
          : 'Location unavailable',
    DeviceConnectivityPhase.live when device.hasApproximateLocation =>
      'Approximate location',
    DeviceConnectivityPhase.live when device.hasFreshLocation =>
      'Satellite GPS',
    DeviceConnectivityPhase.live => 'Waiting for location',
  };
}

String deviceUpdatedLabel(Device device, {DateTime? now}) {
  final timestamp =
      device.location?.recordedAt ?? device.updatedAt ?? device.lastHeartbeatAt;
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
  final timestamp = device.location?.recordedAt;
  if (timestamp == null) return 'GPS fix time unavailable';
  return _freshnessLabel(
    timestamp,
    now: now,
    justNow: 'GPS updated just now',
    prefix: 'Last GPS fix',
  );
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
