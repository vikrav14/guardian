import 'package:cloud_firestore/cloud_firestore.dart';

enum SafetySnapshotState {
  requested,
  waitingForDeviceAcceptance,
  takingPhoto,
  failed,
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
    this.receivedAt,
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
  final DateTime? receivedAt;
  final DateTime? mediaExpiresAt;
  final int? sizeBytes;
  final String? contentType;

  bool get isViewable =>
      state == SafetySnapshotState.available &&
      mediaExpiresAt != null &&
      mediaExpiresAt!.isAfter(DateTime.now());
  bool get isPending =>
      state == SafetySnapshotState.takingPhoto ||
      state == SafetySnapshotState.requested;

  String get statusLabel => switch (state) {
    SafetySnapshotState.requested => 'Requested',
    SafetySnapshotState.waitingForDeviceAcceptance =>
      'Waiting for device acceptance',
    SafetySnapshotState.takingPhoto => 'Taking photo…',
    SafetySnapshotState.failed => 'No photo received',
    SafetySnapshotState.available => isViewable ? 'Photo received' : 'Expired',
    SafetySnapshotState.expired => 'Expired',
    SafetySnapshotState.deleted => 'Deleted',
    SafetySnapshotState.rejected => 'Request rejected',
  };

  String get safetyNote =>
      'A single snapshot provides context only. It does not prove that the wearer is safe.';

  factory SafetySnapshot.fromFirestore(String id, Map<String, dynamic> data) {
    final state = switch ((data['state'] as String?)?.trim()) {
      'requested' => SafetySnapshotState.requested,
      'waiting_for_device_acceptance' =>
        SafetySnapshotState.waitingForDeviceAcceptance,
      'dispatching' ||
      'waiting_for_image' ||
      'receiving' => SafetySnapshotState.takingPhoto,
      'failed' => SafetySnapshotState.failed,
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
      receivedAt: _asDate(data['receivedAt']),
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
