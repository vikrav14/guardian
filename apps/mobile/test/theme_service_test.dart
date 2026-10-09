import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/theme_service.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/theme/guardian_appearance.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'new installations use Blue Bay with the approved scenery strength',
    () async {
      final appearance = await ThemeService.loadAppearance();
      expect(appearance.themeId, GuardianThemeId.blueBay);
      expect(appearance.scenery, isTrue);
      expect(appearance.strength, .65);
      expect(appearance.highContrast, isFalse);
    },
  );

  test(
    'all five choices persist without losing accessibility preferences',
    () async {
      for (final theme in GuardianThemeId.allThemes) {
        await ThemeService.saveAppearance(
          GuardianAppearance(
            themeId: theme,
            scenery: false,
            strength: .35,
            highContrast: true,
          ),
        );
        final restored = await ThemeService.loadAppearance();
        expect(restored.themeId, theme);
        expect(restored.scenery, isFalse);
        expect(restored.strength, .35);
        expect(restored.highContrast, isTrue);
        expect(await ThemeService.loadSavedTheme(), theme);
      }
    },
  );

  test(
    'legacy theme preferences migrate and Elder Care keeps high contrast',
    () async {
      for (final entry in {
        'island_glass': GuardianThemeId.pamplemousses,
        'elder_care': GuardianThemeId.pamplemousses,
        'indian_ocean_night': GuardianThemeId.leMorne,
        'sugar_beach': GuardianThemeId.flicEnFlac,
      }.entries) {
        SharedPreferences.setMockInitialValues({'guardian_theme': entry.key});
        final restored = await ThemeService.loadAppearance();
        expect(restored.themeId, entry.value);
        expect(restored.highContrast, entry.key == 'elder_care');
      }
    },
  );

  test('unknown palette and out-of-range scenery have safe defaults', () async {
    for (final strength in [-10.0, 20.0, double.nan]) {
      SharedPreferences.setMockInitialValues({
        'guardian_theme': 'unknown',
        'guardian_scenery_strength': strength,
      });
      final restored = await ThemeService.loadAppearance();
      expect(restored.themeId, GuardianThemeId.blueBay);
      expect(restored.strength, inInclusiveRange(.10, .65));
    }
  });

  test('the chooser contains exactly the five approved places', () {
    expect(GuardianThemeId.allThemes.map((t) => t.displayName), [
      'Blue Bay',
      'Le Morne',
      'Pamplemousses',
      'Chamarel',
      'Flic-en-Flac',
    ]);
  });
}
