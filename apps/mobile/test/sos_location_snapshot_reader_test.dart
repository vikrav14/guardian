import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/sos_location_snapshot.dart';

void main() {
  final fixtures =
      jsonDecode(
            File(
              '../../docs/testing/sos-location-snapshot-reader.json',
            ).readAsStringSync(),
          )
          as List<dynamic>;

  for (final fixture in fixtures) {
    test('app/gateway incident reader: ${fixture['name']}', () {
      final snapshot = SosLocationSnapshot.tryParse(fixture['snapshot']);
      final expected = fixture['expected'];
      if (expected == null) {
        expect(snapshot, isNull);
        return;
      }
      expect(snapshot, isNotNull);
      expect(snapshot!.state, expected['state']);
      expect(snapshot.ageSeconds, expected['ageSeconds']);
      expect(snapshot.retainedSatellite, expected['retainedSatellite']);
      expect(
        snapshot.secondaryNetworkObservation?.source,
        expected['secondarySource'],
      );
      final coordinates = expected['coordinates'];
      if (coordinates == null) {
        expect(snapshot.location, isNull);
        expect(snapshot.mapsUri, isNull);
      } else {
        expect([snapshot.location!.lat, snapshot.location!.lng], coordinates);
        expect(snapshot.mapsUri!.host, 'maps.google.com');
        expect(
          snapshot.mapsUri!.queryParameters['q'],
          '${coordinates[0]},${coordinates[1]}',
        );
      }
    });
  }

  test(
    'Firestore alert reads only the backend top-level SOS snapshot',
    () async {
      final db = FakeFirebaseFirestore();
      final raw = Map<String, dynamic>.from(fixtures.first['snapshot'] as Map);
      raw['capturedAt'] = Timestamp.fromDate(DateTime.utc(2026, 9, 6, 12));
      raw['location'] = Map<String, dynamic>.from(raw['location'] as Map)
        ..['recordedAt'] = Timestamp.fromDate(DateTime.utc(2026, 9, 6, 11, 50));
      final ref = db.collection('alerts').doc('synthetic-sos');
      await ref.set({'type': 'sos', 'sosLocationSnapshot': raw});
      final alert = GuardianAlert.fromDoc(await ref.get());
      expect(alert.sosLocationSnapshot!.ageSeconds, 600);
      final frozenUri = alert.sosLocationSnapshot!.mapsUri;
      (raw['location'] as Map)['lat'] = -19.0;
      expect(alert.sosLocationSnapshot!.mapsUri, frozenUri);

      await ref.set({
        'type': 'sos',
        'payload': {'sosLocationSnapshot': raw},
      });
      expect(
        GuardianAlert.fromDoc(await ref.get()).sosLocationSnapshot,
        isNull,
      );
      await ref.set({'type': 'fall', 'sosLocationSnapshot': raw});
      expect(
        GuardianAlert.fromDoc(await ref.get()).sosLocationSnapshot,
        isNull,
      );
      await ref.set({'type': 'sos'});
      expect(
        GuardianAlert.fromDoc(await ref.get()).sosLocationSnapshot,
        isNull,
      );
    },
  );
}
