import 'package:shared_preferences/shared_preferences.dart';

import '../theme/guardian_themes.dart';

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
}
