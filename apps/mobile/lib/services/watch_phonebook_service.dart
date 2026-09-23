import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'watch_calls_service.dart' show watchCallDate;

String normalizeWatchContactPhone(String value) {
  final phone = value.trim().replaceAll(RegExp(r'[\s().-]'), '');
  if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(phone)) {
    throw const FormatException('Use an international number, such as +230…');
  }
  return phone;
}

String watchContactMessage(Map<String, dynamic> row, DateTime now) {
  switch (row['status']) {
    case 'imported':
      return 'Existing watch contact recorded during setup.';
    case 'pending':
      final expiry = watchCallDate(row['expiresAt']);
      return expiry != null && expiry.isAfter(now)
          ? 'Waiting for the gateway. This request expires shortly.'
          : 'Request expired. It will not be sent later.';
    case 'sending':
      final lease = watchCallDate(row['leaseUntil']);
      return lease != null && lease.isAfter(now)
          ? 'Checking the connection and waiting for the watch…'
          : 'Delivery is uncertain. Check the watch; contact space remains reserved.';
    case 'device_replied':
      return 'Watch replied. Check its phonebook and make a test call.';
    case 'handoff_unknown':
      return 'Delivery is uncertain. Check the watch; contact space remains reserved.';
    case 'not_sent':
      return switch (row['reason']) {
        'already_reserved' => 'This number is already recorded or awaiting verification. Check the contact below.',
        'replacement_unavailable' => 'Changing an existing watch contact is not available yet.',
        'no_verified_empty_slot' => 'No verified contact space remains. Ask support to check the watch.',
        'change_in_progress' || 'transport_busy' => 'Not sent. Another watch setting is being changed. Try again shortly.',
        'expired' || 'expired_before_handoff' => 'Request expired. It will not be sent later.',
        'not_authorized' => 'Not sent. Only the designated contact manager can add callers.',
        _ => 'Not sent. Check the connection and your access before trying again.',
      };
    default:
      return 'Watch contact status is unconfirmed.';
  }
}

class WatchPhonebookService {
  WatchPhonebookService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;
  final FirebaseFirestore _db;
  final FirebaseAuth _auth;
  String? get currentUid => _auth.currentUser?.uid;

  Stream<Map<String, dynamic>?> watchSettings(String imei) => _db
      .collection('watchPhonebookSettings').doc(imei).snapshots().map((s) => s.data());
  Stream<Map<String, dynamic>?> watchLatestRequest(String imei) => _db
      .collection('watchPhonebookRequests').where('imei', isEqualTo: imei)
      .orderBy('createdAt', descending: true).limit(1).snapshots()
      .map((s) => s.docs.isEmpty ? null : s.docs.first.data());

  Future<void> addContact(String imei, {required String name, required String phone,
    required String policyRevision}) async {
    if (currentUid == null) throw StateError('Sign in to manage watch contacts.');
    final label = name.trim();
    if (label.isEmpty || label.length > 20 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(label)) {
      throw const FormatException('Enter a name with 1–20 characters.');
    }
    if (policyRevision.isEmpty) throw StateError('Contact setup is required.');
    await _db.collection('watchPhonebookRequests').add({
      'imei': imei, 'name': label, 'phone': normalizeWatchContactPhone(phone),
      'requestedBy': currentUid, 'policyRevision': policyRevision, 'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(const Duration(seconds: 60))),
    }).timeout(const Duration(seconds: 12));
  }
}
