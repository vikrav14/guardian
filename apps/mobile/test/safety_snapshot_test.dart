import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/safety_snapshot.dart';

void main() {
  test('available snapshot is contextual, not a safety conclusion', () {
    final snapshot = SafetySnapshot.fromFirestore('snapshot-1', {
      'imei': '999999999999999',
      'state': 'available',
      'purpose': 'Check immediate surroundings',
      'sizeBytes': 12345,
      'contentType': 'image/jpeg',
    });

    expect(snapshot.state, SafetySnapshotState.available);
    expect(snapshot.isViewable, isTrue);
    expect(snapshot.statusLabel, 'Safety snapshot available');
    expect(snapshot.safetyNote, contains('does not prove'));
  });

  test('waiting state does not imply a capture happened', () {
    final snapshot = SafetySnapshot.fromFirestore('snapshot-2', {
      'imei': '999999999999999',
      'state': 'waiting_for_device_acceptance',
      'purpose': 'Check immediate surroundings',
    });

    expect(snapshot.isViewable, isFalse);
    expect(snapshot.statusLabel, 'Waiting for device acceptance');
  });
}
