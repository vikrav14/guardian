import '../models/device.dart';

String deviceMovementLabel(Device device) {
  if (!device.online) return 'Not connected';
  if (device.isMoving) return 'Moving';
  return 'Stationary';
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
