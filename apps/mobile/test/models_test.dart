import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/models/location_history_point.dart';

void main() {
  group('Device.fromDoc', () {
    test('parses a fully-populated device', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('devices').doc('123456789012345').set({
        'name': "Mum's pendant",
        'nickname': 'Mimi',
        'relationship': 'Mum',
        'online': true,
        'batteryPercent': 72,
        'speedKmh': 12,
        'course': 90,
        'accuracySource': 'gps',
        'location': {'lat': -20.2642, 'lng': 57.4791, 'satellites': 8},
        'simNumber': '+23057123456',
        'avatarUrl': 'https://example.com/avatar.jpg',
      });
      final doc = await db.collection('devices').doc('123456789012345').get();

      final device = Device.fromDoc(doc);

      expect(device.imei, '123456789012345');
      expect(device.displayName, 'Mimi');
      expect(device.relationshipLabel, 'Mum');
      expect(device.online, true);
      expect(device.batteryPercent, 72);
      expect(device.location?.isValid, true);
      expect(device.location?.lat, -20.2642);
      expect(device.simNumber, '+23057123456');
      expect(device.avatarUrl, 'https://example.com/avatar.jpg');
    });

    test(
      'falls back to a person-first label when unnamed, and location is invalid when absent',
      () async {
        final db = FakeFirebaseFirestore();
        await db.collection('devices').doc('999').set({'online': false});
        final doc = await db.collection('devices').doc('999').get();

        final device = Device.fromDoc(doc);

        expect(device.displayName, 'Loved one');
        expect(device.relationshipLabel, 'Family member');
        expect(device.online, false);
        expect(device.location?.isValid, false);
        expect(device.simNumber, isNull);
      },
    );

    test(
      'relationship precedes legacy name and legacy hardware wording is removed',
      () {
        const related = Device(
          imei: '1',
          online: true,
          relationship: 'Dad',
          name: "Father's pendant",
        );
        const legacy = Device(imei: '2', online: true, name: "Mum's pendant");

        expect(related.displayName, 'Dad');
        expect(legacy.displayName, 'Mum');
      },
    );
  });

  group('Device.hasFreshLocation', () {
    test('rejects coordinates older than last heartbeat', () {
      final heartbeat = DateTime.utc(2026, 7, 22, 13, 40);
      final staleRecorded = heartbeat.subtract(const Duration(minutes: 10));
      final device = Device(
        imei: '861397053141170',
        online: true,
        speedKmh: 45,
        lastHeartbeatAt: heartbeat,
        location: DeviceLocation(
          lat: -20.261286,
          lng: 57.477801,
          recordedAt: staleRecorded,
        ),
      );

      expect(device.hasFreshLocation, isFalse);
      expect(device.isMoving, isFalse);
    });

    test('accepts recent coordinates', () {
      final heartbeat = DateTime.utc(2026, 7, 22, 13, 40);
      final device = Device(
        imei: '1',
        online: true,
        speedKmh: 12,
        lastHeartbeatAt: heartbeat,
        location: DeviceLocation(
          lat: -20.2,
          lng: 57.5,
          recordedAt: heartbeat.subtract(const Duration(minutes: 2)),
        ),
      );

      expect(device.hasFreshLocation, isTrue);
      expect(device.isMoving, isTrue);
    });

    test('hasApproximateLocation when accuracySource is wifi or lbs', () {
      final heartbeat = DateTime.utc(2026, 7, 22, 13, 40);
      final wifiDevice = Device(
        imei: '1',
        online: true,
        accuracySource: 'wifi',
        lastHeartbeatAt: heartbeat,
        location: DeviceLocation(
          lat: -20.2,
          lng: 57.5,
          recordedAt: heartbeat.subtract(const Duration(minutes: 1)),
        ),
      );
      expect(wifiDevice.hasApproximateLocation, isTrue);

      final gpsDevice = Device(
        imei: '2',
        online: true,
        accuracySource: 'gps',
        lastHeartbeatAt: heartbeat,
        location: DeviceLocation(
          lat: -20.2,
          lng: 57.5,
          recordedAt: heartbeat.subtract(const Duration(minutes: 1)),
        ),
      );
      expect(gpsDevice.hasApproximateLocation, isFalse);
    });
  });

  group('GuardianAlert.fromDoc', () {
    test('parses required fields and defaults resolved to false', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('alerts').add({
        'imei': '123',
        'type': 'sos',
        'severity': 'critical',
        'message': 'Help requested',
        'resolved': false,
      });
      final snap = await db.collection('alerts').get();
      final alert = GuardianAlert.fromDoc(snap.docs.first);

      expect(alert.imei, '123');
      expect(alert.type, 'sos');
      expect(alert.severity, 'critical');
      expect(alert.resolved, false);
    });
  });

  group('Geofence.fromDoc', () {
    test(
      'parses center map, defaults active to true, and reads wifiSsid',
      () async {
        final db = FakeFirebaseFirestore();
        await db.collection('geofences').add({
          'imei': '123',
          'name': 'Home',
          'center': {'lat': -20.1, 'lng': 57.5},
          'radiusMeters': 150,
          'wifiSsid': 'Home WiFi',
          'createdBy': 'uid1',
        });
        final snap = await db.collection('geofences').get();
        final zone = Geofence.fromDoc(snap.docs.first);

        expect(zone.name, 'Home');
        expect(zone.active, true);
        expect(zone.lat, -20.1);
        expect(zone.lng, 57.5);
        expect(zone.radiusMeters, 150);
        expect(zone.wifiSsid, 'Home WiFi');
      },
    );

    test('active defaults to true unless explicitly false', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('geofences').add({
        'imei': '123',
        'active': false,
        'center': {'lat': 0, 'lng': 0},
      });
      final snap = await db.collection('geofences').get();
      final zone = Geofence.fromDoc(snap.docs.first);

      expect(zone.active, false);
    });
  });

  group('LocationHistoryPoint.fromDoc', () {
    test('parses lat/lng/speed/accuracy/recordedAt', () async {
      final db = FakeFirebaseFirestore();
      final recordedAt = DateTime(2026, 7, 17, 14, 30);
      await db.collection('devices').doc('123').collection('locations').add({
        'lat': -20.2642,
        'lng': 57.4791,
        'speedKmh': 22,
        'accuracySource': 'gps',
        'recordedAt': Timestamp.fromDate(recordedAt),
      });
      final snap = await db
          .collection('devices')
          .doc('123')
          .collection('locations')
          .get();
      final point = LocationHistoryPoint.fromDoc(snap.docs.first);

      expect(point.lat, -20.2642);
      expect(point.lng, 57.4791);
      expect(point.speedKmh, 22);
      expect(point.accuracySource, 'gps');
      expect(point.recordedAt, recordedAt);
    });

    test('defaults to 0,0 and nulls when fields are absent', () async {
      final db = FakeFirebaseFirestore();
      await db.collection('devices').doc('123').collection('locations').add({});
      final snap = await db
          .collection('devices')
          .doc('123')
          .collection('locations')
          .get();
      final point = LocationHistoryPoint.fromDoc(snap.docs.first);

      expect(point.lat, 0);
      expect(point.lng, 0);
      expect(point.speedKmh, isNull);
      expect(point.recordedAt, isNull);
    });
  });
}
