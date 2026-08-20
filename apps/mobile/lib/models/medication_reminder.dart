import 'package:cloud_firestore/cloud_firestore.dart';

class MedicationReminder {
  const MedicationReminder({
    required this.id,
    required this.imei,
    required this.time,
    required this.frequency,
    required this.enabled,
    required this.text,
    this.week,
    this.createdBy,
  });

  final String id;
  final String imei;
  final String time; // 'HH:MM'
  final int frequency; // 1=once, 2=daily, 3=weekly
  final bool enabled;
  final String text;
  final String? week; // 7-digit Sun->Sat mask, only when frequency == 3
  final String? createdBy;

  String get frequencyLabel => switch (frequency) {
    1 => 'Once',
    2 => 'Daily',
    3 => 'Weekly',
    _ => 'Unknown',
  };

  factory MedicationReminder.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? <String, dynamic>{};
    return MedicationReminder(
      id: doc.id,
      imei: (data['imei'] as String?) ?? '',
      time: (data['time'] as String?) ?? '08:00',
      frequency: (data['frequency'] as num?)?.toInt() ?? 2,
      enabled: data['enabled'] != false,
      text: (data['text'] as String?) ?? 'Take medication',
      week: data['week'] as String?,
      createdBy: data['createdBy'] as String?,
    );
  }
}
