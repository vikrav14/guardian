import 'package:flutter/material.dart';

class GuardianColors {
  GuardianColors._();

  static const safe = Color(0xFF28A66D);
  static const safeBg = Color(0xFFE9F8F0);
  static const safeText = Color(0xFF166B48);
  static const warning = Color(0xFFD89B18);
  static const warningBg = Color(0xFFFFF6DC);
  static const warningText = Color(0xFF7D5A08);
  static const danger = Color(0xFFE83D45);
  static const dangerBg = Color(0xFFFFECEE);
  static const dangerText = Color(0xFF8C252B);
  static const accent = Color(0xFF286BF3);
  static const accentBg = Color(0xFFEEF4FF);
  static const accentText = Color(0xFF214FAD);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFF7F9F7);
  static const textPrimary = Color(0xFF10233F);
  static const textSecondary = Color(0xFF60746B);
  static const textMuted = Color(0xFF89978E);
  static const border = Color(0xFFE7ECE8);

  static const forest = Color(0xFF173C32);
  static const ivory = Color(0xFFFBFAF6);
  static const canvas = Color(0xFFEDF1ED);
  static const aiYellow = Color(0xFFF2C85B);
  static const whatsapp = Color(0xFF15975A);

  // Mauritius flag palette for dashboard status chips (red → blue → yellow → green).
  static const flagRed = Color(0xFFEA2839);
  static const flagRedMuted = Color(0xFFBC9599);
  static const flagRedBg = Color(0xFFFCE8EA);
  static const flagRedBgMuted = Color(0xFFF3EEEE);

  static const flagBlue = Color(0xFF003DA5);
  static const flagBlueMuted = Color(0xFF8E9DB8);
  static const flagBlueBg = Color(0xFFE6EEF9);
  static const flagBlueBgMuted = Color(0xFFF0F2F6);

  static const flagYellow = Color(0xFFC99700);
  static const flagYellowMuted = Color(0xFFB8AB85);
  static const flagYellowBg = Color(0xFFFFF4CC);
  static const flagYellowBgMuted = Color(0xFFF5F2EA);

  static const flagGreen = Color(0xFF00A551);
  static const flagGreenMuted = Color(0xFF8FAFA0);
  static const flagGreenBg = Color(0xFFE1F5EE);
  static const flagGreenBgMuted = Color(0xFFEDF2EF);
}

@immutable
class GuardianThemeColors extends ThemeExtension<GuardianThemeColors> {
  const GuardianThemeColors({
    required this.canvas,
    required this.surface,
    required this.surfaceMuted,
    required this.sidebar,
    required this.glass,
    required this.textPrimary,
    required this.textSecondary,
    required this.textMuted,
    required this.border,
    required this.accent,
    required this.accentMuted,
  });

  final Color canvas;
  final Color surface;
  final Color surfaceMuted;
  final Color sidebar;
  final Color glass;
  final Color textPrimary;
  final Color textSecondary;
  final Color textMuted;
  final Color border;
  /// Primary action / online / selection accent (varies per theme).
  final Color accent;
  /// Subtle highlight behind selected rows, nav items, chips.
  final Color accentMuted;

  /// Default light theme — lagoon glass surfaces.
  static const islandGlass = GuardianThemeColors(
    canvas: GuardianColors.canvas,
    surface: GuardianColors.surface,
    surfaceMuted: GuardianColors.surfaceMuted,
    sidebar: GuardianColors.ivory,
    glass: Color(0xF2FFFFFF),
    textPrimary: GuardianColors.textPrimary,
    textSecondary: GuardianColors.textSecondary,
    textMuted: GuardianColors.textMuted,
    border: GuardianColors.border,
    accent: GuardianColors.safe,
    accentMuted: GuardianColors.safeBg,
  );

  /// Dark theme — Le Morne basalt at dusk.
  static const leMorne = GuardianThemeColors(
    canvas: Color(0xFF0A100E),
    surface: Color(0xFF121C18),
    surfaceMuted: Color(0xFF172420),
    sidebar: Color(0xFF0E1613),
    glass: Color(0xD914201C),
    textPrimary: Color(0xFFF2F7F4),
    textSecondary: Color(0xFFB8C6C0),
    textMuted: Color(0xFF8A9892),
    border: Color(0xFF2E4038),
    accent: Color(0xFF3DD68C),
    accentMuted: Color(0xFF1A2E24),
  );

