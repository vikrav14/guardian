import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/geofence.dart';

class DeviceService {
  DeviceService({FirebaseFirestore? db}) : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  Future<void> renameDevice(String imei, String name) async {
    final trimmed = name.trim();
    await _db.collection('devices').doc(imei).update({
      'name': trimmed.isEmpty ? FieldValue.delete() : trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }
}

class GeofenceService {
  GeofenceService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Stream<List<Geofence>> watchAll() {
    return _db.collection('geofences').snapshots().map(
          (snap) => snap.docs.map(Geofence.fromDoc).toList(),
        );
  }

  Future<void> create({
    required String imei,
    required String name,
    required double lat,
    required double lng,
    required double radiusMeters,
    String? wifiSsid,
  }) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      throw StateError('Not signed in');
    }

    await _db.collection('geofences').add({
      'imei': imei,
      'name': name.trim().isEmpty ? 'Safe zone' : name.trim(),
      'active': true,
      'center': {'lat': lat, 'lng': lng},
      'radiusMeters': radiusMeters,
      'wifiSsid': wifiSsid?.trim().isEmpty == true ? null : wifiSsid?.trim(),
      'createdBy': uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> setActive(String id, bool active) async {
    await _db.collection('geofences').doc(id).update({
      'active': active,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> delete(String id) async {
    await _db.collection('geofences').doc(id).delete();
  }
}

class EmergencyContact {
  const EmergencyContact({
    required this.name,
    required this.phone,
    this.whatsapp,
  });

  final String name;
  final String phone;
  final String? whatsapp;

  Map<String, dynamic> toMap() => {
        'name': name,
        'phone': phone,
        if (whatsapp != null && whatsapp!.trim().isNotEmpty) 'whatsapp': whatsapp,
      };

  factory EmergencyContact.fromMap(Map<String, dynamic> map) {
    return EmergencyContact(
      name: (map['name'] as String?) ?? '',
      phone: (map['phone'] as String?) ?? '',
      whatsapp: map['whatsapp'] as String?,
    );
  }
}

class UserProfileService {
  UserProfileService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Stream<List<EmergencyContact>> watchContacts() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      return Stream.value(const []);
    }
    return _db.collection('users').doc(uid).snapshots().map((snap) {
      final raw = snap.data()?['emergencyContacts'];
      if (raw is! List) return const <EmergencyContact>[];
      return raw
          .whereType<Map>()
          .map((m) => EmergencyContact.fromMap(Map<String, dynamic>.from(m)))
          .toList();
    });
  }

  Future<void> saveContacts(List<EmergencyContact> contacts) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Not signed in');
    await _db.collection('users').doc(uid).set({
      'emergencyContacts': contacts.map((c) => c.toMap()).toList(),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}

class AlertService {
  AlertService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Future<void> sendHelpAlert({
    required String imei,
    String? deviceName,
  }) async {
    final uid = _auth.currentUser?.uid;
    await _db.collection('alerts').add({
      'imei': imei,
      'type': 'sos',
      'severity': 'critical',
      'message': 'Help requested for ${deviceName ?? imei}',
      'resolved': false,
      'notifyStatus': 'pending',
      'payload': {
        'source': 'app',
        'requestedBy': ?uid,
      },
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> resolve(String alertId) async {
    await _db.collection('alerts').doc(alertId).update({
      'resolved': true,
      'resolvedAt': FieldValue.serverTimestamp(),
    });
  }
}

class FamilyMember {
  const FamilyMember({
    required this.uid,
    required this.displayName,
    this.email,
  });

  final String uid;
  final String displayName;
  final String? email;

  Map<String, dynamic> toMap() => {
        'uid': uid,
        'displayName': displayName,
        if (email != null) 'email': email,
      };

  factory FamilyMember.fromMap(Map<String, dynamic> map) {
    return FamilyMember(
      uid: (map['uid'] as String?) ?? '',
      displayName: (map['displayName'] as String?) ?? 'Guardian',
      email: map['email'] as String?,
    );
  }
}

class FamilyInvite {
  const FamilyInvite({
    required this.id,
    required this.code,
    required this.createdBy,
    required this.createdByName,
    required this.status,
    required this.linkedImeis,
    this.acceptedByName,
  });

  final String id;
  final String code;
  final String createdBy;
  final String createdByName;
  final String status;
  final List<String> linkedImeis;
  final String? acceptedByName;

  factory FamilyInvite.fromDoc(DocumentSnapshot<Map<String, dynamic>> doc) {
    final data = doc.data() ?? <String, dynamic>{};
    return FamilyInvite(
      id: doc.id,
      code: (data['code'] as String?) ?? '',
      createdBy: (data['createdBy'] as String?) ?? '',
      createdByName: (data['createdByName'] as String?) ?? 'Guardian',
      status: (data['status'] as String?) ?? 'pending',
      linkedImeis: (data['linkedImeis'] as List?)?.whereType<String>().toList() ?? const [],
      acceptedByName: data['acceptedByName'] as String?,
    );
  }
}

class FamilyService {
  FamilyService({FirebaseFirestore? db, FirebaseAuth? auth})
      : _db = db ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  static String _generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    final now = DateTime.now().microsecondsSinceEpoch;
    final buf = StringBuffer();
    var n = now;
    for (var i = 0; i < 6; i++) {
      buf.write(chars[n % chars.length]);
      n ~/= chars.length;
      n ^= (n << 3);
    }
    return buf.toString();
  }

  Stream<List<FamilyMember>> watchFamilyMembers() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    return _db.collection('users').doc(uid).snapshots().map((snap) {
      final raw = snap.data()?['familyMembers'];
      if (raw is! List) return const <FamilyMember>[];
      return raw
          .whereType<Map>()
          .map((m) => FamilyMember.fromMap(Map<String, dynamic>.from(m)))
          .where((m) => m.uid.isNotEmpty)
          .toList();
    });
  }

  Stream<List<FamilyInvite>> watchMyInvites() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    return _db
        .collection('invites')
        .where('createdBy', isEqualTo: uid)
        .snapshots()
        .map((snap) {
      final list = snap.docs.map(FamilyInvite.fromDoc).toList();
      list.sort((a, b) => a.code.compareTo(b.code));
      return list;
    });
  }

  Future<String> createInviteCode() async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final profile = await _db.collection('users').doc(user.uid).get();
    final linked = (profile.data()?['linkedImeis'] as List?)?.whereType<String>().toList() ??
        <String>[];
    final code = _generateCode();

    await _db.collection('invites').add({
      'code': code,
      'createdBy': user.uid,
      'createdByName': user.displayName?.trim().isNotEmpty == true
          ? user.displayName!.trim()
          : (user.email ?? 'Guardian'),
      'createdByEmail': user.email,
      'linkedImeis': linked,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
      'expiresAt': Timestamp.fromDate(DateTime.now().add(const Duration(days: 7))),
    });
    return code;
  }

  Future<void> acceptInviteCode(String rawCode) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final code = rawCode.trim().toUpperCase();
    if (code.length < 4) throw StateError('Enter a valid invite code');

    final snap = await _db.collection('invites').where('code', isEqualTo: code).limit(1).get();
    if (snap.docs.isEmpty) throw StateError('Invite code not found');

    final inviteDoc = snap.docs.first;
    final invite = inviteDoc.data();
    if (invite['status'] != 'pending') {
      throw StateError('This invite is no longer active');
    }
    if (invite['createdBy'] == user.uid) {
      throw StateError('You cannot accept your own invite');
    }

    final expiresAt = invite['expiresAt'];
    if (expiresAt is Timestamp && expiresAt.toDate().isBefore(DateTime.now())) {
      throw StateError('This invite has expired');
    }

    final linked = (invite['linkedImeis'] as List?)?.whereType<String>().toList() ?? <String>[];
    final inviter = FamilyMember(
      uid: invite['createdBy'] as String,
      displayName: (invite['createdByName'] as String?) ?? 'Guardian',
      email: invite['createdByEmail'] as String?,
    );

    final myRef = _db.collection('users').doc(user.uid);
    final mySnap = await myRef.get();
    final existingMembers = (mySnap.data()?['familyMembers'] as List?)
            ?.whereType<Map>()
            .map((m) => FamilyMember.fromMap(Map<String, dynamic>.from(m)))
            .toList() ??
        <FamilyMember>[];
    if (!existingMembers.any((m) => m.uid == inviter.uid)) {
      existingMembers.add(inviter);
    }

    final batch = _db.batch();
    batch.update(inviteDoc.reference, {
      'status': 'accepted',
      'acceptedBy': user.uid,
      'acceptedByName': user.displayName?.trim().isNotEmpty == true
          ? user.displayName!.trim()
          : (user.email ?? 'Guardian'),
      'acceptedByEmail': user.email,
      'acceptedAt': FieldValue.serverTimestamp(),
    });
    batch.set(
      myRef,
      {
        'linkedImeis': FieldValue.arrayUnion(linked),
        'familyMembers': existingMembers.map((m) => m.toMap()).toList(),
        'updatedAt': FieldValue.serverTimestamp(),
      },
      SetOptions(merge: true),
    );

    await batch.commit();
  }
}
