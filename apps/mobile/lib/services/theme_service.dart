import 'package:shared_preferences/shared_preferences.dart';

import '../theme/guardian_themes.dart';
import '../theme/guardian_appearance.dart';

class ThemeService {
  static const _prefsKey = 'guardian_theme';

  static Future<GuardianThemeId> loadSavedTheme() async {
    final prefs = await SharedPreferences.getInstance();
    return GuardianThemeId.fromStorageKey(prefs.getString(_prefsKey));
  }

  static Future<void> saveTheme(GuardianThemeId theme) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, theme.storageKey);
  }

  static Future<GuardianAppearance> loadAppearance() async {
    final prefs = await SharedPreferences.getInstance();
    final savedKey = prefs.getString(_prefsKey);
    final strength = prefs.getDouble('guardian_scenery_strength') ?? .65;
    return GuardianAppearance(
      themeId: GuardianThemeId.fromStorageKey(savedKey),
      scenery: prefs.getBool('guardian_scenery') ?? true,
      strength: strength.isFinite ? strength.clamp(.10, .65) : .65,
      highContrast:
          prefs.getBool('guardian_high_contrast') ??
          savedKey == GuardianThemeId.elderCare.storageKey,
    );
  }

  static Future<void> saveAppearance(GuardianAppearance appearance) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, appearance.themeId.storageKey);
    await prefs.setBool('guardian_scenery', appearance.scenery);
    await prefs.setDouble('guardian_scenery_strength', appearance.strength);
    await prefs.setBool('guardian_high_contrast', appearance.highContrast);
  }
}
