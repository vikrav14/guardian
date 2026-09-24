import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/alerts/alert_presentation.dart';
import 'package:guardian/dashboard/alert_formatters.dart';
import 'package:guardian/models/alert.dart';
import 'package:guardian/models/device.dart';

GuardianAlert _alert({
  String type = 'sos',
  String severity = 'info',
  String message = 'Device alarm: sos',
  String? title,
  String? source,
}) => GuardianAlert(
  id: 'incident',
  imei: 'synthetic-watch',
  type: type,
  severity: severity,
  message: message,
  title: title,
  resolved: false,
  payload: {'source': source},
);

void main() {
  test('technical SOS copy is humanized, custom copy is retained', () {
    const watch = Device(
      imei: 'synthetic-watch',
      online: false,
      nickname: 'Alex',
    );
    final alert = _alert(title: 'Device alarm: sos');
    expect(alertDisplayTitle(alert, device: watch), 'Alex pressed SOS');
    expect(alertDisplayBody(alert), contains('SOS button on the watch'));
    expect(
      alertDisplayTitle(_alert(title: 'Please check on Alex')),
      'Please check on Alex',
    );
    expect(
      alertDisplayTitle(_alert(message: 'Custom SOS message')),
      'Custom SOS message',
    );
    expect(
      alertDisplayTitle(_alert(source: 'app'), device: watch),
      'Help requested for Alex',
    );
    expect(alertDisplayBody(_alert(source: 'app')), contains('Guardian app'));
    expect(
      alertDisplayBody(_alert(source: 'app')),
      isNot(contains('watch was pressed')),
    );
  });

  test(
    'categories preserve unknown alerts in All and critical events in Safety',
    () {
      for (final type in ['sos', 'fall', 'watch_removed', 'bracelet_removed']) {
        expect(AlertCategory.safety.includes(_alert(type: type)), isTrue);
      }
      expect(
        AlertCategory.safety.includes(
          _alert(type: 'unknown', severity: 'critical'),
        ),
        isTrue,
      );
      expect(AlertCategory.all.includes(_alert(type: 'future_type')), isTrue);
      expect(
        AlertCategory.device.includes(_alert(type: 'low_battery')),
        isTrue,
      );
      expect(AlertCategory.device.includes(_alert(type: 'offline')), isTrue);
      expect(
        AlertCategory.places.includes(_alert(type: 'geofence_exit')),
        isTrue,
      );
      expect(
        AlertCategory.places.includes(_alert(type: 'geofence_enter')),
        isTrue,
      );
      expect(AlertCategory.places.includes(_alert()), isFalse);
    },
  );

  test('date headings follow local calendar days across month boundaries', () {
    final now = DateTime(2026, 9, 1, 0, 1);
    expect(alertDateGroup(DateTime(2026, 9, 1), now), 'Today');
    expect(alertDateGroup(DateTime(2026, 8, 31, 23, 59), now), 'Yesterday');
    expect(alertDateGroup(DateTime(2026, 8, 30, 23, 59), now), '30 Aug 2026');
    expect(alertDateGroup(null, now), 'Time unavailable');
    expect(sosReceiptAge(null), 'Recording time unavailable');
    expect(sosReceiptAge(420), '7 min before SOS receipt');
  });
}
