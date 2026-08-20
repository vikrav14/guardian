import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/theme_service.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
  });

  test('defaults to Island Glass when nothing saved', () async {
    expect(await ThemeService.loadSavedTheme(), GuardianThemeId.islandGlass);
  });

  test('persists and restores theme selection', () async {
    await ThemeService.saveTheme(GuardianThemeId.leMorne);
    expect(await ThemeService.loadSavedTheme(), GuardianThemeId.leMorne);

    await ThemeService.saveTheme(GuardianThemeId.elderCare);
    expect(await ThemeService.loadSavedTheme(), GuardianThemeId.elderCare);

    await ThemeService.saveTheme(GuardianThemeId.chamarel);
    expect(await ThemeService.loadSavedTheme(), GuardianThemeId.chamarel);

    await ThemeService.saveTheme(GuardianThemeId.indianOceanNight);
    expect(await ThemeService.loadSavedTheme(), GuardianThemeId.indianOceanNight);
  });

  test('fromStorageKey falls back for unknown values', () {
    expect(
      GuardianThemeId.fromStorageKey('unknown_theme'),
      GuardianThemeId.islandGlass,
    );
    expect(
      GuardianThemeId.fromStorageKey('le_morne'),
      GuardianThemeId.leMorne,
    );
    expect(
      GuardianThemeId.fromStorageKey('blue_bay'),
      GuardianThemeId.blueBay,
    );
  });

  test('allThemes includes phase 1 and new Mauritian themes', () {
    expect(GuardianThemeId.allThemes, containsAll(GuardianThemeId.phase1Themes));
    expect(GuardianThemeId.allThemes, contains(GuardianThemeId.chamarel));
    expect(GuardianThemeId.allThemes, contains(GuardianThemeId.blueBay));
    expect(GuardianThemeId.allThemes, contains(GuardianThemeId.indianOceanNight));
    expect(GuardianThemeId.allThemes, contains(GuardianThemeId.sugarBeach));
  });

  test('theme identifiers map to their semantic color palettes', () {
    expect(
      GuardianThemeId.leMorne.semanticColors.canvas,
      GuardianThemeColors.leMorne.canvas,
    );
    expect(
      GuardianThemeId.chamarel.semanticColors.surfaceMuted,
      GuardianThemeColors.chamarel.surfaceMuted,
    );
  });
}
