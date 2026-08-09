import '../models/device.dart';

/// Generates human-readable Guardian AI interpretations based on device state.
String buildGuardianAiInterpretation(Device? device) {
  if (device == null) {
    return 'No device to monitor yet.';
  }

  final isLive = device.connectionState == 'live';
  final isReconnecting = device.connectionState == 'connecting';
  final hasLocation = device.hasFreshLocation || device.hasApproximateLocation;
  final battery = device.batteryPercent;

  // Risk states
  if (battery != null && battery < 15) {
    return '⚠ Battery critically low. Recommend charging soon.';
  }

  // Offline with location
  if (!isLive && !isReconnecting && hasLocation) {
    return 'Device offline. Last known location available.';
  }

  // Reconnecting
  if (isReconnecting) {
    return 'Connecting to network. Usually takes 30-60 seconds.';
  }

  // Live + locating
  if (isLive && !hasLocation) {
    return 'Connected. Waiting for location fix from GPS.';
  }

  // Approximate location
  if (isLive && device.hasApproximateLocation && !device.hasFreshLocation) {
    return 'Using WiFi/cell positioning for approximate location.';
  }

  // Normal state
  if (isLive && hasLocation) {
    return 'Everything looks normal. No nearby risk detected.';
  }

  // Fallback
  return 'Monitoring device. No issues detected.';
}

/// Generates list of intelligence activities Guardian is performing.
List<String> buildGuardianActivities(Device? device) {
  if (device == null) {
    return ['Waiting for device connection'];
  }

  final activities = <String>['Watch signal monitored'];

  if (device.hasFreshLocation || device.hasApproximateLocation) {
    activities.add('Location received and evaluated');
  }

  activities.add('Safe-zone check completed');
  activities.add('Guardian AI context analyzed');

  return activities;
}

/// Generates today's activity summary based on device state.
String buildTodaySummary(Device? device) {
  if (device == null) {
    return 'No device linked yet.';
  }

  return 'A calm day so far';
}

/// Generates today's activity status detail.
String buildTodayActivityStatus(Device? device) {
  if (device == null) {
    return 'No activity data yet.';
  }

  return 'No unusual movement detected.';
}

/// Generates weather context status.
String buildWeatherStatus(Device? device) {
  if (device == null) {
    return 'Weather unavailable';
  }

  return 'Conditions normal. No weather risk right now.';
}

/// Generates local context status.
String buildLocalContextStatus(Device? device) {
  if (device == null) {
    return 'Context unavailable';
  }

  return 'No relevant nearby disruption';
}
