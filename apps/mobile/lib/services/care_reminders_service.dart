import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/care_reminder_schedule.dart';

const bool guardianCareRemindersEnabled = bool.fromEnvironment(
  'GUARDIAN_CARE_REMINDERS_ENABLED',
  defaultValue: false,
);

class CareRemindersService {
  CareRemindersService({FirebaseFirestore? db})
    : _db = db ?? FirebaseFirestore.instance;

  final FirebaseFirestore _db;

  Stream<List<CareReminderSchedule>> watchSchedules(String imei) {
    if (!guardianCareRemindersEnabled) {
      return Stream.value(const <CareReminderSchedule>[]);
    }
    return _db
        .collection('careReminderSchedules')
        .where('imei', isEqualTo: imei)
        .snapshots()
        .map((snapshot) {
          final schedules = snapshot.docs
              .map(
                (doc) => CareReminderSchedule.fromFirestore(
                  doc.id,
                  doc.data(),
                ),
              )
              .toList();
          schedules.sort((a, b) {
            final byTime = a.localTime.compareTo(b.localTime);
            if (byTime != 0) return byTime;
            return a.label.compareTo(b.label);
          });
          return schedules;
        });
  }

  Future<void> createOrChangeSchedule() async {
    throw StateError(
      'Care reminder changes are not available until exact V52 reminder '
      'protocol acceptance and backend audit processing are enabled.',
    );
  }
}
