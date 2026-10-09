import 'package:flutter/material.dart';

import 'colors.dart';

enum GuardianThemeId {
  islandGlass('island_glass'),
  leMorne('le_morne'),
  elderCare('elder_care'),
  chamarel('chamarel'),
  blueBay('blue_bay'),
  indianOceanNight('indian_ocean_night'),
  sugarBeach('sugar_beach'),
  pamplemousses('pamplemousses'),
  flicEnFlac('flic_en_flac');

  const GuardianThemeId(this.storageKey);

  final String storageKey;

  static const GuardianThemeId defaultTheme = GuardianThemeId.blueBay;

  static const List<GuardianThemeId> phase1Themes = [
    islandGlass,
    leMorne,
    elderCare,
  ];

  static const List<GuardianThemeId> allThemes = [
    blueBay,
    leMorne,
    pamplemousses,
    chamarel,
    flicEnFlac,
  ];

  static GuardianThemeId fromStorageKey(String? key) {
    if (key == null) return defaultTheme;
    // Keep existing installations on a familiar palette after the refresh.
    if (key == 'island_glass' || key == 'elder_care') return pamplemousses;
    if (key == 'indian_ocean_night') return leMorne;
    if (key == 'sugar_beach') return flicEnFlac;
    for (final theme in values) {
      if (theme.storageKey == key) return theme;
    }
    return defaultTheme;
  }

  String get displayName => switch (this) {
    islandGlass => 'Island Glass',
    leMorne => 'Le Morne',
    elderCare => 'Elder Care',
    chamarel => 'Chamarel',
    blueBay => 'Blue Bay',
    indianOceanNight => 'Indian Ocean Night',
    sugarBeach => 'Sugar Beach',
    pamplemousses => 'Pamplemousses',
    flicEnFlac => 'Flic-en-Flac',
  };

  Brightness get brightness => switch (this) {
    leMorne || indianOceanNight => Brightness.dark,
    islandGlass ||
    elderCare ||
    chamarel ||
    blueBay ||
    sugarBeach ||
    pamplemousses ||
    flicEnFlac => Brightness.light,
  };

  GuardianThemeColors get semanticColors => switch (this) {
    islandGlass => GuardianThemeColors.islandGlass,
    leMorne => GuardianThemeColors.leMorne,
    elderCare => GuardianThemeColors.elderCare,
    chamarel => GuardianThemeColors.chamarel,
    blueBay => GuardianThemeColors.blueBay,
    indianOceanNight => GuardianThemeColors.indianOceanNight,
    sugarBeach => GuardianThemeColors.sugarBeach,
    pamplemousses => GuardianThemeColors.pamplemousses,
    flicEnFlac => GuardianThemeColors.flicEnFlac,
  };

  String get sceneAsset =>
      'assets/themes/${switch (this) {
        leMorne || indianOceanNight => 'le-morne',
        chamarel => 'chamarel',
        pamplemousses || islandGlass || elderCare => 'pamplemousses',
        flicEnFlac || sugarBeach => 'flic-en-flac',
        blueBay => 'blue-bay',
      }}.webp';

  String get description => switch (this) {
    leMorne || indianOceanNight => 'Basalt, dusk & quiet teal',
    chamarel => 'Warm earth & terracotta',
    pamplemousses ||
    islandGlass ||
    elderCare => 'Botanical greens & soft ivory',
    flicEnFlac || sugarBeach => 'Golden sand & sunset amber',
    blueBay => 'Lagoon blues & clear turquoise',
  };

  bool get isHighContrast => this == GuardianThemeId.elderCare;
}
