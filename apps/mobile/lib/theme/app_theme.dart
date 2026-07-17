import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Color tokens pulled from the mockups. Keep these as the single source of
/// truth so every screen stays visually consistent.
class GuardianColors {
  GuardianColors._();

  static const Color safe = Color(0xFF0F9D6C);
  static const Color safeBg = Color(0xFFE1F5EE);
  static const Color safeText = Color(0xFF085041);

  static const Color warning = Color(0xFFEF9F27);
  static const Color warningBg = Color(0xFFFAEEDA);
  static const Color warningText = Color(0xFF854F0B);

  static const Color danger = Color(0xFFE24B4A);
  static const Color dangerBg = Color(0xFFFCEBEB);
  static const Color dangerText = Color(0xFF791F1F);

  static const Color accent = Color(0xFF378ADD);
  static const Color accentBg = Color(0xFFE6F1FB);
  static const Color accentText = Color(0xFF0C447C);

  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceMuted = Color(0xFFF6F5F2);
  static const Color textPrimary = Color(0xFF1A1A18);
  static const Color textSecondary = Color(0xFF6B6A65);
  static const Color textMuted = Color(0xFF9B9A94);
  static const Color border = Color(0xFFE7E5DF);
}

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
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) {
    final s = parts.first;
    return s.length >= 2 ? s.substring(0, 2).toUpperCase() : s.toUpperCase();
  }
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

ThemeData buildGuardianTheme() {
  final base = ThemeData(
    useMaterial3: true,
    scaffoldBackgroundColor: GuardianColors.surfaceMuted,
    colorScheme: ColorScheme.fromSeed(
      seedColor: GuardianColors.safe,
      primary: GuardianColors.safe,
      surface: GuardianColors.surface,
    ),
  );

  return base.copyWith(
    textTheme: GoogleFonts.interTextTheme(base.textTheme).copyWith(
      titleLarge: GoogleFonts.inter(
        fontSize: 19,
        fontWeight: FontWeight.w600,
        color: GuardianColors.textPrimary,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: GuardianColors.textPrimary,
      ),
      bodyMedium: GoogleFonts.inter(
        fontSize: 13,
        color: GuardianColors.textSecondary,
      ),
      labelSmall: GoogleFonts.inter(
        fontSize: 11,
        color: GuardianColors.textMuted,
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: GuardianColors.safe,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: GuardianColors.surfaceMuted,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GuardianColors.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GuardianColors.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: GuardianColors.safe, width: 1.5),
      ),
    ),
  );
}
