import '../models/alert.dart';
import '../models/device.dart';

String alertDisplayTitle(GuardianAlert alert, {Device? device}) {
  final storedTitle = alert.title?.trim();
  if (storedTitle != null && storedTitle.isNotEmpty) return storedTitle;

  final person = device?.displayName ?? 'Your loved one';
  return switch (alert.type.toLowerCase()) {
    'sos' => alert.message.isNotEmpty ? alert.message : 'SOS alert',
    'fall' => 'Possible fall detected',
    'geofence_exit' => 'Left safe zone',
    'geofence_enter' => 'Entered safe zone',
    'low_battery' => 'Pendant battery low',
    'offline' => "$person hasn't checked in",
    _ => alert.message.isNotEmpty ? alert.message : alert.type,
  };
}

String alertDisplayBody(GuardianAlert alert) {
  final message = alert.message.trim();
  if (message.isEmpty) return '';

  // Legacy gateway alerts stored technical inference as the message.
  if (_looksLikeLegacyOfflineMessage(message)) {
    return _humanizeLegacyOfflineMessage(message);
  }
  return message;
}

String alertDisplaySubtitle(
  GuardianAlert alert, {
  Device? device,
  DateTime? now,
}) {
  final clock = alert.createdAt != null
      ? _formatClock(alert.createdAt!.toLocal())
      : '—';
  final person = device?.displayName;
  if (person != null && person.isNotEmpty) {
    return '$person · $clock';
  }
  return clock;
}

String _formatClock(DateTime time) {
  final hour = time.hour % 12 == 0 ? 12 : time.hour % 12;
  final minute = time.minute.toString().padLeft(2, '0');
  final suffix = time.hour >= 12 ? 'PM' : 'AM';
  return '$hour:$minute $suffix';
}

bool _looksLikeLegacyOfflineMessage(String message) {
  final lower = message.toLowerCase();
  return lower.contains('heartbeat') ||
      lower.contains('device may be unreachable') ||
      RegExp(r'last at 20\d{2}-').hasMatch(lower);
}

String _humanizeLegacyOfflineMessage(String message) {
  final minutesMatch = RegExp(
    r'(?:No heartbeat for|No contact for)\s+(\d+)\s+minute',
    caseSensitive: false,
  ).firstMatch(message);
  final minutes = minutesMatch?.group(1);
  if (minutes != null) {
    return 'We have not heard from the pendant for $minutes minutes. '
        'The map may show an outdated last-known position until it reconnects.';
  }
  return 'Live tracking is paused. The map may show an outdated last-known position.';
}
