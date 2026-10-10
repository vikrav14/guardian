import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/alerts/alert_detail.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/sos_location_snapshot.dart';

void main() {
  final at = DateTime.utc(2026, 10, 9, 13, 6, 44);
  final observed = at.subtract(const Duration(seconds: 158));
  Map<String, dynamic> fixture() => {
    'version': 3,
    'policy': 'recent_home_incident_evidence_v3',
    'capturedAt': at.toIso8601String(),
    'state': 'last_known',
    'retainedSatellite': false,
    'location': {
      'lat': -20.1,
      'lng': 57.5,
      'source': 'home_wifi_last_detected',
      'recordedAt': observed.toIso8601String(),
    },
    'lastHomeWifiEvidence': {
      'version': 1,
      'policy': 'last_detected_home_v1',
      'source': 'home_wifi',
      'bindingHash': 'a' * 64,
      'observedAt': observed.toIso8601String(),
      'qualifiedUntil': observed
          .add(const Duration(minutes: 2))
          .toIso8601String(),
      'anchor': {
        'geofenceId': 'fixture-home',
        'lat': -20.1,
        'lng': 57.5,
        'radiusMeters': 50,
      },
    },
    'latestObservation': {
      'lat': -20.106,
      'lng': 57.504,
      'source': 'wifi',
      'recordedAt': at.toIso8601String(),
      'accuracyMeters': 555.239,
    },
  };

  test(
    'recent Home stays historical and keeps the coarse network point separate',
    () {
      final parsed = SosLocationSnapshot.tryParse(fixture())!;
      expect(parsed.state, 'last_known');
      expect(parsed.location!.placeLabel, 'Home');
      expect(parsed.ageSeconds, 158);
      expect(parsed.mapsUri!.queryParameters['q'], '-20.1,57.5');
      expect(parsed.secondaryNetworkObservation!.accuracyMeters, 555.239);
    },
  );

  test(
    'historical Home rejects current relabelling, altered points and expired evidence',
    () {
      for (final mutate in <void Function(Map<String, dynamic>)>[
        (s) => s['state'] = 'fresh',
        (s) => (s['location'] as Map)['lat'] = -21,
        (s) => (s['location'] as Map)['recordedAt'] = at.toIso8601String(),
        (s) => (s['lastHomeWifiEvidence'] as Map)['bindingHash'] = 'invalid',
        (s) => s['capturedAt'] = observed
            .add(const Duration(minutes: 10, milliseconds: 1))
            .toIso8601String(),
        (s) => (s['latestObservation'] as Map)['source'] = 'gps',
        (s) => (s['latestObservation'] as Map)['accuracyMeters'] = 50,
      ]) {
        final raw = fixture();
        mutate(raw);
        expect(SosLocationSnapshot.tryParse(raw), isNull);
      }
    },
  );

  test(
    'both SOS and fall model readers use their frozen Home snapshot',
    () async {
      final db = FakeFirebaseFirestore();
      for (final type in ['sos', 'fall']) {
        final ref = db.collection('alerts').doc(type);
        await ref.set({
          'type': type,
          'imei': 'fixture',
          if (type == 'sos') 'sosLocationSnapshot': fixture(),
          if (type == 'fall') 'payload': {'locationSnapshot': fixture()},
        });
        final alert = GuardianAlert.fromDoc(await ref.get());
        expect(
          alert.sosLocationSnapshot!.location!.source,
          'home_wifi_last_detected',
        );
        expect(alert.sosLocationSnapshot!.state, 'last_known');
      }
    },
  );

  for (final type in ['sos', 'fall']) {
    testWidgets('$type detail labels historical Home and its map honestly', (
      tester,
    ) async {
      final alert = GuardianAlert(
        id: 'fixture',
        imei: 'fixture',
        type: type,
        severity: 'critical',
        message: 'Test alert',
        resolved: false,
        sosLocationSnapshot: SosLocationSnapshot.tryParse(fixture()),
      );
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: SingleChildScrollView(
              child: AlertDetail(
                alert: alert,
                device: null,
                saving: false,
                onResolve: () {},
                onCall: null,
                onLocation: () {},
              ),
            ),
          ),
        ),
      );
      expect(find.text('Last detected at Home'), findsOneWidget);
      expect(find.text('Current position unconfirmed.'), findsOneWidget);
      expect(find.text('View last detected location'), findsOneWidget);
      expect(find.textContaining('not live GPS'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }
}
