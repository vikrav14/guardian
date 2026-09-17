import 'package:flutter/material.dart';

import '../theme/colors.dart';

/// A wellness action surface that keeps the supplied button's native behaviour.
///
/// Pass [enabled] to match the button's callback state. The button still owns its
/// callback, semantics, focus, keyboard handling and interaction feedback.
class WellnessControl extends StatelessWidget {
  const WellnessControl({
    super.key,
    required this.builder,
    this.emphasized = false,
    this.enabled = true,
  });

  final Widget Function(ButtonStyle style) builder;
  final bool emphasized;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = context.guardianColors;
    final dark = theme.brightness == Brightness.dark;
    final highContrast =
        MediaQuery.maybeOf(context)?.highContrast == true ||
        colors.border == GuardianThemeColors.elderCare.border;
    const radius = BorderRadius.all(Radius.circular(16));
    final foreground = emphasized
        ? Colors.white
        : highContrast
        ? colors.textPrimary
        : dark
        ? const Color(0xFFE1F9EB)
        : const Color(0xFF174C3C);
    final stops = emphasized
        ? const [Color(0xFF145F4C), Color(0xFF1B7E62)]
        : dark
        ? const [Color(0xFF163C33), Color(0xFF205145)]
        : const [Color(0xFFE8F6EC), Color(0xFFBAE5CE)];
    final base = !enabled
        ? colors.surfaceMuted
        : highContrast
        ? emphasized
              ? const Color(0xFF145F4C)
              : colors.surface
        : stops.first;
    final border = highContrast
        ? foreground
        : emphasized
        ? const Color(0xFF28785E)
        : dark
        ? const Color(0xFF3A7961)
        : const Color(0xFF86BDA2);

    final style = ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith((states) {
        if (!enabled || states.contains(WidgetState.disabled)) {
          return colors.surfaceMuted;
        }
        return Colors.transparent;
      }),
      foregroundColor: WidgetStateProperty.resolveWith((states) {
        if (!enabled || states.contains(WidgetState.disabled)) {
          return colors.textSecondary;
        }
        return foreground;
      }),
      overlayColor: WidgetStateProperty.resolveWith((states) {
        if (!enabled || states.contains(WidgetState.disabled)) {
          return Colors.transparent;
        }
        // A dark overlay preserves white text contrast on the emerald fill.
        final overlay = emphasized ? Colors.black : foreground;
        if (states.contains(WidgetState.pressed)) {
          return overlay.withValues(alpha: .10);
        }
        if (states.contains(WidgetState.focused)) {
          return overlay.withValues(alpha: .08);
        }
        if (states.contains(WidgetState.hovered)) {
          return overlay.withValues(alpha: .05);
        }
        return Colors.transparent;
      }),
      side: WidgetStateProperty.resolveWith((states) {
        if (!enabled || states.contains(WidgetState.disabled)) {
          return BorderSide(
            color: highContrast ? colors.textSecondary : colors.border,
            width: highContrast ? 2 : 1,
          );
        }
        final focused = states.contains(WidgetState.focused);
        return BorderSide(
          color: focused ? foreground : border,
          width: highContrast || focused ? 2 : 1,
        );
      }),
      shape: const WidgetStatePropertyAll(
        RoundedRectangleBorder(borderRadius: radius),
      ),
      minimumSize: const WidgetStatePropertyAll(Size(0, 48)),
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 18, vertical: 12),
      ),
      textStyle: WidgetStatePropertyAll(
        theme.textTheme.labelLarge?.copyWith(fontWeight: FontWeight.w600),
      ),
      elevation: const WidgetStatePropertyAll(0),
      shadowColor: const WidgetStatePropertyAll(Colors.transparent),
      surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
      visualDensity: VisualDensity.standard,
    );

    return ClipRRect(
      borderRadius: radius,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: base,
          borderRadius: radius,
          gradient: !enabled || highContrast
              ? null
              : LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: stops,
                ),
        ),
        child: builder(style),
      ),
    );
  }
}
