import '../models/device.dart';

/// How long a gateway `connecting` handshake stays valid in Firestore.
const deviceConnectingGrace = Duration(minutes: 3);

enum DeviceConnectivityPhase { live, reconnecting, offline }

bool deviceIsInActiveReconnect(Device device, {DateTime? now}) {
  final started = device.connectingAt;
  if (started == null) return false;
  return (now ?? DateTime.now()).difference(started) <= deviceConnectingGrace;
}

bool deviceIsHandshaking(Device device, {DateTime? now}) {
  if (device.connectionState != 'connecting') return false;
  final started = device.connectingAt ?? device.updatedAt;
  if (started == null) return false;
  return (now ?? DateTime.now()).difference(started) <= deviceConnectingGrace;
}

/// Heartbeat from the current TCP session — not a stale one from before power-off.
bool deviceHasSessionHeartbeat(Device device) {
  final connectingAt = device.connectingAt;
  final heartbeat = device.lastHeartbeatAt ?? device.updatedAt;
  if (heartbeat == null) return false;

  final disconnectedAt = device.disconnectedAt;
  if (disconnectedAt != null && heartbeat.isBefore(disconnectedAt)) {
    return false;
  }

  if (connectingAt == null) return true;
  return !heartbeat.isBefore(connectingAt);
}

/// Fully online: gateway says live, recent contact, and network session is established.
bool deviceIsFullyLive(Device device, {DateTime? now}) {
  if (!device.isLiveConnected) return false;
  if (device.connectionState != 'live') return false;
  if (!deviceHasSessionHeartbeat(device)) return false;
  return true;
}

bool deviceIsLinkingUp(Device device, {DateTime? now}) {
  if (deviceIsFullyLive(device, now: now)) return false;
  if (deviceIsHandshaking(device, now: now)) return true;
  if (!deviceIsInActiveReconnect(device, now: now)) return false;
  // Mid power-on: ignore brief offline writes between TCP attempts.
  if (!deviceHasSessionHeartbeat(device)) return true;
  return device.connectionState == 'offline' && device.online == false;
}

bool deviceIsTransientOfflineFlap(Device device) {
  if (deviceIsFullyLive(device)) return false;
  if (!device.hasRecentContact) return false;
  return device.connectionState == 'offline' || device.online == false;
}

DeviceConnectivityPhase deviceConnectivityPhase(
  Device device, {
  DateTime? now,
}) {
  if (deviceIsFullyLive(device, now: now)) {
    return DeviceConnectivityPhase.live;
  }
  if (deviceIsLinkingUp(device, now: now)) {
    return DeviceConnectivityPhase.reconnecting;
  }
  if (deviceIsTransientOfflineFlap(device)) {
    return DeviceConnectivityPhase.reconnecting;
  }
  if (device.connectionState == 'offline' ||
      (device.online == false && !deviceIsHandshaking(device, now: now))) {
    return DeviceConnectivityPhase.offline;
  }
  if (device.online == true && !device.hasRecentContact) {
    if (device.connectionState == 'live' && !deviceHasSessionHeartbeat(device)) {
      return DeviceConnectivityPhase.reconnecting;
    }
    return DeviceConnectivityPhase.offline;
  }
  if (device.online == true || device.connectionState == 'connecting') {
    return DeviceConnectivityPhase.reconnecting;
  }
  return DeviceConnectivityPhase.offline;
}

extension DeviceConnectivityX on Device {
  DeviceConnectivityPhase connectivityPhase({DateTime? now}) =>
      deviceConnectivityPhase(this, now: now);

  bool get isReconnecting =>
      connectivityPhase() == DeviceConnectivityPhase.reconnecting;

  bool get isTrulyOffline =>
      connectivityPhase() == DeviceConnectivityPhase.offline;
}

String deviceConnectivityLabel(Device device, {DateTime? now}) {
  return switch (device.connectivityPhase(now: now)) {
    DeviceConnectivityPhase.live => 'Live',
    DeviceConnectivityPhase.reconnecting => 'Linking up',
    DeviceConnectivityPhase.offline => 'Offline',
  };
}

String deviceConnectivityDetail(Device device, {DateTime? now}) {
  return switch (device.connectivityPhase(now: now)) {
    DeviceConnectivityPhase.live => 'Connected',
    DeviceConnectivityPhase.reconnecting =>
      'Connecting to the pendant — waiting for network',
    DeviceConnectivityPhase.offline => 'Pendant is off or out of coverage',
  };
}

String deviceSignalLabel(Device device, {DateTime? now}) {
  return switch (device.connectivityPhase(now: now)) {
    DeviceConnectivityPhase.live => 'Connected',
    DeviceConnectivityPhase.reconnecting => 'Handshaking',
    DeviceConnectivityPhase.offline => 'No signal',
  };
}

enum DashboardSafetyMood { empty, allClear, linkingUp, allOffline, needsAttention }

DashboardSafetyMood dashboardSafetyMood(List<Device> devices, {DateTime? now}) {
  if (devices.isEmpty) return DashboardSafetyMood.empty;

  final phases = devices.map((d) => d.connectivityPhase(now: now)).toList();
  if (phases.every((p) => p == DeviceConnectivityPhase.live)) {
    return DashboardSafetyMood.allClear;
  }
  if (phases.any((p) => p == DeviceConnectivityPhase.reconnecting)) {
    return DashboardSafetyMood.linkingUp;
  }
  if (phases.every((p) => p == DeviceConnectivityPhase.offline)) {
    return DashboardSafetyMood.allOffline;
  }
  return DashboardSafetyMood.needsAttention;
}

String dashboardSafetyTitle(List<Device> devices, {DateTime? now}) {
  final mood = dashboardSafetyMood(devices, now: now);
  if (mood == DashboardSafetyMood.linkingUp && devices.length == 1) {
    return 'Linking up with ${devices.first.displayName}…';
  }
  if (mood == DashboardSafetyMood.allOffline && devices.length == 1) {
    return '${devices.first.displayName} is offline';
  }
  return switch (mood) {
    DashboardSafetyMood.empty => 'Let’s connect someone you care about',
    DashboardSafetyMood.allClear => 'Everyone you care about is safe',
    DashboardSafetyMood.linkingUp => 'Linking up with your family',
    DashboardSafetyMood.allOffline => 'Devices are offline',
    DashboardSafetyMood.needsAttention => 'A device needs your attention',
  };
}

String dashboardSafetySubtitle(List<Device> devices, {DateTime? now}) {
  final clock = now ?? DateTime.now();
  final online = devices
      .where((d) => d.connectivityPhase(now: clock) == DeviceConnectivityPhase.live)
      .length;
  final linking = devices
      .where(
        (d) =>
            d.connectivityPhase(now: clock) == DeviceConnectivityPhase.reconnecting,
      )
      .length;
  final offline = devices
      .where((d) => d.connectivityPhase(now: clock) == DeviceConnectivityPhase.offline)
      .length;

  if (devices.isEmpty) return 'No linked devices';
  if (linking > 0) {
    return '$online online  •  $linking linking up';
  }
  if (offline > 0 && online == 0) {
    return '$offline offline';
  }
  return '$online online  •  $offline away';
}
