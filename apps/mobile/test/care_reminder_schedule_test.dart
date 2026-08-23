import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/models/care_reminder_schedule.dart';

void main() {
  test('sent watch sync never implies wearer acknowledgement', () {
    final schedule = CareReminderSchedule.fromFirestore('r1', {
      'imei': '861397012345670',
      'kind': 'routine',
      'label': 'Evening tablets',
      'localTime': '20:30',
      'weekdays': [1, 2, 3, 4, 5, 6, 7],
      'enabled': true,
      'syncState': 'sent',
      'acknowledgementSupported': false,
      'acknowledgementState': 'unavailable',
    });

    expect(schedule.watchSynced, isTrue);
    expect(schedule.wearerAcknowledged, isFalse);
    expect(schedule.syncLabel, 'Sent to watch');
    expect(schedule.acknowledgementSupported, isFalse);
    expect(schedule.acknowledgementState, 'unavailable');
  });

  test('unknown sync state fails closed to blocked-unverified', () {
    final schedule = CareReminderSchedule.fromFirestore('r2', {
      'imei': '861397012345670',
      'kind': 'accessibility',
      'label': 'Drink water',
      'localTime': '09:00',
      'weekdays': [1],
      'syncState': 'future_state',
    });

    expect(schedule.syncState, CareReminderSyncState.blockedUnverified);
    expect(schedule.watchSynced, isFalse);
    expect(schedule.wearerAcknowledged, isFalse);
  });
}
