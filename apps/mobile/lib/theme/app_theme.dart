import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';
import 'guardian_themes.dart';
import 'radius.dart';
import 'typography.dart';

export 'colors.dart';
export 'guardian_themes.dart';
export 'radius.dart';
export 'spacing.dart';

const List<Color> memberAvatarColors = [
  GuardianColors.safe,
  GuardianColors.warning,
  Color(0xFF993556),
  GuardianColors.accent,
];

Color avatarColorForKey(String key) {
  if (key.isEmpty) return memberAvatarColors.first;
  return memberAvatarColors[key.hashCode.abs() % memberAvatarColors.length];
}

String initialsFor(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) {
    final s = parts.first;
    return s.length >= 2 ? s.substring(0, 2).toUpperCase() : s.toUpperCase();
  }
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

ThemeData buildGuardianTheme({
  GuardianThemeId themeId = GuardianThemeId.defaultTheme,
}) {
  final semantic = themeId.semanticColors;
  final brightness = themeId.brightness;
  final highContrast = themeId.isHighContrast;
  final borderWidth = highContrast ? 2.0 : 1.0;
  final focusedBorderWidth = highContrast ? 2.5 : 1.5;
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: semantic.canvas,
    colorScheme: ColorScheme.fromSeed(
      seedColor: semantic.accent,
      brightness: brightness,
      primary: semantic.accent,
      surface: semantic.surface,
    ),
  );

  return base.copyWith(
    extensions: [semantic],
    textTheme: GuardianTypography.build(
      base.textTheme,
      semantic.textPrimary,
      semantic.textSecondary,
    ),
    cardTheme: CardThemeData(
      color: semantic.surface,
      elevation: 0,
      shadowColor: semantic.textPrimary.withValues(alpha: 0.06),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: semantic.border, width: borderWidth),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: semantic.accent,
        foregroundColor: Colors.white,
        elevation: 0,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: semantic.textPrimary,
        backgroundColor: semantic.surface.withValues(alpha: 0.82),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(GuardianRadius.medium),
          side: BorderSide(color: semantic.border),
        ),
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      elevation: 0,
      height: 70,
      backgroundColor: semantic.glass,
      indicatorColor: semantic.accentMuted,
      labelTextStyle: WidgetStatePropertyAll(
        GoogleFonts.inter(fontSize: 11, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: semantic.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(GuardianRadius.small),
        borderSide: BorderSide(color: semantic.border, width: borderWidth),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(GuardianRadius.small),
        borderSide: BorderSide(color: semantic.border, width: borderWidth),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(GuardianRadius.small),
        borderSide: BorderSide(
          color: semantic.accent,
          width: focusedBorderWidth,
        ),
      ),
    ),
  );
}
