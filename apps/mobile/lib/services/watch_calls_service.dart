import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

enum WatchAnswerMode {
  manual('Manual', 'Press to answer'),
  auto('Auto', 'Answer handsfree');

  const WatchAnswerMode(this.label, this.description);
  final String label;
  final String description;
}

DateTime? watchCallDate(dynamic value) =>
    value is Timestamp ? value.toDate() : value is DateTime ? value : null;

String watchCallRequestMessage(Map<String, dynamic>? request, DateTime now) {
  if (request == null) return 'No answer setting requested from the app yet.';
  final mode = request['mode'] == 'auto' ? 'Auto' : 'Manual';
  final expiry = watchCallDate(request['expiresAt']);
  final lease = watchCallDate(request['leaseUntil']);
  switch (request['status']) {
    case 'restoration_pending':
      return 'Returning to Manual. Guardian will retry when the watch connects; Auto may remain on until it replies.';
    case 'pending':
      return expiry == null || !expiry.isAfter(now)
          ? 'Could not confirm $mode before the request timed out. Check the watch before trying again.'
          : 'Waiting to send $mode. This request expires shortly.';
    case 'sending':
      return lease != null && lease.isAfter(now)
          ? 'Checking the connection and waiting for the watch to reply to $mode…'
          : 'Could not confirm $mode. Check the watch before trying again.';
    case 'device_replied':
      return 'Watch replied to $mode. Make a test call to confirm the watch’s behavior.';
    case 'socket_handoff':
      return '$mode handed to the connection; watch receipt is unconfirmed. Make a test call to check.';
    case 'handoff_unknown':
      return request['reason'] == 'watch_reply_missing'
          ? 'The watch did not reply to every $mode command. The setting is unconfirmed; check the watch.'
          : 'Could not confirm $mode. The watch may have changed. Check it before trying again.';
    case 'not_sent':
      return switch (request['reason']) {
        'no_fresh_identified_session' => '$mode was not sent. Wait for the watch to reconnect, then try again.',
        'emergency_policy_active' => 'Emergency answering is enabled or Manual restoration is pending. Everyday calls stay Manual.',
        'change_in_progress' => '$mode was not sent. Another change is in progress.',
        'connection_unconfirmed' || 'connection_changed' => '$mode was not sent because the watch connection could not be confirmed. Wait for reconnection, then try again.',
        'transport_busy' => '$mode was not sent. Another call-setting change is in progress.',
        'expired' || 'expired_before_handoff' => '$mode request expired. It will not be sent later.',
        'superseded' => '$mode was not sent because a newer change was requested.',
        'settings_changed' => '$mode was not sent. Call settings changed; review them and try again.',
        'service_unavailable' => 'Auto requires an active Family or Care service. Manual remains available.',
        _ => '$mode was not sent. Review the watch connection and your access.',
      };
    default:
      return 'Answer setting could not be confirmed. Check the watch.';
  }
}

class WatchCallsService {
  WatchCallsService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  String? get currentUid => _auth.currentUser?.uid;

  Stream<Map<String, dynamic>?> watchEmergencySettings(String imei) => _db
      .collection('watchEmergencySettings').doc(imei).snapshots().map((s) => s.data());

  Stream<Map<String, dynamic>?> watchEmergencyRequest(String imei) => _db
      .collection('watchEmergencyRequests').where('imei', isEqualTo: imei)
      .orderBy('createdAt', descending: true).limit(1).snapshots()
      .map((s) => s.docs.isEmpty ? null : s.docs.first.data());

  Future<void> requestEmergency(String imei, {required bool enabled,
    required String revision, required bool consentAccepted}) async {
    final uid = currentUid;
    if (uid == null || revision.isEmpty || consentAccepted != enabled) {
      throw StateError('Review emergency answering before saving.');
    }
    await _db.collection('watchEmergencyRequests').add({
      'imei': imei, 'enabled': enabled, 'requestedBy': uid, 'revision': revision,
      'consentAccepted': consentAccepted, 'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(const Duration(seconds: 60))),
    }).timeout(const Duration(seconds: 12));
  }

  Stream<Map<String, dynamic>?> watchSettings(String imei) =>
      _db.collection('watchCallSettings').doc(imei).snapshots().map((s) => s.data());

  Stream<Map<String, dynamic>?> watchLatestRequest(String imei) => _db
      .collection('watchCallRequests')
      .where('imei', isEqualTo: imei)
      .orderBy('createdAt', descending: true)
      .limit(1)
      .snapshots()
      .map((s) => s.docs.isEmpty ? null : s.docs.first.data());

  Future<void> requestMode(String imei, WatchAnswerMode mode, {
    required String policyRevision,
    required bool consentAccepted,
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Sign in to change call settings.');
    if (policyRevision.isEmpty || consentAccepted != (mode == WatchAnswerMode.auto)) {
      throw StateError('Review the call setting before sending it.');
    }
    await _db.collection('watchCallRequests').add({
      'imei': imei,
      'mode': mode.name,
      'requestedBy': uid,
      'policyRevision': policyRevision,
      'consentAccepted': consentAccepted,
      'createdAt': FieldValue.serverTimestamp(),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(const Duration(seconds: 60))),
      'status': 'pending',
    }).timeout(const Duration(seconds: 12));
  }
}
