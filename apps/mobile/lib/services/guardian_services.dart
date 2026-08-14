import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../models/medication_reminder.dart';
import '../journey/journey_models.dart';
import '../journey/journey_utils.dart';
import 'guardian_entitlements.dart';
import 'imei_utils.dart';

export 'guardian_entitlements.dart';

/// Firestore rules only allow reading devices/alerts/geofences whose `imei`
/// is in the signed-in user's `linkedImeis` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â so every list/stream here has
/// to filter by that set rather than reading the collection unscoped.
Stream<List<String>> _watchLinkedImeis(
  FirebaseFirestore db,
  FirebaseAuth auth,
) {
  final uid = auth.currentUser?.uid;
  if (uid == null) return Stream.value(const []);
  return db
      .collection('users')
      .doc(uid)
      .snapshots()
      .map((snap) {
        final raw =
            (snap.data()?['linkedImeis'] as List?)?.whereType<String>() ??
            const <String>[];
        return normalizeLinkedImeis(raw);
      })
      .distinct(linkedImeisEqual);
}

// Firestore whereIn supports at most 30 values per query.
const _maxWhereIn = 30;

Stream<T> _combineLatest3<A, B, C, T>(
  Stream<A> streamA,
  Stream<B> streamB,
  Stream<C> streamC,
  T Function(A a, B b, C c) combiner,
) {
  late StreamSubscription<A> subA;
  late StreamSubscription<B> subB;
  late StreamSubscription<C> subC;
  A? latestA;
  B? latestB;
  C? latestC;
  var anyEvent = false;

  final controller = StreamController<T>();

  void emit() {
    if (latestA != null && latestB != null && latestC != null) {
      controller.add(combiner(latestA as A, latestB as B, latestC as C));
    }
  }

  controller.onListen = () {
    subA = streamA.listen((value) {
      latestA = value;
      anyEvent = true;
      emit();
    }, onError: controller.addError);
    subB = streamB.listen((value) {
      latestB = value;
      anyEvent = true;
      emit();
    }, onError: controller.addError);
    subC = streamC.listen((value) {
      latestC = value;
      anyEvent = true;
      emit();
    }, onError: controller.addError);
  };

  controller.onCancel = () async {
    await subA.cancel();
    await subB.cancel();
    await subC.cancel();
    if (!anyEvent) {
      // Allow empty combine when all streams complete without data.
    }
  };

  return controller.stream;
}

