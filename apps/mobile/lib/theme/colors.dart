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
    this.highContrast = false,
  });

  final bool highContrast;

  /// A light accent in Le Morne needs dark text on filled controls.
  Color get onAccent =>
      accent.computeLuminance() > .45 ? const Color(0xFF112E32) : Colors.white;
  Color get disabled => Color.lerp(surfaceMuted, border, .35)!;
  Color get disabledInk => textSecondary;
  Color get safe => canvas.computeLuminance() < .1
      ? const Color(0xFF96D5B1)
      : const Color(0xFF176443);
  Color get safeBackground => canvas.computeLuminance() < .1
      ? const Color(0xFF203D32)
      : const Color(0xFFE4F4EB);
  Color get warning => canvas.computeLuminance() < .1
      ? const Color(0xFFF2D08B)
      : const Color(0xFF80590D);
  Color get danger => canvas.computeLuminance() < .1
      ? const Color(0xFFFFA4B0)
      : const Color(0xFFAC3041);

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
    canvas: Color(0xFF111C24),
    surface: Color(0xFF1C2A33),
    surfaceMuted: Color(0xFF23353F),
    sidebar: Color(0xFF1C2A33),
    glass: Color(0xFF1C2A33),
    textPrimary: Color(0xFFEDF3F4),
    textSecondary: Color(0xFFAFBFC4),
    textMuted: Color(0xFFAFBFC4),
    border: Color(0xFF405560),
    accent: Color(0xFF90CCD0),
    accentMuted: Color(0xFF293F49),
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
    canvas: Color(0xFFFAF3EE),
    surface: Color(0xFFFFFCF8),
    surfaceMuted: Color(0xFFF5E9E0),
    sidebar: Color(0xFFFFFCF8),
    glass: Color(0xFFFFFCF8),
    textPrimary: Color(0xFF3F2C28),
    textSecondary: Color(0xFF765D53),
    textMuted: Color(0xFF765D53),
    border: Color(0xFFDDC9BE),
    accent: Color(0xFF914836),
    accentMuted: Color(0xFFF0DFD5),
  );

  /// Blue Bay — shallow lagoon turquoise and sky.
  static const blueBay = GuardianThemeColors(
    canvas: Color(0xFFF0F7F7),
    surface: Color(0xFFFCFFFF),
    surfaceMuted: Color(0xFFEAF4F4),
    sidebar: Color(0xFFFCFFFF),
    glass: Color(0xFFFCFFFF),
    textPrimary: Color(0xFF17363C),
    textSecondary: Color(0xFF506A70),
    textMuted: Color(0xFF506A70),
    border: Color(0xFFC6D9DB),
    accent: Color(0xFF006C75),
    accentMuted: Color(0xFFDCEFF0),
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

  static const pamplemousses = GuardianThemeColors(
    canvas: Color(0xFFF1F5ED),
    surface: Color(0xFFFCFDF8),
    surfaceMuted: Color(0xFFEAF0E2),
    sidebar: Color(0xFFFCFDF8),
    glass: Color(0xFFFCFDF8),
    textPrimary: Color(0xFF26372A),
    textSecondary: Color(0xFF566952),
    textMuted: Color(0xFF566952),
    border: Color(0xFFCDD9C6),
    accent: Color(0xFF3D6544),
    accentMuted: Color(0xFFE1ECD9),
  );

  static const flicEnFlac = GuardianThemeColors(
    canvas: Color(0xFFFBF6EE),
    surface: Color(0xFFFFFDF8),
    surfaceMuted: Color(0xFFF7EDDE),
    sidebar: Color(0xFFFFFDF8),
    glass: Color(0xFFFFFDF8),
    textPrimary: Color(0xFF46341F),
    textSecondary: Color(0xFF77634C),
    textMuted: Color(0xFF77634C),
    border: Color(0xFFE0D1BB),
    accent: Color(0xFF895925),
    accentMuted: Color(0xFFF2E4CD),
  );

  static const light = blueBay;
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
    bool? highContrast,
  }) {
    return GuardianThemeColors(
      highContrast: highContrast ?? this.highContrast,
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
      highContrast: t < .5 ? highContrast : other.highContrast,
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
