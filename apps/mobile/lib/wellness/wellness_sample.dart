enum WellnessMetric { heartRate, bloodOxygen, bloodPressure }

/// A display adapter for accepted evidence. Unsupported temperature has no
/// sample type and cannot accidentally become a live reading.
class WellnessSample {
  const WellnessSample({
    required this.metric,
    required this.value,
    required this.recordedAt,
  });
  final WellnessMetric metric;
  final String value;
  final DateTime recordedAt;
}
