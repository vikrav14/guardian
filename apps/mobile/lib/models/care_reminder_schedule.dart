import 'package:cloud_firestore/cloud_firestore.dart';

enum CareReminderSyncState {
  backendOnly,
  blockedUnverified,
  readyForAcceptance,
  sent,
  failed,
}

class CareReminderSchedule {
  const CareReminderSchedule({
    required this.id,
    required this.imei,
    required this.kind,
    required this.label,
    required this.localTime,
    required this.weekdays,
    required this.enabled,
    required this.syncState,
    required this.acknowledgementSupported,
    required this.acknowledgementState,
    this.syncReason,
    this.updatedAt,
  });

  final String id;
  final String imei;
  final String kind;
  final String label;
  final String localTime;
  final List<int> weekdays;
  final bool enabled;
  final CareReminderSyncState syncState;
  final String? syncReason;
  final bool acknowledgementSupported;
  final String acknowledgementState;
  final DateTime? updatedAt;

  bool get watchSynced => syncState == CareReminderSyncState.sent;
  bool get wearerAcknowledged => false;

  String get syncLabel => switch (syncState) {
    CareReminderSyncState.backendOnly => 'Saved in Guardian only',
    CareReminderSyncState.blockedUnverified => 'Watch sync not yet available',
    CareReminderSyncState.readyForAcceptance => 'Awaiting accepted watch sync',
    CareReminderSyncState.sent => 'Sent to watch',
    CareReminderSyncState.failed => 'Watch sync failed',
  };

  factory CareReminderSchedule.fromFirestore(
    String id,
    Map<String, dynamic> map,
  ) {
    final rawState = (map['syncState'] as String?)?.trim();
    final syncState = switch (rawState) {
      'backend_only' => CareReminderSyncState.backendOnly,
      'ready_for_acceptance' => CareReminderSyncState.readyForAcceptance,
      'sent' => CareReminderSyncState.sent,
      'failed' => CareReminderSyncState.failed,
      _ => CareReminderSyncState.blockedUnverified,
    };
    final rawWeekdays = (map['weekdays'] as List?) ?? const [];
    return CareReminderSchedule(
      id: id,
      imei: (map['imei'] as String?) ?? '',
      kind: (map['kind'] as String?) ?? 'routine',
      label: (map['label'] as String?) ?? 'Reminder',
      localTime: (map['localTime'] as String?) ?? '--:--',
      weekdays: rawWeekdays.whereType<num>().map((v) => v.toInt()).toList(),
      enabled: map['enabled'] != false,
      syncState: syncState,
      syncReason: map['syncReason'] as String?,
      acknowledgementSupported: map['acknowledgementSupported'] == true,
      acknowledgementState:
          (map['acknowledgementState'] as String?) ?? 'unavailable',
      updatedAt: _asDate(map['updatedAt']),
    );
  }
}

DateTime? _asDate(Object? value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
