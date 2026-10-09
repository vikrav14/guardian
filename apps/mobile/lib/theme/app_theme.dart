import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';
import 'controls.dart';
export 'controls.dart';
import 'guardian_themes.dart';
import 'guardian_appearance.dart';
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
  bool highContrast = false,
  bool scenery = true,
  double sceneryStrength = .65,
}) {
  highContrast = highContrast || themeId.isHighContrast;
  final brightness = themeId.brightness;
  final dark = brightness == Brightness.dark;
  final palette = themeId.semanticColors;
  final semantic = highContrast
      ? palette.copyWith(
          highContrast: true,
          textPrimary: dark ? Colors.white : const Color(0xFF111111),
          textSecondary: dark
              ? const Color(0xFFE5E5E5)
              : const Color(0xFF303030),
          textMuted: dark ? const Color(0xFFE5E5E5) : const Color(0xFF303030),
          border: dark ? const Color(0xFFAFBFC4) : const Color(0xFF53605C),
        )
      : palette;
  final borderWidth = highContrast ? 2.0 : 1.0;
  final action = guardianActionColor(semantic, brightness);
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(14));
  final scheme = ColorScheme.fromSeed(
    seedColor: semantic.accent,
    brightness: brightness,
    primary: action,
    onPrimary: semantic.onAccent,
    primaryContainer: semantic.accentMuted,
    onPrimaryContainer: action,
    secondary: semantic.accent,
    onSecondary: semantic.onAccent,
    secondaryContainer: semantic.accentMuted,
    onSecondaryContainer: semantic.accent,
    tertiary: semantic.accent,
    onTertiary: semantic.onAccent,
    surface: semantic.surface,
    onSurface: semantic.textPrimary,
    onSurfaceVariant: semantic.textSecondary,
    surfaceContainerLowest: semantic.canvas,
    surfaceContainerLow: semantic.surface,
    surfaceContainer: semantic.surfaceMuted,
    surfaceContainerHigh: semantic.surfaceMuted,
    surfaceContainerHighest: semantic.accentMuted,
    outline: semantic.border,
    outlineVariant: semantic.border,
    error: semantic.danger,
    onError: dark ? const Color(0xFF492D36) : Colors.white,
    errorContainer: dark ? const Color(0xFF492D36) : const Color(0xFFFBE8EC),
    onErrorContainer: semantic.danger,
    surfaceTint: Colors.transparent,
  );
  final base = ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: semantic.canvas,
    colorScheme: scheme,
  );
  final filled = FilledButton.styleFrom(
    backgroundColor: action,
    foregroundColor: semantic.onAccent,
    disabledBackgroundColor: semantic.disabled,
    disabledForegroundColor: semantic.disabledInk,
    minimumSize: const Size(48, 48),
    padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
    shape: shape,
    textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
  );
  return base.copyWith(
    extensions: [
      semantic,
      GuardianSceneTheme(
        asset: themeId.sceneAsset,
        enabled: scenery && !highContrast,
        strength: sceneryStrength.clamp(.10, .65),
      ),
    ],
    textTheme: GuardianTypography.build(
      base.textTheme,
      semantic.textPrimary,
      semantic.textSecondary,
    ),
    iconTheme: IconThemeData(color: semantic.textSecondary),
    dividerTheme: DividerThemeData(color: semantic.border, thickness: 1),
    appBarTheme: AppBarTheme(
      backgroundColor: semantic.surface,
      foregroundColor: semantic.textPrimary,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: GoogleFonts.inter(
        color: semantic.textPrimary,
        fontSize: 18,
        fontWeight: FontWeight.w700,
      ),
    ),
    cardTheme: CardThemeData(
      color: semantic.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(22),
        side: BorderSide(color: semantic.border, width: borderWidth),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(style: filled),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: filled.copyWith(elevation: const WidgetStatePropertyAll(0)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style:
          OutlinedButton.styleFrom(
            foregroundColor: action,
            disabledForegroundColor: semantic.disabledInk,
            minimumSize: const Size(48, 48),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            shape: shape,
            textStyle: GoogleFonts.inter(
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
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
        disabledForegroundColor: semantic.disabledInk,
        minimumSize: const Size(48, 48),
        shape: shape,
        textStyle: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(
        foregroundColor: semantic.accent,
        disabledForegroundColor: semantic.disabledInk,
        minimumSize: const Size(48, 48),
      ),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        minimumSize: const WidgetStatePropertyAll(Size(48, 48)),
        textStyle: WidgetStatePropertyAll(
          GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w500),
        ),
        shape: WidgetStatePropertyAll(shape),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? semantic.disabledInk
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
    navigationBarTheme: NavigationBarThemeData(
      elevation: 0,
      height: 76,
      backgroundColor: semantic.surface,
      indicatorColor: semantic.accentMuted,
      labelTextStyle: WidgetStatePropertyAll(
        GoogleFonts.inter(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          color: semantic.textPrimary,
        ),
      ),
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.selected)
            ? semantic.onAccent
            : semantic.textSecondary,
      ),
      trackColor: WidgetStateProperty.resolveWith(
        (states) => states.contains(WidgetState.disabled)
            ? semantic.disabled
            : states.contains(WidgetState.selected)
            ? semantic.accent
            : semantic.surfaceMuted,
      ),
      trackOutlineColor: WidgetStatePropertyAll(semantic.border),
    ),
    sliderTheme: SliderThemeData(
      activeTrackColor: semantic.accent,
      inactiveTrackColor: semantic.border,
      thumbColor: semantic.accent,
      overlayColor: semantic.accent.withValues(alpha: .12),
      valueIndicatorColor: semantic.accent,
      valueIndicatorTextStyle: TextStyle(color: semantic.onAccent),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: semantic.accent,
      linearTrackColor: semantic.accentMuted,
    ),
    chipTheme: ChipThemeData(
      backgroundColor: semantic.surfaceMuted,
      selectedColor: semantic.accentMuted,
      checkmarkColor: semantic.accent,
      labelStyle: TextStyle(color: semantic.textPrimary),
      side: BorderSide(color: semantic.border),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: semantic.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
        side: BorderSide(color: semantic.border),
      ),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: semantic.surface,
      modalBackgroundColor: semantic.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      dragHandleColor: semantic.border,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: semantic.surface,
      surfaceTintColor: Colors.transparent,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: semantic.surfaceMuted,
      hintStyle: TextStyle(color: semantic.textSecondary),
      labelStyle: TextStyle(color: semantic.textSecondary),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 15),
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
          width: highContrast ? 2.5 : 1.5,
        ),
      ),
    ),
  );
}
