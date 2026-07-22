import 'package:shared_preferences/shared_preferences.dart';

class SidebarPreferences {
  static const _prefsKey = 'desktop_sidebar_collapsed';

  static Future<bool> loadCollapsed() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_prefsKey) ?? false;
  }

  static Future<void> saveCollapsed(bool collapsed) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_prefsKey, collapsed);
  }
}
