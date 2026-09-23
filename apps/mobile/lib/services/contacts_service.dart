import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import 'guardian_services.dart';
import 'watch_phonebook_service.dart';

// Compare international formats without changing the caller number on a watch.
String contactKey(String phone) {
  final compact = phone.trim().replaceAll(RegExp(r'[\s().-]'), '');
  return compact.startsWith('00') ? '+${compact.substring(2)}' : compact;
}

List<Map<String, dynamic>> _rows(dynamic value) => value is List
    ? value.whereType<Map>().map((row) => Map<String, dynamic>.from(row)).toList()
    : [];

class ContactEntry {
  ContactEntry({required this.name, required this.phone, this.whatsapp,
    this.receivesAlerts = false, this.primary = false, this.watch});
  final String name;
  final String phone;
  final String? whatsapp;
  final bool receivesAlerts;
  final bool primary;
  final Map<String, dynamic>? watch;
}

/// One person per canonical phone, preserving independent permissions. Reading
/// legacy notification/watch data never subscribes anyone or writes a command.
List<ContactEntry> mergeContacts(Map<String, dynamic> profile, Map<String, dynamic>? settings) {
  final directory = _rows(profile['contactDirectory']);
  final alerts = _rows(profile['emergencyContacts']);
  final watch = _rows(settings?['contacts']);
  final entries = <String, ContactEntry>{};
  for (final row in [...directory, ...alerts, ...watch]) {
    final phone = row['phone'] as String? ?? '';
    final key = contactKey(phone);
    if (key.isEmpty || entries.containsKey(key)) continue;
    final alertMatches = alerts.where((value) => contactKey(value['phone'] as String? ?? '') == key);
    final watchMatches = watch.where((value) => contactKey(value['phone'] as String? ?? '') == key);
    final alert = alertMatches.isEmpty ? null : alertMatches.first;
    final watchRow = watchMatches.isEmpty ? null : watchMatches.first;
    entries[key] = ContactEntry(name: row['name'] as String? ?? '', phone: phone,
      whatsapp: (alert?['whatsapp'] ?? row['whatsapp']) as String?,
      receivesAlerts: alert != null, primary: alertMatches.any((value) => value['isPrimary'] == true),
      watch: watchRow);
  }
  return entries.values.toList();
}

class ContactsService {
  ContactsService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance, _auth = auth ?? FirebaseAuth.instance;
  final FirebaseFirestore _db;
  final FirebaseAuth _auth;
  String? get currentUid => _auth.currentUser?.uid;
  WatchPhonebookService get phonebook => WatchPhonebookService(db: _db, auth: _auth);

  Stream<Map<String, dynamic>> watchProfile() {
    final uid = currentUid;
    if (uid == null) return Stream.value({});
    return _db.collection('users').doc(uid).snapshots().map((s) => s.data() ?? {});
  }

  Stream<List<({String imei, String name})>> watchWatches() =>
      DeviceService(db: _db, auth: _auth).watchLinkedDevices().map((devices) =>
        devices.map((device) => (imei: device.imei, name: device.displayName)).toList());

  /// Directory + notification choice + optional call request commit atomically.
  /// Notification-only edits never touch phonebook or SOS/answer-mode settings.
  Future<void> saveContact({required String name, required String phone,
    String? whatsapp, required bool receivesAlerts, bool makePrimary = false,
    String? callImei, String? policyRevision}) async {
    final uid = currentUid;
    if (uid == null) throw StateError('Sign in to manage contacts.');
    final normalized = normalizeWatchContactPhone(contactKey(phone));
    final label = name.trim();
    final nameLimit = callImei == null ? 80 : 20;
    if (label.isEmpty || label.length > nameLimit || RegExp(r'[\x00-\x1f\x7f]').hasMatch(label)) {
      throw FormatException('Enter a name with 1–$nameLimit characters.');
    }
    final wa = whatsapp == null || whatsapp.trim().isEmpty ? null
        : normalizeWatchContactPhone(contactKey(whatsapp));
    if (callImei != null && (policyRevision == null || policyRevision.isEmpty)) {
      throw StateError('Watch contact setup is required.');
    }
    final user = _db.collection('users').doc(uid);
    final callRequest = callImei == null ? null : _db.collection('watchPhonebookRequests').doc();
    final expires = Timestamp.fromDate(DateTime.now().add(const Duration(seconds: 60)));
    await _db.runTransaction((tx) async {
      final profile = (await tx.get(user)).data() ?? {};
      final directory = _rows(profile['contactDirectory']);
      final alerts = _rows(profile['emergencyContacts']);
      final key = contactKey(normalized);
      final prior = alerts.where((row) => contactKey(row['phone'] as String? ?? '') == key);
      final primary = makePrimary || prior.any((row) => row['isPrimary'] == true);
      final person = <String, dynamic>{'name': label, 'phone': normalized, if (wa != null) 'whatsapp': wa};
      directory.removeWhere((row) => contactKey(row['phone'] as String? ?? '') == key);
      directory.add(person);
      alerts.removeWhere((row) => contactKey(row['phone'] as String? ?? '') == key);
      if (receivesAlerts) {
        if (primary) {
          for (final row in alerts) { row.remove('isPrimary'); }
        }
        alerts.add({...person, if (primary) 'isPrimary': true});
      }
      if (alerts.isNotEmpty && !alerts.any((row) => row['isPrimary'] == true)) {
        alerts.first['isPrimary'] = true;
      }
      tx.set(user, {'contactDirectory': directory, 'emergencyContacts': alerts,
        'updatedAt': FieldValue.serverTimestamp()}, SetOptions(merge: true));
      if (callRequest != null) {
        tx.set(callRequest, {'imei': callImei, 'name': label, 'phone': normalized,
          'requestedBy': uid, 'policyRevision': policyRevision, 'status': 'pending',
          'createdAt': FieldValue.serverTimestamp(), 'expiresAt': expires});
      }
    }).timeout(const Duration(seconds: 12));
  }
}
