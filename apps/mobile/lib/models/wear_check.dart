import 'package:cloud_firestore/cloud_firestore.dart';

/// A family member's dated observation, never automatic wearing evidence.
class WearCheck {
  const WearCheck({
    required this.state,
    required this.observedAt,
    required this.recordedAt,
  });

  final String state;
  final DateTime observedAt;
  final DateTime recordedAt;

  static WearCheck? fromMap(Map<String, dynamic>? data) {
    if (data == null || data['version'] != 1) return null;
    final observed = data['observedAt'];
    final recorded = data['recordedAt'];
    if (observed is! Timestamp ||
        recorded is! Timestamp ||
        !['worn', 'removed'].contains(data['state'])) {
      return null;
    }
    if (recorded.toDate().difference(observed.toDate()).abs() >
        const Duration(seconds: 60)) {
      return null;
    }
    return WearCheck(
      state: data['state'] as String,
      observedAt: observed.toDate(),
      recordedAt: recorded.toDate(),
    );
  }
}
