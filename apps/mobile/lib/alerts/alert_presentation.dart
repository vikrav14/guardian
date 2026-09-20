import 'package:intl/intl.dart';

import '../models/alert.dart';

enum AlertCategory {
  all('All'),
  safety('Safety'),
  device('Device'),
  places('Places');

  const AlertCategory(this.label);
  final String label;

  bool includes(GuardianAlert alert) {
    final type = alert.type.toLowerCase();
    return switch (this) {
      all => true,
      safety =>
        const {
              'sos',
              'fall',
              'watch_removed',
              'bracelet_removed',
            }.contains(type) ||
            alert.severity.toLowerCase() == 'critical',
      device => const {'low_battery', 'offline', 'online'}.contains(type),
      places => type.startsWith('geofence_'),
    };
  }
}

String alertDateGroup(DateTime? value, DateTime now) {
  if (value == null) return 'Time unavailable';
  final local = value.toLocal();
  final today = now.toLocal();
  final day = DateTime(local.year, local.month, local.day);
  final currentDay = DateTime(today.year, today.month, today.day);
  if (day == currentDay) return 'Today';
  final previousDay = DateTime(today.year, today.month, today.day - 1);
  if (day == previousDay) return 'Yesterday';
  return DateFormat('d MMM yyyy').format(local);
}

String alertRecordedTime(DateTime? value) => value == null
    ? 'Recording time unavailable'
    : DateFormat('d MMM yyyy · HH:mm').format(value.toLocal());

String sosReceiptAge(int? seconds) {
  if (seconds == null) return 'Recording time unavailable';
  if (seconds < 60) return 'Less than 1 min before SOS receipt';
  if (seconds < 3600) return '${seconds ~/ 60} min before SOS receipt';
  if (seconds < 86400) {
    return '${seconds ~/ 3600}h ${(seconds % 3600) ~/ 60}m before SOS receipt';
  }
  return '${seconds ~/ 86400}d ${(seconds % 86400) ~/ 3600}h before SOS receipt';
}
