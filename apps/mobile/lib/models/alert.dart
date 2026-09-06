import 'package:cloud_firestore/cloud_firestore.dart';

import 'sos_location_snapshot.dart';

class GuardianAlert {
  const GuardianAlert({
    required this.id,
    required this.imei,
    required this.type,
    required this.severity,
    required this.message,
    required this.resolved,
    this.title,
    this.createdAt,
    this.resolvedAt,
    this.payload,
    this.sosLocationSnapshot,
  });

  final String id;
  final String imei;
  final String type;
  final String severity;
  final String message;
  final bool resolved;
  final String? title;
  final DateTime? createdAt;
  final DateTime? resolvedAt;
  final Map<String, dynamic>? payload;
  final SosLocationSnapshot? sosLocationSnapshot;

  factory GuardianAlert.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return GuardianAlert(
      id: doc.id,
      imei: (data['imei'] as String?) ?? '',
      type: (data['type'] as String?) ?? 'other',
      severity: (data['severity'] as String?) ?? 'info',
      message: (data['message'] as String?) ?? 'Alert',
      resolved: data['resolved'] == true,
      title: data['title'] as String?,
      createdAt: _asDateTime(data['createdAt']),
      resolvedAt: _asDateTime(data['resolvedAt']),
      payload: data['payload'] is Map
          ? Map<String, dynamic>.from(data['payload'] as Map)
          : null,
      sosLocationSnapshot: data['type'] == 'sos'
          ? SosLocationSnapshot.tryParse(data['sosLocationSnapshot'])
          : null,
    );
  }
}

DateTime? _asDateTime(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
