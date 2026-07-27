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
    DeviceConnectivityPhase.live when device.hasFreshLocation => 'Satellite GPS',
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
