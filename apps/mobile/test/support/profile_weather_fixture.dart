final weatherTestNow = DateTime.utc(2026, 9, 17, 12);

Map<String, dynamic> weatherTestData({
  DateTime? now,
  String condition = 'partly_cloudy',
}) {
  final clock = now ?? weatherTestNow;
  return {
    'schemaVersion': 1,
    'state': 'available',
    'condition': condition,
    'isDay': true,
    'temperatureC': 24.5,
    'windKph': 18.0,
    'gustKph': 25.0,
    'placeName': 'Lower Vale',
    'locationObservedAt': clock.subtract(const Duration(minutes: 3)).toIso8601String(),
    'observedAt': clock.subtract(const Duration(minutes: 8)).toIso8601String(),
    'fetchedAt': clock.subtract(const Duration(minutes: 1)).toIso8601String(),
    'expiresAt': clock.add(const Duration(minutes: 9)).toIso8601String(),
  };
}

