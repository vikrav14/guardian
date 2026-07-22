import 'package:shared_preferences/shared_preferences.dart';

/// Persists whether the map floating device card is minimized per pendant IMEI.
class DeviceCardPreferences {
  static String _keyFor(String imei) => 'map_device_card_minimized_$imei';

  static Future<bool> loadMinimized(String imei) async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getBool(_keyFor(imei)) ?? false;
  }

  static Future<void> saveMinimized(String imei, bool minimized) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_keyFor(imei), minimized);
  }
}
