import 'dart:convert';
import 'dart:io';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_data.dart';

void main() {
  final fixture =
      jsonDecode(
            File(
              '../../docs/testing/journey-source-evidence.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  for (final scenario
      in (fixture['cases'] as List).cast<Map<String, dynamic>>()) {
    test('journey source contract: ${scenario['name']}', () async {
      final db = FakeFirebaseFirestore();
      final ref = db.collection('journeys').doc('synthetic-trip');
      await ref.set(Map<String, dynamic>.from(scenario['journey'] as Map));
      final record = JourneyRecord.fromDoc(await ref.get());
      expect(record.hasAuthoritativeEvidence, scenario['eligible']);
      if (scenario['eligible'] == false) {
        expect(journeyV2MeaningfulRecords([record]), isEmpty);
        expect(journeyV2SelectRecord([record]), isNull);
        expect(journeyV2RecordedDistanceKm(record), 0);
      }
    });
  }
}
