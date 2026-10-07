import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/navigation/whatsapp_menu_target.dart';
import 'package:guardian/services/family_sharing_service.dart';

void main() {
  const key = '0123456789abcdef0123';
  FamilyCircle circle(String id, List<String> screens) =>
      FamilyCircle({'imei': id, 'menuKey': key, 'menuScreens': screens});
  test(
    'query links survive the sign-in route and cover every menu destination',
    () {
      for (final screen in WhatsAppMenuTarget.screens) {
        final target = WhatsAppMenuTarget.fromUri(
          Uri.parse(
            'https://guardian.example/?guardianScreen=$screen&guardianWearer=$key#/',
          ),
        );
        expect(target?.screen, screen);
        expect(target?.wearerKey, key);
      }
    },
  );
  test('malformed, duplicate, command and raw-watch-id links are rejected', () {
    for (final url in [
      'https://guardian.example/?guardianScreen=rcapture&guardianWearer=$key',
      'https://guardian.example/?guardianScreen=voice&guardianWearer=861000000000001',
      'https://guardian.example/?guardianScreen=voice&guardianWearer=$key&guardianScreen=call',
      'https://guardian.example/?guardianScreen=voice',
      'https://guardian.example/#/menu?screen=voice&wearer=$key&screen=call',
      'https://guardian.example/#/menu?screen=call&wearer=$key&number=anything',
    ]) {
      expect(WhatsAppMenuTarget.fromUri(Uri.parse(url)), isNull);
    }
  });
  test(
    'old link resolves only its exact wearer with current server-granted access',
    () {
      const target = WhatsAppMenuTarget('voice', key);
      final shared = circle('watch-one', ['voice']);
      expect(target.resolve(FamilySharingSnapshot([shared])), same(shared));
      expect(
        target.resolve(
          FamilySharingSnapshot([
            circle('watch-one', ['alerts']),
          ]),
        ),
        isNull,
      );
      expect(target.resolve(FamilySharingSnapshot([])), isNull);
      final other = FamilyCircle({
        'imei': 'watch-two',
        'menuKey': 'abcdef0123456789abcd',
        'menuScreens': ['voice'],
      });
      expect(target.resolve(FamilySharingSnapshot([other])), isNull);
      expect(
        target.resolve(
          FamilySharingSnapshot([
            shared,
            circle('duplicate', ['voice']),
          ]),
        ),
        isNull,
      );
    },
  );
}
