import 'dart:async';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_services.dart';

void main() {
  test(
    'wellbeing access without location retains the wearer and never selects their location projection',
    () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'member'),
      );
      await db.doc('users/member').set({
        'linkedImeis': ['A'],
        'familyAccess': {
          'A': {
            'owner': false,
            'permissions': {'wellbeing': true},
          },
        },
      });
      await db.doc('familyServices/A').set({
        'ownerUid': 'owner',
        'subscription': {
          'version': 1,
          'managedBy': 'guardian_admin',
          'plan': 'care',
          'status': 'active',
        },
      });
      await db.doc('familyDeviceProfiles/A').set({
        'nickname': 'Shared identity',
        'batteryPercent': 75,
      });
      await db.doc('familyDeviceViews/A').set({
        'nickname': 'Private location',
        'location': {'lat': -20.1, 'lng': 57.5},
      });
      final device = (await DeviceService(
        db: db,
        auth: auth,
      ).watchLinkedDevices().first).single;
      expect(device.nickname, 'Shared identity');
      expect(device.mapDisplayLocation, isNull);
      expect(device.allowsShared('wellbeing'), true);
      expect(device.allowsShared('location'), false);
    },
  );
  test(
    'each shared wearer retains their own plan and only the projected device is read',
    () async {
      final db = FakeFirebaseFirestore();
      final auth = MockFirebaseAuth(
        signedIn: true,
        mockUser: MockUser(uid: 'member'),
      );
      await db.doc('users/member').set({
        'linkedImeis': ['A', 'B'],
        'familyServiceImeis': ['A', 'B'],
        'familyAccess': {
          'A': {
            'owner': false,
            'permissions': {'location': true, 'settings': false},
          },
          'B': {
            'owner': false,
            'permissions': {'location': true, 'settings': false},
          },
        },
      });
      for (final (imei, plan) in [('A', 'family'), ('B', 'care')]) {
        await db.doc('familyServices/$imei').set({
          'ownerUid': 'owner',
          'subscription': {
            'version': 1,
            'managedBy': 'guardian_admin',
            'plan': plan,
            'status': 'active',
          },
        });
        await db.doc('familyDeviceViews/$imei').set({
          'nickname': 'Shared $imei',
          'batteryPercent': 75,
        });
        await db.doc('devices/$imei').set({
          'nickname': 'Private $imei',
          'stepsRaw': 123,
          'simNumber': 'private',
        });
      }
      final service = DeviceService(db: db, auth: auth);
      final devices = await service.watchLinkedDevices().first;
      expect(devices.map((d) => d.nickname), ['Shared A', 'Shared B']);
      expect(devices.map((d) => d.sharedSubscription?.plan), [
        GuardianPlan.family,
        GuardianPlan.care,
      ]);
      expect(
        devices.every(
          (d) =>
              d.simNumber == null &&
              d.stepsRaw == null &&
              !d.allowsShared('settings'),
        ),
        true,
      );
      final ready = Completer<void>(), cleared = Completer<void>();
      final subscription = service.watchLinkedDevices().listen((rows) {
        if (rows.isNotEmpty && !ready.isCompleted) ready.complete();
        if (ready.isCompleted && rows.isEmpty && !cleared.isCompleted) {
          cleared.complete();
        }
      });
      await ready.future;
      await db.doc('users/member').update({
        'familyAccess': {
          'A': {'owner': false, 'permissions': {}},
          'B': {'owner': false, 'permissions': {}},
        },
      });
      await cleared.future.timeout(const Duration(seconds: 3));
      await subscription.cancel();
      expect(await service.watchLinkedDevices().first, isEmpty);
    },
  );
}
