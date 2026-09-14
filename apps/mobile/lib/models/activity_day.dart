import 'package:cloud_firestore/cloud_firestore.dart';

class ActivityDay {
  const ActivityDay({
    required this.localDate,
    required this.steps,
    required this.lastObservedAt,
    required this.quality,
    this.resetCount = 0,
  });

  final String localDate;
  final int steps;
  final DateTime lastObservedAt;
  final String quality;
  final int resetCount;

  factory ActivityDay.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? const <String, dynamic>{};
    return ActivityDay.fromMap(data, fallbackDate: doc.id);
  }

  factory ActivityDay.fromMap(
    Map<String, dynamic> data, {
    String? fallbackDate,
  }) {
    final localDate = (data['localDate'] as String?)?.trim();
    final steps = (data['reportedSteps'] as num?)?.toInt();
    final observedAt = _asDateTime(data['lastObservedAt']);
    if (data['displayable'] != true ||
        ((localDate?.isNotEmpty != true) &&
            (fallbackDate?.isNotEmpty != true)) ||
        steps == null ||
        steps < 0 ||
        observedAt == null) {
      throw const FormatException('Activity day is not customer-displayable');
    }
    return ActivityDay(
      localDate: localDate?.isNotEmpty == true ? localDate! : fallbackDate!,
      steps: steps,
      lastObservedAt: observedAt,
      quality: (data['quality'] as String?)?.trim() ?? 'partial',
      resetCount: (data['resetCount'] as num?)?.toInt() ?? 0,
    );
  }

  bool isFresh({DateTime? now, Duration maximumAge = const Duration(hours: 2)}) {
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
