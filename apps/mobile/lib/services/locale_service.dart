import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// English, French, and Kreol Morisien (Mauritian Creole) — the three
/// languages actually spoken day-to-day in Mauritius.
class LocaleService {
  static const _prefsKey = 'guardian_locale';

  static const supportedLocales = [
    Locale('en'),
    Locale('fr'),
    Locale('mfe'),
  ];

  static const localeNames = {
    'en': 'English',
    'fr': 'Français',
    'mfe': 'Kreol Morisien',
  };

  static Future<Locale?> loadSavedLocale() async {
    final prefs = await SharedPreferences.getInstance();
    final code = prefs.getString(_prefsKey);
    if (code == null) return null;
    for (final locale in supportedLocales) {
      if (locale.languageCode == code) return locale;
    }
    return null;
  }

  static Future<void> saveLocale(Locale locale) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_prefsKey, locale.languageCode);
  }
}
