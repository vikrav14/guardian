import 'package:cloud_firestore/cloud_firestore.dart';

/// Wearing evidence is separate from network connection and health values.
class WearStatus {
  const WearStatus({this.state = 'unknown', this.observedAt, this.expiresAt,
    this.deviceAccepted = false});
  final String state;
  final DateTime? observedAt, expiresAt;
  final bool deviceAccepted;

  factory WearStatus.fromMap(Map<String, dynamic> data) => WearStatus(
    state: data['version'] == 1 ? data['state'] as String? ?? 'unknown' : 'unknown',
    observedAt: _date(data['observedAt']), expiresAt: _date(data['expiresAt']),
    deviceAccepted: data['deviceAccepted'] == true,
  );

  String stateAt(DateTime now) {
    if (!deviceAccepted || observedAt == null || expiresAt == null ||
        observedAt!.isAfter(now) || !expiresAt!.isAfter(now) ||
        expiresAt!.difference(observedAt!) > const Duration(seconds: 120) ||
        !['worn', 'removed'].contains(state)) return 'unknown';
    return state;
  }

  String labelAt(DateTime now) => switch (stateAt(now)) {
    'worn' => 'Wearing detected',
    'removed' => 'Watch removed · new readings are excluded',
    _ => 'Wearing status unconfirmed',
  };
}

DateTime? _date(Object? value) => switch (value) {
  Timestamp timestamp => timestamp.toDate(),
  DateTime date => date,
  String text => DateTime.tryParse(text),
  _ => null,
};
