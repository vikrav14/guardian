import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_services.dart';

void main() {
  group('DeviceService.watchLinkedDevices', () {
    test('only returns devices in the signed-in user\'s linkedImeis', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('users').doc('u1').set({
        'linkedImeis': ['AAA'],
      });
      await db.collection('devices').doc('AAA').set({'online': true});
      await db.collection('devices').doc('BBB').set({'online': true});

      final devices = await DeviceService(
        db: db,
        auth: auth,
      ).watchLinkedDevices().first;

      expect(devices.map((d) => d.imei).toList(), ['AAA']);
    });

    test(
      'returns an empty list (not an error) when linkedImeis is empty',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({'linkedImeis': []});

        final devices = await DeviceService(
          db: db,
          auth: auth,
        ).watchLinkedDevices().first;

        expect(devices, isEmpty);
      },
    );

    test(
      'normalizes 10-digit protocol ids in linkedImeis to 15-digit docs',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({
          'linkedImeis': ['9705314117'],
        });
        await db.collection('devices').doc('861397053141170').set({
          'online': true,
          'batteryPercent': 72,
        });

        final devices = await DeviceService(
          db: db,
          auth: auth,
        ).watchLinkedDevices().first;

        expect(devices, hasLength(1));
        expect(devices.single.imei, '861397053141170');
        expect(devices.single.batteryPercent, 72);
      },
    );

    test(
      'linkPendant adds a normalized 15-digit IMEI to linkedImeis',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({'linkedImeis': []});

        await DeviceService(db: db, auth: auth).linkPendant('861397053141170');

        final doc = await db.collection('users').doc('u1').get();
        expect(doc.data()!['linkedImeis'], ['861397053141170']);
      },
    );

    test(
      'linkPendant normalizes 10-digit protocol ids before linking',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({'linkedImeis': []});

        await DeviceService(db: db, auth: auth).linkPendant('9705314117');

        final doc = await db.collection('users').doc('u1').get();
        expect(doc.data()!['linkedImeis'], ['861397053141170']);
      },
    );

    test('linkPendant rejects invalid IMEI input', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );

      expect(
        () => DeviceService(db: db, auth: auth).linkPendant('123'),
        throwsA(isA<StateError>()),
      );
    });

    test(
      'unlinkPendant removes a linked IMEI without deleting the device doc',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({
          'linkedImeis': ['861397053141170', '861397053139877'],
        });
        await db.collection('devices').doc('861397053139877').set({
          'online': true,
          'batteryPercent': 80,
        });

        await DeviceService(
          db: db,
          auth: auth,
        ).unlinkPendant('861397053139877');

        final userDoc = await db.collection('users').doc('u1').get();
        expect(userDoc.data()!['linkedImeis'], ['861397053141170']);
        final deviceDoc = await db
            .collection('devices')
            .doc('861397053139877')
            .get();
        expect(deviceDoc.exists, isTrue);
      },
    );

    test('renameDevice sets name and clears it when blank', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('devices').doc('AAA').set({'name': 'Old'});

      await DeviceService(db: db, auth: auth).renameDevice('AAA', 'New name');
      var doc = await db.collection('devices').doc('AAA').get();
      expect(doc.data()!['name'], 'New name');

      await DeviceService(db: db, auth: auth).renameDevice('AAA', '   ');
      doc = await db.collection('devices').doc('AAA').get();
      expect(doc.data()!.containsKey('name'), false);
    });

    test('updatePersonIdentity stores nickname and relationship', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('devices').doc('AAA').set({'online': true});
      final service = DeviceService(db: db, auth: auth);

      await service.updatePersonIdentity(
        'AAA',
        nickname: ' Mimi ',
        relationship: ' Mum ',
      );
      var data = (await db.collection('devices').doc('AAA').get()).data()!;
      expect(data['nickname'], 'Mimi');
      expect(data['relationship'], 'Mum');

      await service.updatePersonIdentity(
        'AAA',
        nickname: ' ',
        relationship: 'Dad',
      );
      data = (await db.collection('devices').doc('AAA').get()).data()!;
      expect(data.containsKey('nickname'), false);
      expect(data['relationship'], 'Dad');
    });

    test('updateAvatarUrl stores and removes the photo URL', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('devices').doc('AAA').set({'online': true});
      final service = DeviceService(db: db, auth: auth);

      await service.updateAvatarUrl('AAA', ' https://example.com/avatar.jpg ');
      var data = (await db.collection('devices').doc('AAA').get()).data()!;
      expect(data['avatarUrl'], 'https://example.com/avatar.jpg');

      await service.updateAvatarUrl('AAA', null);
      data = (await db.collection('devices').doc('AAA').get()).data()!;
      expect(data.containsKey('avatarUrl'), false);
    });

    test('Care profile writes require a verified Care subscription', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('devices').doc('AAA').set({'online': true});
      final service = DeviceService(db: db, auth: auth);
      GuardianSubscription plan(String name) => GuardianSubscription.fromMap({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': name,
        'status': 'active',
      });

      expect(
        () => service.updateCareProfile(
          'AAA',
          subscription: plan('family'),
          careProfile: 'senior',
          carePriorities: const ['wellbeing'],
        ),
        throwsA(isA<StateError>()),
      );
      await service.updateCareProfile(
        'AAA',
        subscription: plan('care'),
        careProfile: 'senior',
        carePriorities: const ['wellbeing'],
      );
      final data = (await db.collection('devices').doc('AAA').get()).data()!;
      expect(data['careProfile'], 'senior');
    });
  });

  group('DeviceService.watchDayHistory', () {
    GuardianSubscription plan(String name) => GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'plan': name,
      'status': 'active',
    });

    test('only returns points recorded within the given day', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      final locations = db
          .collection('devices')
          .doc('AAA')
          .collection('locations');
      await locations.add({
        'lat': 1,
        'lng': 1,
        'recordedAt': Timestamp.fromDate(DateTime(2026, 7, 16, 23, 0)),
      });
      await locations.add({
        'lat': 2,
        'lng': 2,
        'recordedAt': Timestamp.fromDate(DateTime(2026, 7, 17, 10, 0)),
      });
      await locations.add({
        'lat': 3,
        'lng': 3,
        'recordedAt': Timestamp.fromDate(DateTime(2026, 7, 18, 1, 0)),
      });

      final points = await DeviceService(db: db, auth: auth)
          .watchDayHistory(
            'AAA',
            DateTime(2026, 7, 17),
            subscription: GuardianSubscription.fromMap({
              'version': 1,
              'managedBy': 'guardian_admin',
              'plan': 'family',
              'status': 'active',
            }),
          )
          .first;

      expect(points.length, 1);
      expect(points.single.lat, 2);
    });

    test('orders points chronologically', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      final locations = db
          .collection('devices')
          .doc('AAA')
          .collection('locations');
      await locations.add({
        'lat': 2,
        'lng': 2,
        'recordedAt': Timestamp.fromDate(DateTime(2026, 7, 17, 12, 0)),
      });
      await locations.add({
        'lat': 1,
        'lng': 1,
        'recordedAt': Timestamp.fromDate(DateTime(2026, 7, 17, 8, 0)),
      });

      final points = await DeviceService(db: db, auth: auth)
          .watchDayHistory(
            'AAA',
            DateTime(2026, 7, 17),
            subscription: GuardianSubscription.fromMap({
              'version': 1,
              'managedBy': 'guardian_admin',
              'plan': 'family',
              'status': 'active',
            }),
          )
          .first;

      expect(points.map((p) => p.lat).toList(), [1, 2]);
    });

    test('fails closed before querying history outside the plan window', () {
      final service = DeviceService(
        db: FakeFirebaseFirestore(),
        auth: MockFirebaseAuth(mockUser: MockUser(uid: 'u1'), signedIn: true),
      );
      final oldDay = DateTime.now().subtract(const Duration(days: 30));

      expect(
        () => service.watchDayHistory(
          'AAA',
          oldDay,
          subscription: plan('essential'),
        ),
        throwsA(isA<StateError>()),
      );
      expect(
        () => service.watchDayHistory(
          'AAA',
          oldDay,
          subscription: plan('family'),
        ),
        returnsNormally,
      );
    });
  });

  group('MedicationReminderService entitlement', () {
    GuardianSubscription plan(String name) => GuardianSubscription.fromMap({
      'version': 1,
      'managedBy': 'guardian_admin',
      'plan': name,
      'status': 'active',
    });

    test(
      'Family is rejected before a reminder or command is written',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        final service = MedicationReminderService(db: db, auth: auth);

        expect(
          () => service.create(
            subscription: plan('family'),
            imei: 'AAA',
            time: '08:00',
            frequency: 2,
            text: 'Tablets',
          ),
          throwsA(isA<StateError>()),
        );
        expect(
          (await db.collection('medicationReminders').get()).docs,
          isEmpty,
        );
        expect((await db.collection('deviceCommands').get()).docs, isEmpty);
      },
    );

    test(
      'Care can create a reminder and corresponding watch command',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );

        await MedicationReminderService(db: db, auth: auth).create(
          subscription: plan('care'),
          imei: 'AAA',
          time: '08:00',
          frequency: 2,
          text: 'Tablets',
        );

        expect(
          (await db.collection('medicationReminders').get()).docs,
          hasLength(1),
        );
        expect(
          (await db.collection('deviceCommands').get()).docs,
          hasLength(1),
        );
      },
    );
  });

  group('UserProfileService avatar', () {
    test(
      'watches, stores, and removes the signed-in guardian avatar',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({'linkedImeis': []});
        final service = UserProfileService(db: db, auth: auth);

        expect(await service.watchAvatarUrl().first, isNull);

        await service.updateAvatarUrl(' https://example.com/guardian.jpg ');
        expect(
          await service.watchAvatarUrl().first,
          'https://example.com/guardian.jpg',
        );

        await service.updateAvatarUrl(null);
        final data = (await db.collection('users').doc('u1').get()).data()!;
        expect(data.containsKey('avatarUrl'), false);
      },
    );

    test('follows auth state changes before reading Firestore', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: false,
      );
      final service = UserProfileService(db: db, auth: auth);

      final values = <String?>[];
      final sub = service.watchAvatarUrl().listen(values.add);
      await Future<void>.delayed(Duration.zero);
      expect(values.first, isNull);

      await db.collection('users').doc('u1').set({
        'linkedImeis': [],
        'avatarUrl': 'https://example.com/guardian.jpg',
      });
      auth.signInWithEmailAndPassword(
        email: 'guardian@example.com',
        password: 'secret',
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(values.last, 'https://example.com/guardian.jpg');
      await sub.cancel();
    });

    test('rejects updates when signed out', () async {
      final service = UserProfileService(
        db: FakeFirebaseFirestore(),
        auth: MockFirebaseAuth(signedIn: false),
      );

      expect(
        service.updateAvatarUrl('https://example.com/a.jpg'),
        throwsStateError,
      );
    });
  });

  group('GeofenceService', () {
    test('watchAll filters by the linked IMEI set', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('users').doc('u1').set({
        'linkedImeis': ['AAA'],
      });
      await db.collection('geofences').add({
        'imei': 'AAA',
        'name': 'Home',
        'center': {'lat': 0, 'lng': 0},
      });
      await db.collection('geofences').add({
        'imei': 'BBB',
        'name': 'Other',
        'center': {'lat': 0, 'lng': 0},
      });

      final zones = await GeofenceService(db: db, auth: auth).watchAll().first;

      expect(zones.map((z) => z.imei).toList(), ['AAA']);
    });

    test(
      'create stores wifiSsid as null when blank, and trimmed when set',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        final service = GeofenceService(db: db, auth: auth);

        await service.create(
          imei: 'AAA',
          name: 'Home',
          lat: 1,
          lng: 2,
          radiusMeters: 100,
          wifiSsid: '  ',
        );
        await service.create(
          imei: 'AAA',
          name: 'Work',
          lat: 3,
          lng: 4,
          radiusMeters: 100,
          wifiSsid: ' Office WiFi ',
        );

        final snap = await db.collection('geofences').orderBy('name').get();
        expect(snap.docs[0].data()['wifiSsid'], isNull);
        expect(snap.docs[1].data()['wifiSsid'], 'Office WiFi');
      },
    );

    test('create throws when not signed in', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(signedIn: false);

      expect(
        () => GeofenceService(
          db: db,
          auth: auth,
        ).create(imei: 'AAA', name: 'Home', lat: 0, lng: 0, radiusMeters: 100),
        throwsA(isA<StateError>()),
      );
    });
  });

  group('AlertService', () {
    test('sendHelpAlert writes a pending critical sos alert', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );

      await AlertService(
        db: db,
        auth: auth,
      ).sendHelpAlert(imei: 'AAA', deviceName: 'Mum');

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
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      final ref = await db.collection('alerts').add({'resolved': false});

      await AlertService(db: db, auth: auth).resolve(ref.id);

      final doc = await ref.get();
      expect(doc.data()!['resolved'], true);
    });
  });

  group('DeviceService.watchDayJourneys', () {
    test('keeps valid journeys when another document is malformed', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      final journeys = db
          .collection('devices')
          .doc('AAA')
          .collection('journeys');
      final start = DateTime(2026, 8, 21, 8);

      await journeys.doc('valid').set({
        'startAt': Timestamp.fromDate(start),
        'endAt': Timestamp.fromDate(start.add(const Duration(minutes: 20))),
        'polyline': 'encoded',
        'distanceKm': 3.2,
        'pointCount': 4,
        'compressed': true,
      });
      await journeys.doc('malformed').set({
        'startAt': Timestamp.fromDate(start.add(const Duration(hours: 1))),
        'endAt': Timestamp.fromDate(start.add(const Duration(hours: 2))),
        'polyline': 'encoded',
        'distanceKm': 2,
        'pointCount': 3,
        'compressed': 'yes',
      });

      final records = await DeviceService(db: db, auth: auth)
          .watchDayJourneys(
            'AAA',
            DateTime(2026, 8, 21),
            subscription: GuardianSubscription.fromMap({
              'version': 1,
              'managedBy': 'guardian_admin',
              'plan': 'family',
              'status': 'active',
            }),
          )
          .first;

      expect(records.map((record) => record.id), ['valid']);
    });
  });

  group('UserProfileService', () {
    test(
      'watchSubscription fails closed when no trusted subscription exists',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'u1'),
          signedIn: true,
        );
        await db.collection('users').doc('u1').set({});

        final sub = await UserProfileService(
          db: db,
          auth: auth,
        ).watchSubscription().first;

        expect(sub.serviceActive, false);
        expect(sub.plan, isNull);
      },
    );

    test('watchSubscription reads the backend-owned family plan', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
      await db.collection('users').doc('u1').set({'serviceOwnerUid': 'u1'});
      await db.collection('serviceSubscriptions').doc('u1').set({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': 'family',
        'status': 'active',
      });

      final sub = await UserProfileService(
        db: db,
        auth: auth,
      ).watchSubscription().first;

      expect(sub.serviceActive, true);
      expect(sub.plan, GuardianPlan.family);
      expect(sub.has(GuardianFeature.whatsappQuestionsAnswers), true);
      expect(sub.has(GuardianFeature.medicationReminders), false);
    });

    test('watchSubscription follows a family service owner', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'member'),
        signedIn: true,
      );
      await db.collection('users').doc('member').set({
        'serviceOwnerUid': 'owner',
      });
      await db.collection('serviceSubscriptions').doc('owner').set({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': 'care',
        'status': 'active',
      });

      final sub = await UserProfileService(
        db: db,
        auth: auth,
      ).watchSubscription().first;

      expect(sub.plan, GuardianPlan.care);
      expect(sub.ownerUid, 'owner');
    });

    test('saveContacts round-trips emergency contacts', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );
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
    test(
      'acceptInviteCode creates a pending server-verified join request',
      () async {
        final db = FakeFirebaseFirestore();
        final auth = MockFirebaseAuth(
          mockUser: MockUser(uid: 'acceptor-uid'),
          signedIn: true,
        );
        await db.collection('users').doc('acceptor-uid').set({
          'linkedImeis': [],
        });

        await FamilyService(db: db, auth: auth).acceptInviteCode('ab12cd');

        final requests = await db.collection('familyJoinRequests').get();
        expect(requests.docs, hasLength(1));
        expect(requests.docs.single.data()['inviteCode'], 'AB12CD');
        expect(requests.docs.single.data()['requestedBy'], 'acceptor-uid');
        expect(requests.docs.single.data()['status'], 'pending');

        final acceptorDoc = await db
            .collection('users')
            .doc('acceptor-uid')
            .get();
        expect(acceptorDoc.data()!['linkedImeis'], isEmpty);
      },
    );

    test('acceptInviteCode rejects malformed codes before any write', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'u1'),
        signedIn: true,
      );

      expect(
        () => FamilyService(db: db, auth: auth).acceptInviteCode('bad'),
        throwsA(isA<StateError>()),
      );
      expect((await db.collection('familyJoinRequests').get()).docs, isEmpty);
    });

    test('createInviteCode stores a non-overwritable code document', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(
          uid: 'owner',
          email: 'owner@example.com',
          displayName: 'Owner',
        ),
        signedIn: true,
      );
      await db.collection('users').doc('owner').set({
        'serviceOwnerUid': 'owner',
        'memberUids': <String>[],
      });
      await db.collection('serviceSubscriptions').doc('owner').set({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': 'essential',
        'status': 'active',
      });
      final code = await FamilyService(db: db, auth: auth).createInviteCode();
      final invite = await db.collection('invites').doc(code).get();

      expect(code, hasLength(6));
      expect(invite.exists, true);
      expect(invite.data()!['code'], code);
      expect(invite.data()!['createdBy'], 'owner');
      expect(invite.data()!.containsKey('linkedImeis'), false);
    });

    test('createInviteCode rejects a non-owner family member', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'member'),
        signedIn: true,
      );
      await db.collection('users').doc('member').set({
        'serviceOwnerUid': 'owner',
      });
      await db.collection('serviceSubscriptions').doc('owner').set({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': 'family',
        'status': 'active',
      });

      expect(
        () => FamilyService(db: db, auth: auth).createInviteCode(),
        throwsA(isA<StateError>()),
      );
    });

    test('createInviteCode enforces the caregiver limit', () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        mockUser: MockUser(uid: 'owner'),
        signedIn: true,
      );
      await db.collection('users').doc('owner').set({
        'serviceOwnerUid': 'owner',
        'memberUids': ['member'],
      });
      await db.collection('serviceSubscriptions').doc('owner').set({
        'version': 1,
        'managedBy': 'guardian_admin',
        'plan': 'essential',
        'status': 'active',
      });

      expect(
        () => FamilyService(db: db, auth: auth).createInviteCode(),
        throwsA(isA<StateError>()),
      );
    });
  });
}
