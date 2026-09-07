import '../models/care_profile.dart';
import '../models/device.dart';
import 'device_connectivity.dart';
import 'device_formatters.dart';

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

  if (device.hasHomeWifiDisplay) {
    return '${deviceHomeWifiFixLabel(device)}. The watch is at or near your saved Home location. '
        '${deviceRetainedGpsLabel(device)}; satellite evidence stays separate.';
  }

  if (!isLive && !isReconnecting && device.displayLocation?.isValid == true) {
    return 'Watch offline. Guardian is keeping the last known location visible.';
  }

  if (isReconnecting) {
    return 'Connecting to the watch and waiting for a fresh update.';
  }

  if (device.isDisplayingRetainedSatelliteLocation) {
    return 'Watch connected. Precise GPS is unavailable indoors, so Guardian is keeping the last satellite fix visible and retaining the newer approximate network observation separately.';
  }

  if (isLive && !hasLocation) {
    return 'Watch connected. Waiting for a fresh location fix.';
  }

  if (device.hasApproximateLocation) {
    return 'Watch connected. Using approximate WiFi/cell positioning until satellite GPS is available.';
  }

  return switch (profile) {
    GuardianCareProfile.child =>
      'Watch connected with a recent location. Guardian can explain recorded journey and safe-zone facts.',
    GuardianCareProfile.senior =>
      'Watch connected with a recent location. Guardian can explain available safety and care facts.',
    GuardianCareProfile.adult =>
      'Watch connected with a recent location. Guardian can explain available watch facts.',
  };
}

List<String> buildGuardianActivities(Device? device) {
  if (device == null) return ['Waiting for watch connection'];

  final activities = <String>['Watch signal monitored'];

  if (device.hasHomeWifiDisplay) activities.add('Home Wi-Fi detected');

  if (device.displayLocation?.isValid == true) {
    activities.add('Location received');
  }
  if (device.intelligence?.topInsight != null) {
    activities.add('Rule-based insight available');
  }

  return activities;
}

String buildTodaySummary(Device? device) {
  if (device == null) return 'No watch linked yet.';
  if (device.hasHomeWifiDisplay) return deviceHomeWifiFixLabel(device);
  if (device.isTrulyOffline) return 'Watch offline';
  if (device.hasFreshLocation || device.hasApproximateLocation) {
    return 'Watch connected with a recent location update';
  }
  return 'Waiting for today\'s location activity';
}

String buildTodayActivityStatus(Device? device) {
  if (device == null) return 'No activity data yet.';
  return 'Open journeys to review recorded movement. Guardian does not infer a routine when data is missing.';
}
