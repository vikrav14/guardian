import 'package:cloud_firestore/cloud_firestore.dart';

enum WellbeingMetricSet { spo2, heartRateBloodPressure, skinTemperature }

class WellbeingReading {
  const WellbeingReading({
    required this.id,
    required this.metricSet,
    required this.observedAt,
    required this.quality,
    required this.displayable,
    this.spo2Percent,
    this.heartRateBpm,
    this.systolicMmHg,
    this.diastolicMmHg,
    this.skinTemperatureCelsius,
  });

  final String id;
  final WellbeingMetricSet metricSet;
  final DateTime observedAt;
  final String quality;
  final bool displayable;
  final int? spo2Percent;
  final int? heartRateBpm;
  final int? systolicMmHg;
  final int? diastolicMmHg;
  final double? skinTemperatureCelsius;

  String get measurementLabel => switch (metricSet) {
    WellbeingMetricSet.spo2 => '$spo2Percent% oxygen estimate',
    WellbeingMetricSet.heartRateBloodPressure =>
      '$heartRateBpm bpm · $systolicMmHg/$diastolicMmHg mmHg',
    WellbeingMetricSet.skinTemperature =>
      '${skinTemperatureCelsius?.toStringAsFixed(2)} °C skin temperature estimate',
  };

  factory WellbeingReading.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) => WellbeingReading.fromMap(
    doc.data() ?? <String, dynamic>{},
    id: doc.id,
  );

  factory WellbeingReading.fromMap(
    Map<String, dynamic> data, {
    required String id,
  }) {
    final metric = switch (data['metricSet']) {
      'spo2' => WellbeingMetricSet.spo2,
      'heart_rate_blood_pressure' => WellbeingMetricSet.heartRateBloodPressure,
      'skin_temperature' => WellbeingMetricSet.skinTemperature,
      _ => throw StateError('Unsupported wellbeing metric'),
    };
    final values = data['values'] is Map
        ? Map<String, dynamic>.from(data['values'] as Map)
        : const <String, dynamic>{};
    final observedAt = _asDateTime(data['observedAt']);
    if (observedAt == null) {
      throw StateError('Missing wellbeing receipt time');
    }
    final displayable = data['displayable'] == true;
    final quality = (data['quality'] as String?)?.trim() ?? 'unknown';
    final legacyEstimate = !displayable &&
        quality == 'transport_valid_unverified';
    final temperature = metric == WellbeingMetricSet.skinTemperature;
    final temperatureValue = values['skinTemperatureCelsius'];
    if (temperature &&
        (data['sourceCommand'] != 'btemp2' || data['sourceVariant'] != '1' ||
            temperatureValue is! num || !temperatureValue.isFinite ||
            temperatureValue <= 0 || temperatureValue > 60 ||
            (temperatureValue * 100 - (temperatureValue * 100).round()).abs() > 0.000001)) {
      throw StateError('Unsupported temperature evidence');
    }
    bool inRange(String key, int min, int max) =>
        values[key] is int &&
        (values[key] as int) >= min &&
        (values[key] as int) <= max;
    if (!temperature &&
        !(metric == WellbeingMetricSet.spo2
            ? inRange('spo2Percent', 1, 100)
            : inRange('heartRateBpm', 20, 250) &&
                  inRange('systolicMmHg', 40, 300) &&
                  inRange('diastolicMmHg', 20, 200) &&
                  (values['systolicMmHg'] as int) >
                      (values['diastolicMmHg'] as int))) {
      throw StateError('Invalid wellbeing reading values');
    }
    if (!displayable && !legacyEstimate) {
      throw StateError('Protected wellbeing evidence is not displayable');
    }

    final reading = WellbeingReading(
      id: id,
      metricSet: metric,
      observedAt: observedAt,
      quality: quality,
      displayable: displayable,
      spo2Percent: (values['spo2Percent'] as num?)?.toInt(),
      heartRateBpm: (values['heartRateBpm'] as num?)?.toInt(),
      systolicMmHg: (values['systolicMmHg'] as num?)?.toInt(),
      diastolicMmHg: (values['diastolicMmHg'] as num?)?.toInt(),
      skinTemperatureCelsius: temperature
          ? (temperatureValue as num).toDouble()
          : null,
    );
    if (!reading._hasCompleteValues) {
      throw StateError('Incomplete wellbeing values');
    }
    return reading;
  }

  bool get _hasCompleteValues => switch (metricSet) {
    WellbeingMetricSet.spo2 => spo2Percent != null,
    WellbeingMetricSet.heartRateBloodPressure =>
      heartRateBpm != null && systolicMmHg != null && diastolicMmHg != null,
    WellbeingMetricSet.skinTemperature => skinTemperatureCelsius != null,
  };
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
