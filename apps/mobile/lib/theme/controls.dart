import 'package:flutter/material.dart';

import 'colors.dart';

/// Actions use a readable shade of the selected island palette. Status and
/// weather colours remain independent of the control system.
Color guardianActionColor(GuardianThemeColors colors, Brightness brightness) {
  if (brightness == Brightness.dark) return colors.accent;
  for (var step = 0; step <= 20; step++) {
    final candidate = Color.lerp(colors.accent, colors.textPrimary, step / 20)!;
    if ([
      colors.surface,
      colors.surfaceMuted,
      colors.canvas,
      colors.accentMuted,
    ].every((surface) => guardianContrast(candidate, surface) >= 4.5)) {
      return candidate;
    }
  }
  return colors.textPrimary;
}

double guardianContrast(Color first, Color second) {
  final a = first.computeLuminance(), b = second.computeLuminance();
  return a > b ? (a + .05) / (b + .05) : (b + .05) / (a + .05);
}

abstract final class GuardianControlStyles {
  static ButtonStyle primary(BuildContext context) =>
      Theme.of(context).filledButtonTheme.style ?? const ButtonStyle();

  static ButtonStyle secondary(BuildContext context) =>
      Theme.of(context).outlinedButtonTheme.style ?? const ButtonStyle();

  static ButtonStyle link(BuildContext context) =>
      Theme.of(context).textButtonTheme.style ?? const ButtonStyle();

  static Color dangerColor(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark
      ? const Color(0xFFFFB4AB)
      : GuardianColors.dangerText;

  static ButtonStyle destructive(BuildContext context) =>
      primary(context).copyWith(
        backgroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? context.guardianColors.surfaceMuted
              : dangerColor(context),
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? context.guardianColors.textSecondary
              : Theme.of(context).brightness == Brightness.dark
              ? const Color(0xFF390A0C)
              : Colors.white,
        ),
      );

  static ButtonStyle destructiveLink(BuildContext context) =>
      link(context).copyWith(
        foregroundColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.disabled)
              ? context.guardianColors.textSecondary
              : dangerColor(context),
        ),
      );
}
