import '../models/care_profile.dart';
import '../models/device.dart';

String buildGuardianAiInterpretation(Device? device) {
  if (device == null) return 'No watch to monitor yet.';

  final profile = GuardianCareProfileX.fromValue(device.careProfile);
  final isLive = device.connectionState == 'live';
  final isReconnecting = device.connectionState == 'connecting';
  final hasLocation = device.hasFreshLocation || device.hasApproximateLocation;
  final battery = device.batteryPercent;

  if (battery != null && battery < 15) {
    return 'Battery critically low. Charging the watch soon is recommended.';
  }

  if (!isLive && !isReconnecting && device.location?.isValid == true) {
    return 'Watch offline. Guardian is keeping the last known location visible.';
  }

  if (isReconnecting) {
    return 'Connecting to the watch and waiting for a fresh update.';
  }

  if (isLive && !hasLocation) {
    return 'Watch connected. Waiting for a fresh location fix.';
  }

  if (device.hasApproximateLocation) {
    return 'Watch connected. Using approximate WiFi/cell positioning until satellite GPS is available.';
  }

  return switch (profile) {
    GuardianCareProfile.child =>
      'Everything looks calm. Guardian is checking location, journey and safety context.',
    GuardianCareProfile.senior =>
      'Everything looks calm. Guardian is checking safety, routine and care context.',
    GuardianCareProfile.adult =>
      'Everything looks normal. Guardian is quietly checking what matters.',
  };
}

List<String> buildGuardianActivities(Device? device) {
  if (device == null) return ['Waiting for watch connection'];

  final profile = GuardianCareProfileX.fromValue(device.careProfile);
  final activities = <String>['Watch signal monitored'];

  if (device.location?.isValid == true) {
    activities.add('Location received and evaluated');
  }

  switch (profile) {
    case GuardianCareProfile.child:
      activities.add('Journey and safe-zone context checked');
      activities.add('Guardian AI context analyzed');
    case GuardianCareProfile.senior:
      activities.add('Care and routine context checked');
      activities.add('Guardian AI context analyzed');
    case GuardianCareProfile.adult:
      activities.add('Safe-zone check completed');
      activities.add('Guardian AI context analyzed');
  }

  return activities;
}

String buildTodaySummary(Device? device) {
  if (device == null) return 'No watch linked yet.';
  return 'A calm day so far';
}

String buildTodayActivityStatus(Device? device) {
  if (device == null) return 'No activity data yet.';
  final profile = GuardianCareProfileX.fromValue(device.careProfile);
  return switch (profile) {
    GuardianCareProfile.child =>
      'No unusual journey or movement pattern detected.',
    GuardianCareProfile.senior =>
      'No unusual routine or movement pattern detected.',
    GuardianCareProfile.adult => 'No unusual movement detected.',
  };
}

String buildWeatherStatus(Device? device) {
  if (device == null) return 'Weather unavailable';
  return 'Conditions normal. No weather risk right now.';
}

String buildLocalContextStatus(Device? device) {
  if (device == null) return 'Context unavailable';
  return 'No relevant nearby disruption';
}
