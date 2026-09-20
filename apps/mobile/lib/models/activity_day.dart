import 'package:cloud_firestore/cloud_firestore.dart';

class ActivityDay {
  const ActivityDay({
    required this.localDate,
    required this.steps,
    required this.lastObservedAt,
    required this.quality,
    this.resetCount = 0,
    this.partialCoverage = false,
  });

  final String localDate;
  final int steps;
  final DateTime lastObservedAt;
  final String quality;
  final int resetCount;
  final bool partialCoverage;

  factory ActivityDay.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? const <String, dynamic>{};
    return ActivityDay.fromMap(data, fallbackDate: doc.id);
  }

  factory ActivityDay.fromMap(
    Map<String, dynamic> data, {
    String? fallbackDate,
  }) {
    final localDate = (data['localDate'] as String?)?.trim();
    final reportedSteps = (data['reportedSteps'] as num?)?.toInt();
    final observedSteps = (data['recordedSteps'] as num?)?.toInt();
    final steps = reportedSteps ?? observedSteps;
    final observedAt = _asDateTime(
      data['lastObservedAt'],
    );
    final legacyEstimate = data['displayable'] != true &&
        data['schemaVersion'] == 2 &&
        data['aggregation'] == 'observed_delta' &&
        observedSteps != null;
    if ((data['displayable'] != true && !legacyEstimate) ||
        ((localDate?.isNotEmpty != true) &&
            (fallbackDate?.isNotEmpty != true)) ||
        steps == null ||
        steps < 0 ||
        observedAt == null) {
      throw const FormatException('Activity day is not displayable');
    }
    return ActivityDay(
      localDate: localDate?.isNotEmpty == true ? localDate! : fallbackDate!,
      steps: steps,
      lastObservedAt: observedAt,
      quality: (data['quality'] as String?)?.trim() ?? 'unverified',
      resetCount: (data['resetCount'] as num?)?.toInt() ?? 0,
      partialCoverage: data['coverage'] == 'partial' || legacyEstimate,
    );
  }

  bool isFresh({
    DateTime? now,
    Duration maximumAge = const Duration(hours: 2),
  }) {
    final clock = now ?? DateTime.now();
    final age = clock.difference(lastObservedAt);
    return !age.isNegative && age <= maximumAge;
  }
}

DateTime? _asDateTime(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
