import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/voice_notification.dart';

void main() {
  final data = <String, dynamic>{
    'type': 'voice_message',
    'imei': '999999999999999',
    'messageId': 'in_${'a' * 64}',
    'recipientUid': 'guardian-user',
  };
  test('voice tap metadata never grants another account or watch access', () {
    final target = VoiceNotificationTarget.fromData(data)!;
    expect(target.canOpenFor('guardian-user', '999999999999999'), isTrue);
    expect(target.canOpenFor('other-user', '999999999999999'), isFalse);
    expect(target.canOpenFor(null, '999999999999999'), isFalse);
    expect(target.canOpenFor('guardian-user', '111111111111111'), isFalse);
  });
  test('reject malformed or unrelated notification navigation', () {
    for (final patch in [
      {'type': 'sos'},
      {'imei': '../users'},
      {'messageId': '../../audio'},
      {'messageId': 'in_short'},
      {'recipientUid': 'user/other'},
      {'imei': 999999999999999},
    ]) {
      expect(VoiceNotificationTarget.fromData({...data, ...patch}), isNull);
    }
  });
  test(
    'web link binds to signed-in user and validates the incoming message id',
    () {
      final target = VoiceNotificationTarget.fromUri(
        Uri.parse(
          'https://guardian.example/?voiceImei=999999999999999&voiceMessage=in_${'b' * 64}',
        ),
        'signed-in',
      )!;
      expect(target.recipientUid, 'signed-in');
      expect(
        VoiceNotificationTarget.fromUri(
          Uri.parse('https://guardian.example/?voiceImei=bad'),
          'signed-in',
        ),
        isNull,
      );
    },
  );
}
