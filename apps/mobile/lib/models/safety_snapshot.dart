import 'package:cloud_firestore/cloud_firestore.dart';

enum SafetySnapshotState {
  requested,
  waitingForDeviceAcceptance,
  available,
  expired,
  deleted,
  rejected,
}

class SafetySnapshot {
  const SafetySnapshot({
    required this.id,
    required this.imei,
    required this.state,
    required this.purpose,
    required this.createdAt,
    this.capturedAt,
    this.mediaExpiresAt,
    this.sizeBytes,
    this.contentType,
  });

  final String id;
  final String imei;
  final SafetySnapshotState state;
  final String purpose;
  final DateTime? createdAt;
  final DateTime? capturedAt;
  final DateTime? mediaExpiresAt;
  final int? sizeBytes;
  final String? contentType;

  bool get isViewable => state == SafetySnapshotState.available;

  String get statusLabel => switch (state) {
    SafetySnapshotState.requested => 'Requested',
    SafetySnapshotState.waitingForDeviceAcceptance =>
      'Waiting for device acceptance',
    SafetySnapshotState.available => 'Safety snapshot available',
    SafetySnapshotState.expired => 'Expired',
    SafetySnapshotState.deleted => 'Deleted',
    SafetySnapshotState.rejected => 'Request rejected',
  };

  String get safetyNote =>
      'A single snapshot provides context only. It does not prove that the wearer is safe.';

  factory SafetySnapshot.fromFirestore(
    String id,
    Map<String, dynamic> data,
  ) {
    final state = switch ((data['state'] as String?)?.trim()) {
      'requested' => SafetySnapshotState.requested,
      'waiting_for_device_acceptance' =>
        SafetySnapshotState.waitingForDeviceAcceptance,
      'available' => SafetySnapshotState.available,
      'expired' => SafetySnapshotState.expired,
      'deleted' => SafetySnapshotState.deleted,
      _ => SafetySnapshotState.rejected,
    };
    return SafetySnapshot(
      id: id,
      imei: (data['imei'] as String?) ?? '',
      state: state,
      purpose: (data['purpose'] as String?) ?? '',
      createdAt: _asDate(data['createdAt']),
      capturedAt: _asDate(data['capturedAt']),
      mediaExpiresAt: _asDate(data['mediaExpiresAt']),
      sizeBytes: (data['sizeBytes'] as num?)?.toInt(),
      contentType: data['contentType'] as String?,
    );
  }
}

DateTime? _asDate(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
