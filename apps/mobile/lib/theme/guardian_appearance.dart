import 'package:flutter/material.dart';

import 'guardian_themes.dart';

/// Local display preferences only. Never written to a watch or user profile.
@immutable
class GuardianAppearance {
  const GuardianAppearance({
    this.themeId = GuardianThemeId.defaultTheme,
    this.scenery = true,
    this.strength = .65,
    this.highContrast = false,
  });

  final GuardianThemeId themeId;
  final bool scenery;
  final double strength;
  final bool highContrast;

  GuardianAppearance copyWith({
    GuardianThemeId? themeId,
    bool? scenery,
    double? strength,
    bool? highContrast,
  }) => GuardianAppearance(
    themeId: themeId ?? this.themeId,
    scenery: scenery ?? this.scenery,
    strength: (strength ?? this.strength).clamp(.10, .65),
    highContrast: highContrast ?? this.highContrast,
  );
}

/// The scenic layer has no dependency on app state, Firebase or navigation.
@immutable
class GuardianSceneTheme extends ThemeExtension<GuardianSceneTheme> {
  const GuardianSceneTheme({
    required this.asset,
    required this.enabled,
    required this.strength,
  });

  final String asset;
  final bool enabled;
  final double strength;

  @override
  GuardianSceneTheme copyWith({
    String? asset,
    bool? enabled,
    double? strength,
  }) => GuardianSceneTheme(
    asset: asset ?? this.asset,
    enabled: enabled ?? this.enabled,
    strength: strength ?? this.strength,
  );

  @override
  GuardianSceneTheme lerp(GuardianSceneTheme? other, double t) {
    if (other == null) return this;
    return GuardianSceneTheme(
      asset: t < .5 ? asset : other.asset,
      enabled: t < .5 ? enabled : other.enabled,
      strength: strength + (other.strength - strength) * t,
    );
  }
}
