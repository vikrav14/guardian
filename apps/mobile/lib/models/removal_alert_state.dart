import 'package:cloud_firestore/cloud_firestore.dart';

enum WatchRemovalState { unknown, worn, removed }

class RemovalAlertState {
  const RemovalAlertState({
    required this.state,
    required this.displayable,
    required this.mode,
    this.stateChangedAt,
    this.lastObservedAt,
    this.expiresAt,
  });

  final WatchRemovalState state;
  final bool displayable;
  final String mode;
  final DateTime? stateChangedAt;
  final DateTime? lastObservedAt;
  final DateTime? expiresAt;

  bool get customerSafe => customerSafeAt(DateTime.now());

  bool customerSafeAt(DateTime now) => displayable && mode == 'accepted' &&
      state != WatchRemovalState.unknown && lastObservedAt != null && expiresAt != null &&
      !lastObservedAt!.isAfter(now) && expiresAt!.isAfter(now) &&
      expiresAt!.difference(lastObservedAt!) <= const Duration(seconds: 120);

  factory RemovalAlertState.fromMap(Map<String, dynamic>? map) {
    final data = map ?? const <String, dynamic>{};
    final state = switch (data['state']) {
      'worn' => WatchRemovalState.worn,
      'removed' => WatchRemovalState.removed,
      _ => WatchRemovalState.unknown,
    };
    return RemovalAlertState(
      state: state,
      displayable: data['displayable'] == true,
      mode: data['mode'] as String? ?? 'unverified',
      stateChangedAt: _date(data['stateChangedAt']),
      lastObservedAt: _date(data['lastObservedAt']),
      expiresAt: _date(data['expiresAt']),
    );
  }
}

class RemovalAlertAuditEvent {
  const RemovalAlertAuditEvent({
    required this.id,
    required this.eventType,
    required this.eventAt,
    required this.notificationEligible,
  });

  final String id;
  final String eventType;
  final DateTime? eventAt;
  final bool notificationEligible;

  factory RemovalAlertAuditEvent.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? const <String, dynamic>{};
    return RemovalAlertAuditEvent(
      id: doc.id,
      eventType: data['eventType'] as String? ?? 'unknown',
      eventAt: _date(data['eventAt']),
      notificationEligible: data['notificationEligible'] == true,
    );
  }
}

DateTime? _date(dynamic value) {
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is String) return DateTime.tryParse(value);
  return null;
}
