/// Server weather for an observed watch location. A fresh fetch or heartbeat
/// cannot make an old location or weather observation current.
class ProfileWeather {
  const ProfileWeather({
    required this.available,
    required this.condition,
    this.isDay,
    this.temperatureC,
    this.windKph,
    this.gustKph,
    this.placeName,
    this.locationObservedAt,
    this.observedAt,
    this.fetchedAt,
    this.expiresAt,
  });

  final bool available;
  final String condition;
  final bool? isDay;
  final double? temperatureC;
  final double? windKph;
  final double? gustKph;
  final String? placeName;
  final DateTime? locationObservedAt;
  final DateTime? observedAt;
  final DateTime? fetchedAt;
  final DateTime? expiresAt;

  static const maxAge = Duration(minutes: 60);
  static const futureTolerance = Duration(minutes: 1);
  static const conditions = {
    'clear',
    'partly_cloudy',
    'cloudy',
    'rain',
    'thunderstorm',
    'snow',
    'mist',
  };

  factory ProfileWeather.fromMap(Map<String, dynamic> map) {
    final condition = map['condition'];
    final place = map['placeName'];
    return ProfileWeather(
      available: map['schemaVersion'] == 1 && map['state'] == 'available',
      condition: condition is String && conditions.contains(condition)
          ? condition
          : 'unknown',
      isDay: map['isDay'] is bool ? map['isDay'] as bool : null,
      temperatureC: _number(map['temperatureC'], -100, 80),
      windKph: _number(map['windKph'], 0, 500),
      gustKph: _number(map['gustKph'], 0, 500),
      placeName: place is String && place.trim().isNotEmpty
          ? place.trim()
          : null,
      locationObservedAt: _time(map['locationObservedAt']),
      observedAt: _time(map['observedAt']),
      fetchedAt: _time(map['fetchedAt']),
      expiresAt: _time(map['expiresAt']),
    );
  }

  bool isAvailableAt(DateTime now) {
    if (!available ||
        !conditions.contains(condition) ||
        temperatureC == null ||
        locationObservedAt == null ||
        observedAt == null ||
        fetchedAt == null ||
        expiresAt == null ||
        !now.isBefore(expiresAt!)) {
      return false;
    }
    for (final at in [locationObservedAt!, observedAt!, fetchedAt!]) {
      if (now.difference(at) > maxAge ||
          at.difference(now) > futureTolerance) {
        return false;
      }
    }
    return expiresAt!.isAfter(fetchedAt!) &&
        !observedAt!.isAfter(fetchedAt!.add(futureTolerance));
  }

  bool locationIsLastKnownAt(DateTime now) =>
      locationObservedAt != null &&
      now.difference(locationObservedAt!) > const Duration(minutes: 8);

  String get conditionLabel => switch (condition) {
    'clear' => isDay == false ? 'Clear night' : 'Clear skies',
    'partly_cloudy' => 'Partly cloudy',
    'cloudy' => 'Cloudy',
    'rain' => 'Rain',
    'thunderstorm' => 'Thunderstorms',
    'snow' => 'Snow',
    'mist' => 'Mist',
    _ => 'Weather unavailable',
  };

  /// Equal 3x3 atlas cells. Wind supplements the reported condition rather
  /// than replacing rain or thunderstorms.
  int? get artworkIndex {
    if (condition == 'clear' || condition == 'partly_cloudy') {
      if (isDay == null) return null;
      if (isDay == false) return 6;
    }
    return switch (condition) {
      'clear' => 0,
      'partly_cloudy' => 1,
      'cloudy' => 2,
      'rain' => 3,
      'thunderstorm' => 4,
      'mist' => 7,
      'snow' => 8,
      _ => null,
    };
  }

  bool get windy => (windKph ?? 0) >= 30;

  static double? _number(Object? value, double minimum, double maximum) {
    if (value is! num || !value.isFinite) return null;
    final result = value.toDouble();
    return result >= minimum && result <= maximum ? result : null;
  }

  static DateTime? _time(Object? value) => value is String
      ? DateTime.tryParse(value)?.toUtc()
      : value is DateTime
      ? value.toUtc()
      : null;
}
