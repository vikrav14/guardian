import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_services.dart';

void main() {
  group('DeviceService.watchLinkedDevices', () {
    test('only returns devices in the signed-in user\'s linkedImeis', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('users').doc('u1').set({'linkedImeis': ['AAA']});
      await db.collection('devices').doc('AAA').set({'online': true});
      await db.collection('devices').doc('BBB').set({'online': true});

      final devices = await DeviceService(db: db, auth: auth).watchLinkedDevices().first;

      expect(devices.map((d) => d.imei).toList(), ['AAA']);
    });

    test('returns an empty list (not an error) when linkedImeis is empty', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('users').doc('u1').set({'linkedImeis': []});

      final devices = await DeviceService(db: db, auth: auth).watchLinkedDevices().first;

      expect(devices, isEmpty);
    });

    test('renameDevice sets name and clears it when blank', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('devices').doc('AAA').set({'name': 'Old'});

      await DeviceService(db: db, auth: auth).renameDevice('AAA', 'New name');
      var doc = await db.collection('devices').doc('AAA').get();
      expect(doc.data()!['name'], 'New name');

      await DeviceService(db: db, auth: auth).renameDevice('AAA', '   ');
      doc = await db.collection('devices').doc('AAA').get();
      expect(doc.data()!.containsKey('name'), false);
    });
  });

  group('GeofenceService', () {
    test('watchAll filters by the linked IMEI set', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('users').doc('u1').set({'linkedImeis': ['AAA']});
      await db.collection('geofences').add({'imei': 'AAA', 'name': 'Home', 'center': {'lat': 0, 'lng': 0}});
      await db.collection('geofences').add({'imei': 'BBB', 'name': 'Other', 'center': {'lat': 0, 'lng': 0}});

      final zones = await GeofenceService(db: db, auth: auth).watchAll().first;

      expect(zones.map((z) => z.imei).toList(), ['AAA']);
    });

    test('create stores wifiSsid as null when blank, and trimmed when set', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      final service = GeofenceService(db: db, auth: auth);

      await service.create(imei: 'AAA', name: 'Home', lat: 1, lng: 2, radiusMeters: 100, wifiSsid: '  ');
      await service.create(imei: 'AAA', name: 'Work', lat: 3, lng: 4, radiusMeters: 100, wifiSsid: ' Office WiFi ');

      final snap = await db.collection('geofences').orderBy('name').get();
      expect(snap.docs[0].data()['wifiSsid'], isNull);
      expect(snap.docs[1].data()['wifiSsid'], 'Office WiFi');
    });

    test('create throws when not signed in', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(signedIn: false);

      expect(
        () => GeofenceService(db: db, auth: auth).create(imei: 'AAA', name: 'Home', lat: 0, lng: 0, radiusMeters: 100),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('AlertService', () {
    test('sendHelpAlert writes a pending critical sos alert', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);

      await AlertService(db: db, auth: auth).sendHelpAlert(imei: 'AAA', deviceName: 'Mum');

      final snap = await db.collection('alerts').get();
      final data = snap.docs.single.data();
      expect(data['imei'], 'AAA');
      expect(data['type'], 'sos');
      expect(data['severity'], 'critical');
      expect(data['resolved'], false);
      expect(data['notifyStatus'], 'pending');
    });

    test('resolve sets resolved=true', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      final ref = await db.collection('alerts').add({'resolved': false});

      await AlertService(db: db, auth: auth).resolve(ref.id);

      final doc = await ref.get();
      expect(doc.data()!['resolved'], true);
    });
  });

  group('UserProfileService', () {
    test('watchSubscription defaults to free when no subscription field exists', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('users').doc('u1').set({});

      final sub = await UserProfileService(db: db, auth: auth).watchSubscription().first;

      expect(sub.tier, 'free');
      expect(sub.isPremium, false);
    });

    test('watchSubscription reports premium only when not canceled', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      await db.collection('users').doc('u1').set({
        'subscription': {'tier': 'premium', 'status': 'canceled'},
      });

      final sub = await UserProfileService(db: db, auth: auth).watchSubscription().first;

      expect(sub.tier, 'premium');
      expect(sub.isPremium, false, reason: 'a canceled premium subscription should not read as active');
    });

    test('saveContacts round-trips emergency contacts', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);
      final service = UserProfileService(db: db, auth: auth);

      await service.saveContacts(const [
        EmergencyContact(name: 'Dad', phone: '+23057123456'),
      ]);
      final contacts = await service.watchContacts().first;

      expect(contacts.single.name, 'Dad');
      expect(contacts.single.phone, '+23057123456');
    });
  });

  group('FamilyService invite flow', () {
    test('acceptInviteCode links the inviter\'s devices to the accepting user', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('invites').add({
        'code': 'AB12CD',
        'createdBy': 'inviter-uid',
        'createdByName': 'Dad',
        'status': 'pending',
        'linkedImeis': ['AAA', 'BBB'],
      });
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'acceptor-uid'), signedIn: true);
      await db.collection('users').doc('acceptor-uid').set({'linkedImeis': []});

      await FamilyService(db: db, auth: auth).acceptInviteCode('ab12cd');

      final acceptorDoc = await db.collection('users').doc('acceptor-uid').get();
      expect(acceptorDoc.data()!['linkedImeis'], containsAll(['AAA', 'BBB']));
      final invites = await db.collection('invites').where('code', isEqualTo: 'AB12CD').get();
      expect(invites.docs.single.data()['status'], 'accepted');
    });

    test('acceptInviteCode rejects accepting your own invite', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('invites').add({
        'code': 'SELF01',
        'createdBy': 'u1',
        'status': 'pending',
        'linkedImeis': <String>[],
      });
      final auth = MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true);

      expect(
        () => FamilyService(db: db, auth: auth).acceptInviteCode('SELF01'),
        throwsA(isA<StateError>()),
      );
    });
  });
}
