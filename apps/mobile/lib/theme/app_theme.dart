import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';
import 'controls.dart';
import 'guardian_themes.dart';
import 'radius.dart';
import 'typography.dart';

export 'colors.dart';
export 'controls.dart';
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
  final action = guardianActionColor(semantic, brightness);
  final onAction = brightness == Brightness.dark
      ? semantic.canvas
      : Colors.white;
  final shape = RoundedRectangleBorder(
    borderRadius: BorderRadius.circular(GuardianRadius.medium),
  );
  final label = GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600);
  final primaryStyle = FilledButton.styleFrom(
    backgroundColor: action,
    foregroundColor: onAction,
    disabledBackgroundColor: semantic.surfaceMuted,
    disabledForegroundColor: semantic.textSecondary,
    minimumSize: const Size(48, 48),
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    shape: shape,
    textStyle: label,
    elevation: 0,
    visualDensity: VisualDensity.standard,
    tapTargetSize: MaterialTapTargetSize.padded,
  );
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: semantic.canvas,
    colorScheme: ColorScheme.fromSeed(
      seedColor: semantic.accent,
      brightness: brightness,
      primary: action,
      onPrimary: onAction,
      primaryContainer: semantic.accentMuted,
      onPrimaryContainer: action,
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
    filledButtonTheme: FilledButtonThemeData(style: primaryStyle),
    elevatedButtonTheme: ElevatedButtonThemeData(style: primaryStyle),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style:
          OutlinedButton.styleFrom(
            foregroundColor: action,
            disabledForegroundColor: semantic.textSecondary,
            minimumSize: const Size(48, 48),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            shape: shape,
            textStyle: label,
            visualDensity: VisualDensity.standard,
            tapTargetSize: MaterialTapTargetSize.padded,
          ).copyWith(
            side: WidgetStateProperty.resolveWith(
              (states) => BorderSide(
                color: states.contains(WidgetState.disabled)
                    ? semantic.border
                    : action,
                width: highContrast || states.contains(WidgetState.focused)
                    ? 2
                    : 1,
              ),
            ),
          ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: action,
        disabledForegroundColor: semantic.textSecondary,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        shape: shape,
        textStyle: label,
        visualDensity: VisualDensity.standard,
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: semantic.textPrimary,
        disabledForegroundColor: semantic.textSecondary,
        minimumSize: const Size(48, 48),
        visualDensity: VisualDensity.standard,
        tapTargetSize: MaterialTapTargetSize.padded,
        backgroundColor: semantic.surface.withValues(alpha: 0.82),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(GuardianRadius.medium),
          side: BorderSide(color: semantic.border),
        ),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        textStyle: WidgetStatePropertyAll(label),
        shape: WidgetStatePropertyAll(shape),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? semantic.textSecondary
              : action,
        ),
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? semantic.accentMuted
              : semantic.surface,
        ),
        side: WidgetStatePropertyAll(
          BorderSide(color: action, width: borderWidth),
        ),
        visualDensity: VisualDensity.standard,
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: semantic.canvas,
      foregroundColor: semantic.textPrimary,
      elevation: 0,
      scrolledUnderElevation: 0,
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
        borderSide: BorderSide(color: action, width: focusedBorderWidth),
      ),
    ),
  );
}
