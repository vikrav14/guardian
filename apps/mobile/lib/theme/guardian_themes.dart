import 'package:flutter/material.dart';

import 'colors.dart';

enum GuardianThemeId {
  islandGlass('island_glass'),
  leMorne('le_morne'),
  elderCare('elder_care'),
  chamarel('chamarel'),
  blueBay('blue_bay'),
  indianOceanNight('indian_ocean_night'),
  sugarBeach('sugar_beach');

  const GuardianThemeId(this.storageKey);

  final String storageKey;

  static const GuardianThemeId defaultTheme = GuardianThemeId.islandGlass;

  static const List<GuardianThemeId> phase1Themes = [
    islandGlass,
    leMorne,
    elderCare,
  ];

  static const List<GuardianThemeId> allThemes = [
    islandGlass,
    leMorne,
    elderCare,
    chamarel,
    blueBay,
    indianOceanNight,
    sugarBeach,
  ];

  static GuardianThemeId fromStorageKey(String? key) {
    if (key == null) return defaultTheme;
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
  };

  Brightness get brightness => switch (this) {
    leMorne || indianOceanNight => Brightness.dark,
    islandGlass ||
    elderCare ||
    chamarel ||
    blueBay ||
    sugarBeach => Brightness.light,
  };

  GuardianThemeColors get semanticColors => switch (this) {
    islandGlass => GuardianThemeColors.islandGlass,
    leMorne => GuardianThemeColors.leMorne,
    elderCare => GuardianThemeColors.elderCare,
    chamarel => GuardianThemeColors.chamarel,
    blueBay => GuardianThemeColors.blueBay,
    indianOceanNight => GuardianThemeColors.indianOceanNight,
    sugarBeach => GuardianThemeColors.sugarBeach,
  };

  bool get isHighContrast => this == GuardianThemeId.elderCare;
}