  /// High-contrast light theme for elder-care readability.
  static const elderCare = GuardianThemeColors(
    canvas: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    surfaceMuted: Color(0xFFF3F3F3),
    sidebar: Color(0xFFEBEBEB),
    glass: Color(0xFFFFFFFF),
    textPrimary: Color(0xFF000000),
    textSecondary: Color(0xFF1A1A1A),
    textMuted: Color(0xFF404040),
    border: Color(0xFF000000),
    accent: GuardianColors.safe,
    accentMuted: GuardianColors.safeBg,
  );

  /// Chamarel — volcanic earth and rainforest greens.
  static const chamarel = GuardianThemeColors(
    canvas: Color(0xFFF4F6F0),
    surface: Color(0xFFFDFCF8),
    surfaceMuted: Color(0xFFE8EDE4),
    sidebar: Color(0xFFEDF0EA),
    glass: Color(0xE6F8FAF4),
    textPrimary: Color(0xFF1E2A22),
    textSecondary: Color(0xFF5A6B5E),
    textMuted: Color(0xFF8A958C),
    border: Color(0xFFD4DFD6),
    accent: Color(0xFF2D8B5F),
    accentMuted: Color(0xFFD8EBE0),
  );

  /// Blue Bay — shallow lagoon turquoise and sky.
  static const blueBay = GuardianThemeColors(
    canvas: Color(0xFFE8F4F8),
    surface: Color(0xFFFFFFFF),
    surfaceMuted: Color(0xFFD6EEF5),
    sidebar: Color(0xFFE8F0F4),
    glass: Color(0xD9F0FAFD),
    textPrimary: Color(0xFF0A2A3A),
    textSecondary: Color(0xFF4A7080),
    textMuted: Color(0xFF7A9AAA),
    border: Color(0xFFB8D8E8),
    accent: Color(0xFF009688),
    accentMuted: Color(0xFFD0F0EC),
  );

  /// Indian Ocean Night — deep navy under a starlit horizon.
  static const indianOceanNight = GuardianThemeColors(
    canvas: Color(0xFF050A12),
    surface: Color(0xFF0C1520),
    surfaceMuted: Color(0xFF101E2A),
    sidebar: Color(0xFF080E16),
    glass: Color(0xD9122030),
    textPrimary: Color(0xFFE8F2FA),
    textSecondary: Color(0xFFA8BDCC),
    textMuted: Color(0xFF6A8899),
    border: Color(0xFF1E3344),
    accent: Color(0xFF4ECDC4),
    accentMuted: Color(0xFF142A28),
  );

  /// Sugar Beach — warm sand and late-afternoon light.
  static const sugarBeach = GuardianThemeColors(
    canvas: Color(0xFFFAF6F0),
    surface: Color(0xFFFFFCF8),
    surfaceMuted: Color(0xFFF2EBE0),
    sidebar: Color(0xFFF0E8DC),
    glass: Color(0xE6FFF9F2),
    textPrimary: Color(0xFF2A2418),
    textSecondary: Color(0xFF756858),
    textMuted: Color(0xFFA89888),
    border: Color(0xFFE8DDD0),
    accent: Color(0xFF6B9E6B),
    accentMuted: Color(0xFFE8F0E4),
  );

  static const light = islandGlass;
  static const dark = leMorne;

  @override
  GuardianThemeColors copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceMuted,
    Color? sidebar,
    Color? glass,
    Color? textPrimary,
    Color? textSecondary,
    Color? textMuted,
    Color? border,
    Color? accent,
    Color? accentMuted,
  }) {
    return GuardianThemeColors(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceMuted: surfaceMuted ?? this.surfaceMuted,
      sidebar: sidebar ?? this.sidebar,
      glass: glass ?? this.glass,
      textPrimary: textPrimary ?? this.textPrimary,
      textSecondary: textSecondary ?? this.textSecondary,
      textMuted: textMuted ?? this.textMuted,
      border: border ?? this.border,
      accent: accent ?? this.accent,
      accentMuted: accentMuted ?? this.accentMuted,
    );
  }

  @override
  GuardianThemeColors lerp(
    covariant ThemeExtension<GuardianThemeColors>? other,
    double t,
  ) {
    if (other is! GuardianThemeColors) return this;
    return GuardianThemeColors(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceMuted: Color.lerp(surfaceMuted, other.surfaceMuted, t)!,
      sidebar: Color.lerp(sidebar, other.sidebar, t)!,
      glass: Color.lerp(glass, other.glass, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      border: Color.lerp(border, other.border, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentMuted: Color.lerp(accentMuted, other.accentMuted, t)!,
    );
  }
}

extension GuardianThemeContext on BuildContext {
  GuardianThemeColors get guardianColors =>
      Theme.of(this).extension<GuardianThemeColors>() ??
      GuardianThemeColors.light;
}