class DeviceService {
  DeviceService({FirebaseFirestore? db, FirebaseAuth? auth})
    : _db = db ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Future<void> renameDevice(String imei, String name) async {
    final trimmed = name.trim();
    await _db.collection('devices').doc(imei).update({
      'name': trimmed.isEmpty ? FieldValue.delete() : trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updatePersonIdentity(
    String imei, {
    required String nickname,
    required String relationship,
  }) async {
    final trimmedNickname = nickname.trim();
    final trimmedRelationship = relationship.trim();
    await _db.collection('devices').doc(imei).update({
      'nickname': trimmedNickname.isEmpty
          ? FieldValue.delete()
          : trimmedNickname,
      'relationship': trimmedRelationship.isEmpty
          ? FieldValue.delete()
          : trimmedRelationship,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateCareProfile(
    String imei, {
    required GuardianSubscription subscription,
    required String careProfile,
    required List<String> carePriorities,
  }) async {
    if (!subscription.has(GuardianFeature.wellbeingActivitySummaries)) {
      throw StateError('Care profiles require Guardian Care.');
    }
    await _db.collection('devices').doc(imei).update({
      'careProfile': careProfile,
      'carePriorities': carePriorities,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateAvatarUrl(String imei, String? avatarUrl) async {
    final trimmed = avatarUrl?.trim();
    await _db.collection('devices').doc(imei).update({
      'avatarUrl': trimmed == null || trimmed.isEmpty
          ? FieldValue.delete()
          : trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Records the pendant's own SIM phone number so the app can call it
  /// directly and the gateway can send it SMS configuration commands.
  Future<void> setSimNumber(String imei, String phone) async {
    final trimmed = phone.trim();
    await _db.collection('devices').doc(imei).update({
      'simNumber': trimmed.isEmpty ? FieldValue.delete() : trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  /// V46/V48/V52 only ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â TCP downlink, requires the device to currently hold
  /// a live connection to the gateway (see DeviceCommandService.setFallDetection
  /// and setFallSensitivity). Caches the requested state on the device doc
  /// since the device has no read-back command; the cache reflects what was
  /// last *asked for*, not confirmed device state.
  Future<void> updateFallDetectionPrefs(
    String imei, {
    required bool enabled,
    required bool dialMonitorOnFall,
    required int sensitivityLevel,
  }) async {
    await _db.collection('devices').doc(imei).update({
      'fallDetection': {
        'enabled': enabled,
        'dialMonitorOnFall': dialMonitorOnFall,
        'sensitivityLevel': sensitivityLevel,
      },
      'updatedAt': FieldValue.serverTimestamp(),
    });

    final commands = DeviceCommandService(db: _db, auth: _auth);
    await commands.setFallDetection(
      imei,
      enabled: enabled,
      dialMonitorOnFall: dialMonitorOnFall,
    );
    await commands.setFallSensitivity(imei, sensitivityLevel);
  }

  /// V46/V48/V52 only ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â TCP downlink, requires the device to currently hold
  /// a live connection to the gateway (see
  /// DeviceCommandService.setUploadInterval). Without this, the pendant's
  /// default reporting interval is long and irregular -- the map can show a
  /// last-known fix that's 20-30+ minutes old even while the watch is
  /// online and checking in every ~5 minutes. Caches the requested interval
  /// on the device doc since there's no read-back command; the cache
  /// reflects what was last *asked for*, not confirmed device state.
  Future<void> setAutomaticLocationReporting(String imei) async {
    await _db.collection('devices').doc(imei).update({
      'locationReportingMode': 'automatic',
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> updateLocationReportingInterval(
    String imei, {
    required int seconds,
  }) async {
    await _db.collection('devices').doc(imei).update({
      'locationReportingIntervalSeconds': seconds,
      'locationReportingMode': 'manual',
      'updatedAt': FieldValue.serverTimestamp(),
    });

    final commands = DeviceCommandService(db: _db, auth: _auth);
    await commands.setUploadInterval(imei, seconds);
  }

  /// Links a watch IMEI to the signed-in guardian's account.
  ///
  /// Uses the 15-digit label/SMS IMEI (10-digit protocol ids are normalized).
  /// The gateway creates `devices/{imei}` when the watch first connects.
  Future<void> linkPendant(String rawImei) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final imei = canonicalDeviceImei(rawImei.trim());
    if (imei == null || !isFullImei(imei)) {
      throw StateError(
        'Enter the 15-digit IMEI from the watch label or status SMS',
      );
    }

    await _db.collection('users').doc(user.uid).set({
      'linkedImeis': FieldValue.arrayUnion([imei]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Removes a watch IMEI from the signed-in guardian's linked set.
  ///
  /// Does not delete `devices/{imei}` ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â only drops access for this account.
  Future<void> unlinkPendant(String rawImei) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final imei = canonicalDeviceImei(rawImei.trim());
    if (imei == null || !isFullImei(imei)) {
      throw StateError('Invalid watch IMEI');
    }

    await _db.collection('users').doc(user.uid).set({
      'linkedImeis': FieldValue.arrayRemove([imei]),
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  /// Streams the given day's location history for a watch (requires the
  /// gateway's WRITE_LOCATION_HISTORY=true ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â otherwise this is always empty).
  Stream<List<LocationHistoryPoint>> watchDayHistory(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
  }) {
    _requireHistoryAccess(subscription, day);
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    return _db
        .collection('devices')
        .doc(imei)
        .collection('locations')
        .where('recordedAt', isGreaterThanOrEqualTo: Timestamp.fromDate(start))
        .where('recordedAt', isLessThan: Timestamp.fromDate(end))
        .orderBy('recordedAt')
        .snapshots()
        .map((snap) => snap.docs.map(LocationHistoryPoint.fromDoc).toList());
  }

  /// Streams compressed journeys for a calendar day.
  Stream<List<JourneyRecord>> watchDayJourneys(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
  }) {
    _requireHistoryAccess(subscription, day);
    final localStart = DateTime(day.year, day.month, day.day);
    final localEnd = localStart.add(const Duration(days: 1));
    return _db
        .collection('devices')
        .doc(imei)
        .collection('journeys')
        .where(
          'startAt',
          isGreaterThanOrEqualTo: Timestamp.fromDate(localStart),
        )
        .where('startAt', isLessThan: Timestamp.fromDate(localEnd))
        .orderBy('startAt')
        .snapshots()
        .map((snap) => snap.docs.map(JourneyRecord.fromDoc).toList());
  }

  /// Streams gateway dwell segments for a calendar day.
  Stream<List<DwellSegment>> watchDaySegments(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
  }) {
    _requireHistoryAccess(subscription, day);
    final start = DateTime(day.year, day.month, day.day);
    final end = start.add(const Duration(days: 1));
    return _db
        .collection('devices')
        .doc(imei)
        .collection('segments')
        .where('from', isGreaterThanOrEqualTo: Timestamp.fromDate(start))
        .where('from', isLessThan: Timestamp.fromDate(end))
        .orderBy('from')
        .snapshots()
        .map((snap) => snap.docs.map(DwellSegment.fromDoc).toList());
  }

  /// Journeys + dwell segments + legacy location history merged for Journey replay.
  Stream<JourneyDayData> watchDayJourneyData(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
    List<Geofence> geofences = const [],
  }) {
    return _combineLatest3(
      watchDayHistory(imei, day, subscription: subscription),
      watchDayJourneys(imei, day, subscription: subscription),
      watchDaySegments(imei, day, subscription: subscription),
      (locations, journeys, segments) => buildJourneyDayData(
        locationPoints: locations,
        journeys: journeys,
        dwells: segments,
        geofences: geofences,
      ),
    );
  }

  /// One-shot fetch for compare mode and share exports.
  Future<JourneyDayData> fetchDayJourneyData(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
    List<Geofence> geofences = const [],
  }) {
    return watchDayJourneyData(
      imei,
      day,
      subscription: subscription,
      geofences: geofences,
    ).first;
  }

  /// One-shot fetch for compare mode and share exports.
  Future<List<LocationHistoryPoint>> fetchDayHistory(
    String imei,
    DateTime day, {
    required GuardianSubscription subscription,
  }) {
    return watchDayHistory(imei, day, subscription: subscription).first;
  }

  /// Returns calendar days (midnight local) that have at least one location fix
  /// within [lookbackDays] ending today ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â used by Journey Time Machine memories.
  Future<Set<DateTime>> fetchDaysWithHistory(
    String imei, {
    required GuardianSubscription subscription,
    int lookbackDays = 60,
  }) async {
    if (!subscription.has(GuardianFeature.locationHistory)) {
      throw StateError('Location history is unavailable for this family plan.');
    }
    final today = DateTime.now();
    final permittedLookback = subscription.locationHistoryDays;
    final effectiveLookback = permittedLookback == null
        ? lookbackDays
        : lookbackDays.clamp(1, permittedLookback).toInt();
    final start = DateTime(
      today.year,
      today.month,
      today.day,
    ).subtract(Duration(days: effectiveLookback - 1));
    final end = DateTime(today.year, today.month, today.day, 23, 59, 59);

    final snap = await _db
        .collection('devices')
        .doc(imei)
        .collection('locations')
        .where('recordedAt', isGreaterThanOrEqualTo: Timestamp.fromDate(start))
        .where('recordedAt', isLessThanOrEqualTo: Timestamp.fromDate(end))
        .orderBy('recordedAt')
        .get();

    final days = <DateTime>{};
    for (final doc in snap.docs) {
      final ts = doc.data()['recordedAt'];
      if (ts is! Timestamp) continue;
      final dt = ts.toDate();
      days.add(DateTime(dt.year, dt.month, dt.day));
    }

    final journeySnap = await _db
        .collection('devices')
        .doc(imei)
        .collection('journeys')
        .where('startAt', isGreaterThanOrEqualTo: Timestamp.fromDate(start))
        .where('startAt', isLessThanOrEqualTo: Timestamp.fromDate(end))
        .orderBy('startAt')
        .get();

    for (final doc in journeySnap.docs) {
      final ts = doc.data()['startAt'];
      if (ts is! Timestamp) continue;
      final dt = ts.toDate();
      days.add(DateTime(dt.year, dt.month, dt.day));
    }

    return days;
  }

  void _requireHistoryAccess(GuardianSubscription subscription, DateTime day) {
    if (!subscription.canAccessHistoryDay(day)) {
      final limit = subscription.locationHistoryDays;
      throw StateError(
        limit == null
            ? 'Location history is unavailable for this family plan.'
            : 'This plan includes only the most recent $limit days of location history.',
      );
    }
  }

  /// Streams one linked device so settings pages always use the latest
  /// Firestore care profile instead of a stale Device object passed by
  /// the previous screen.
  Stream<Device?> watchDevice(String imei) {
    return _watchLinkedImeis(_db, _auth).asyncExpand((linked) {
      if (!linked.contains(imei)) {
        return Stream.value(null);
      }

      return _db.collection('devices').doc(imei).snapshots().map((snap) {
        if (!snap.exists) return null;
        return Device.fromDoc(snap);
      });
    });
  }

  /// Streams only the devices this signed-in guardian is linked to.
  Stream<List<Device>> watchLinkedDevices() {
    return _watchLinkedImeis(_db, _auth).asyncExpand((linked) {
      if (linked.isEmpty) return Stream.value(const <Device>[]);
      return _db
          .collection('devices')
          .where(
            FieldPath.documentId,
            whereIn: linked.take(_maxWhereIn).toList(),
          )
          .snapshots()
          .map((snap) => snap.docs.map(Device.fromDoc).toList());
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
    return _watchLinkedImeis(_db, _auth).asyncExpand((linked) {
      if (linked.isEmpty) return Stream.value(const <Geofence>[]);
      return _db
          .collection('geofences')
          .where('imei', whereIn: linked.take(_maxWhereIn).toList())
          .snapshots()
          .map((snap) => snap.docs.map(Geofence.fromDoc).toList());
    });
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

/// V46/V48/V52 only. The device has no "list my reminders" query command,
/// so this collection is the app's own record of what's been scheduled ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â
/// saving or deleting also enqueues a matching `set_medication_reminder`
/// deviceCommand so the watch itself stays in sync (see
/// DeviceCommandService.setMedicationReminder and gateway/src/commands.js).
class MedicationReminderService {
  MedicationReminderService({FirebaseFirestore? db, FirebaseAuth? auth})
    : _db = db ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Stream<List<MedicationReminder>> watchForDevice(
    String imei, {
    required GuardianSubscription subscription,
  }) {
    _requireCare(subscription);
    return _db
        .collection('medicationReminders')
        .where('imei', isEqualTo: imei)
        .snapshots()
        .map(
          (snap) =>
              snap.docs.map(MedicationReminder.fromDoc).toList()
                ..sort((a, b) => a.time.compareTo(b.time)),
        );
  }

  Future<void> create({
    required GuardianSubscription subscription,
    required String imei,
    required String time,
    required int frequency,
    required String text,
    String? week,
  }) async {
    _requireCare(subscription);
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Not signed in');

    await _db.collection('medicationReminders').add({
      'imei': imei,
      'time': time,
      'frequency': frequency,
      'week': frequency == 3 ? week : null,
      'text': text.trim(),
      'enabled': true,
      'createdBy': uid,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
    });

    await DeviceCommandService(db: _db, auth: _auth).setMedicationReminder(
      imei,
      time: time,
      frequency: frequency,
      week: week,
      text: text,
    );
  }

  Future<void> setEnabled(
    MedicationReminder reminder,
    bool enabled, {
    required GuardianSubscription subscription,
  }) async {
    _requireCare(subscription);
    await _db.collection('medicationReminders').doc(reminder.id).update({
      'enabled': enabled,
      'updatedAt': FieldValue.serverTimestamp(),
    });

    await DeviceCommandService(db: _db, auth: _auth).setMedicationReminder(
      reminder.imei,
      time: reminder.time,
      frequency: reminder.frequency,
      week: reminder.week,
      text: reminder.text,
      enabled: enabled,
    );
  }

  Future<void> delete(
    String id, {
    required GuardianSubscription subscription,
    String? imei,
  }) async {
    _requireCare(subscription);
    // Delete from app's record
    await _db.collection('medicationReminders').doc(id).delete();

    // Also delete from device's reminder collection (where scheduler reads from)
    if (imei != null) {
      await _db
          .collection('devices')
          .doc(imei)
          .collection('reminders')
          .doc(id)
          .delete();
    }
  }

  void _requireCare(GuardianSubscription subscription) {
    if (!subscription.has(GuardianFeature.medicationReminders)) {
      throw StateError('Medication reminders require Guardian Care.');
    }
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

  Stream<String?> watchAvatarUrl() {
    Stream<User?> authEvents() async* {
      yield _auth.currentUser;
      yield* _auth.authStateChanges();
    }

    return authEvents().asyncExpand((user) {
      if (user == null) return Stream.value(null);
      return _db.collection('users').doc(user.uid).snapshots().map((snap) {
        final value = (snap.data()?['avatarUrl'] as String?)?.trim();
        return value == null || value.isEmpty ? null : value;
      });
    });
  }

  Future<void> updateAvatarUrl(String? avatarUrl) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Not signed in');
    final trimmed = avatarUrl?.trim();
    await _db.collection('users').doc(uid).set({
      'avatarUrl': trimmed == null || trimmed.isEmpty
          ? FieldValue.delete()
          : trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Stream<GuardianSubscription> watchSubscription() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) {
      return Stream.value(
        const GuardianSubscription.inactive(reason: 'not_signed_in'),
      );
    }

    late StreamController<GuardianSubscription> controller;
    StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? ownerSub;
    StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? planSub;

    controller = StreamController<GuardianSubscription>(
      onListen: () {
        ownerSub = _db.collection('users').doc(uid).snapshots().listen((
          snap,
        ) async {
          await planSub?.cancel();
          final rawOwner = (snap.data()?['serviceOwnerUid'] as String?)?.trim();
          final ownerUid = rawOwner == null || rawOwner.isEmpty
              ? uid
              : rawOwner;
          planSub = _db
              .collection('serviceSubscriptions')
              .doc(ownerUid)
              .snapshots()
              .listen((planSnap) {
                controller.add(
                  GuardianSubscription.fromMap(
                    planSnap.data(),
                    ownerUid: ownerUid,
                  ),
                );
              }, onError: controller.addError);
        }, onError: controller.addError);
      },
      onCancel: () async {
        await ownerSub?.cancel();
        await planSub?.cancel();
      },
    );
    return controller.stream;
  }

  Future<GuardianSubscription> getSubscription() => watchSubscription().first;

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

  Future<void> sendHelpAlert({required String imei, String? deviceName}) async {
    final uid = _auth.currentUser?.uid;
    await _db.collection('alerts').add({
      'imei': imei,
      'type': 'sos',
      'severity': 'critical',
      'message': 'Help requested for ${deviceName ?? imei}',
      'resolved': false,
      'notifyStatus': 'pending',
      'payload': {'source': 'app', 'requestedBy': ?uid},
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> resolve(String alertId) async {
    await _db.collection('alerts').doc(alertId).update({
      'resolved': true,
      'resolvedAt': FieldValue.serverTimestamp(),
    });
  }

  /// Streams recent alerts for devices this signed-in guardian is linked to.
  Stream<List<GuardianAlert>> watchLinkedAlerts({int limit = 100}) {
    return _watchLinkedImeis(_db, _auth).asyncExpand((linked) {
      if (linked.isEmpty) return Stream.value(const <GuardianAlert>[]);
      return _db
          .collection('alerts')
          .where('imei', whereIn: linked.take(_maxWhereIn).toList())
          .orderBy('createdAt', descending: true)
          .limit(limit)
          .snapshots()
          .map((snap) => snap.docs.map(GuardianAlert.fromDoc).toList());
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
      linkedImeis:
          (data['linkedImeis'] as List?)?.whereType<String>().toList() ??
          const [],
      acceptedByName: data['acceptedByName'] as String?,
    );
  }
}

class FamilyJoinRequest {
  const FamilyJoinRequest({
    required this.id,
    required this.inviteCode,
    required this.status,
    this.reason,
  });

  final String id;
  final String inviteCode;
  final String status;
  final String? reason;

  factory FamilyJoinRequest.fromDoc(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data() ?? const <String, dynamic>{};
    return FamilyJoinRequest(
      id: doc.id,
      inviteCode: (data['inviteCode'] as String?) ?? '',
      status: (data['status'] as String?) ?? 'pending',
      reason: data['reason'] as String?,
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
          final now = DateTime.now();
          final list = snap.docs
              .where((doc) {
                final data = doc.data();
                final status = data['status'] as String? ?? 'pending';
                final expiresAt = data['expiresAt'];
                if (status != 'pending') return true;
                if (expiresAt is! Timestamp) return true;
                return expiresAt.toDate().isAfter(now);
              })
              .map(FamilyInvite.fromDoc)
              .toList();
          list.sort((a, b) => a.code.compareTo(b.code));
          return list;
        });
  }

  Stream<List<FamilyJoinRequest>> watchMyJoinRequests() {
    final uid = _auth.currentUser?.uid;
    if (uid == null) return Stream.value(const []);
    return _db
        .collection('familyJoinRequests')
        .where('requestedBy', isEqualTo: uid)
        .snapshots()
        .map(
          (snap) =>
              snap.docs.map(FamilyJoinRequest.fromDoc).toList(growable: false),
        );
  }

  Future<String> createInviteCode() async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final subscription = await UserProfileService(
      db: _db,
      auth: _auth,
    ).getSubscription();
    if (!subscription.serviceActive) {
      throw StateError('Guardian service is not active for this family.');
    }
    if (subscription.ownerUid != user.uid) {
      throw StateError('Only the family plan owner can invite caregivers.');
    }

    final ownerDoc = await _db.collection('users').doc(user.uid).get();
    final memberUids =
        (ownerDoc.data()?['memberUids'] as List?)
            ?.whereType<String>()
            .map((value) => value.trim())
            .where((value) => value.isNotEmpty)
            .toSet() ??
        const <String>{};
    if (memberUids.length >= subscription.caregiverLimit) {
      throw StateError(
        '${subscription.planLabel} includes up to ${subscription.caregiverLimit} caregiver${subscription.caregiverLimit == 1 ? '' : 's'}.',
      );
    }

    for (var attempt = 0; attempt < 5; attempt++) {
      final code = _generateCode();
      try {
        // The code is also the document id. Firestore rules deny updates, so
        // the extremely unlikely collision fails instead of replacing another
        // family's invitation.
        await _db.collection('invites').doc(code).set({
          'code': code,
          'createdBy': user.uid,
          'createdByName': user.displayName?.trim().isNotEmpty == true
              ? user.displayName!.trim()
              : (user.email ?? 'Guardian'),
          'createdByEmail': user.email,
          'status': 'pending',
          'createdAt': FieldValue.serverTimestamp(),
          'expiresAt': Timestamp.fromDate(
            DateTime.now().add(const Duration(days: 7)),
          ),
        });
        return code;
      } catch (_) {
        if (attempt == 4) rethrow;
      }
    }
    throw StateError('Could not create a unique invite code');
  }

  Future<void> acceptInviteCode(String rawCode) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('Not signed in');

    final code = rawCode.trim().toUpperCase();
    if (!RegExp(r'^[A-Z0-9]{6}$').hasMatch(code)) {
      throw StateError('Enter a valid 6-character invite code');
    }

    // The client never reads the invitation or grants itself watches, family
    // membership or a service owner. The gateway validates the invitation,
    // active plan and caregiver capacity before applying those backend-owned
    // fields in a transaction.
    await _db.collection('familyJoinRequests').add({
      'inviteCode': code,
      'requestedBy': user.uid,
      'status': 'pending',
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}

/// Writes app-originated commands for the gateway to deliver to a watch by
/// SMS (see gateway/src/commands.js). Center number, SOS numbers, and status
/// check are from the vendor's own manual; voice monitoring is documented
/// only for the closely related RF-V28 by a third-party source, not verified
/// against this exact device ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â see the comment in commands.js.
String _normalisePhoneForSafety(String value) {
  return value.replaceAll(RegExp(r'[^0-9]'), '');
}

class DeviceCommandService {
  DeviceCommandService({FirebaseFirestore? db, FirebaseAuth? auth})
    : _db = db ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _db;
  final FirebaseAuth _auth;

  Future<void> _enqueue(
    String imei,
    String type,
    Map<String, dynamic> params,
  ) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('Not signed in');
    await _db.collection('deviceCommands').add({
      'imei': imei,
      'type': type,
      'params': params,
      'status': 'pending',
      'createdBy': uid,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  Future<void> setCenterNumber(String imei, String phone) {
    return _enqueue(imei, 'set_center_number', {'phone': phone.trim()});
  }

  Future<void> setSosNumber(String imei, int slot, String phone) async {
    final trimmed = phone.trim();
    if (trimmed.isEmpty) {
      throw StateError('Choose a valid emergency contact');
    }

    final watch = await _db.collection('devices').doc(imei).get();
    final watchSim = (watch.data()?['simNumber'] as String?)?.trim();
    final sosDigits = _normalisePhoneForSafety(trimmed);
    final simDigits = _normalisePhoneForSafety(watchSim ?? '');

    if (watchSim != null &&
        watchSim.isNotEmpty &&
        sosDigits.isNotEmpty &&
        sosDigits == simDigits) {
      throw StateError(
        "SOS contact cannot be the watch's own SIM number. Choose a family member or emergency contact.",
      );
    }

    await _enqueue(imei, 'set_sos_number', {'slot': slot, 'phone': trimmed});
  }

  Future<void> checkStatus(String imei) {
    return _enqueue(imei, 'check_status', const {});
  }

  /// Triggers the watch to silently call [listenerPhone] for one-way
  /// listening. Unverified against the V28C specifically ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â see class doc.
  Future<void> startVoiceMonitor(String imei, String listenerPhone) {
    return _enqueue(imei, 'voice_monitor', {'phone': listenerPhone.trim()});
  }

  /// Makes the watch sound an audible alert so it can be found. Unverified
  /// against the V28C specifically ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â see class doc.
  Future<void> ringToFind(String imei) {
    return _enqueue(imei, 'ring_to_find', const {});
  }

  /// V46/V48/V52 only ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â TCP downlink, no SMS equivalent exists. Requires the
  /// device to currently hold a live connection to the gateway; fails
  /// clearly (not silently) if it doesn't. See gateway/src/commands.js.
  Future<void> setFallDetection(
    String imei, {
    required bool enabled,
    bool dialMonitorOnFall = false,
  }) {
    return _enqueue(imei, 'set_fall_detection', {
      'enabled': enabled,
      'dialMonitorOnFall': dialMonitorOnFall,
    });
  }

  /// V46/V48/V52 only. [level] is 0-6.
  Future<void> setFallSensitivity(String imei, int level) {
    return _enqueue(imei, 'set_fall_sensitivity', {'level': level});
  }

  /// V46/V48/V52 only. [time] is 'HH:MM'; [frequency] is 1 (once), 2
  /// (daily), or 3 (weekly, requires [week] as a 7-digit Sun->Sat mask).
  Future<void> setMedicationReminder(
    String imei, {
    required String time,
    required int frequency,
    required String text,
    String? week,
    bool enabled = true,
  }) {
    return _enqueue(imei, 'set_medication_reminder', {
      'time': time,
      'frequency': frequency,
      'text': text.trim(),
      if (frequency == 3) 'week': week,
      'enabled': enabled,
    });
  }

  /// V46/V48/V52 only. Sets the pendant's standing location-reporting
  /// interval so it keeps sending fresh fixes on its own, instead of
  /// falling back to its long, irregular default between fixes. [seconds]
  /// is a UX guardrail (10-3600), not a vendor-documented limit.
  Future<void> setUploadInterval(String imei, int seconds) {
    return _enqueue(imei, 'set_upload_interval', {'seconds': seconds});
  }
}
