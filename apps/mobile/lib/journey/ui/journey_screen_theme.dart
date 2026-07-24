import 'package:flutter/material.dart';

/// Journey screen design tokens — dark map-first layout.
///
/// Text colors here are always light-on-dark. Do not use [GuardianThemeColors]
/// text roles on journey chrome; the app theme may be a light palette.
abstract final class JourneyScreenTheme {
  static const background = Color(0xFF0B1220);

  /// Floating panels over the map — opaque enough for readable labels.
  static const cardFill = Color(0xE6141E30); // rgba(20,30,48,0.90)
  static const cardBorder = Color(0x4DFFFFFF);

  static const accent = Color(0xFF3B82F6);
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);

  /// Light text for dark journey chrome (WCAG-friendly on cardFill/background).
  static const textPrimary = Color(0xFFF8FAFC);
  static const textSecondary = Color(0xFFCBD5E1);
  static const textMuted = Color(0xFF94A3B8);

  static const markerStart = success;
  static const markerStop = warning;
  static const markerEnd = danger;
  static const markerCurrent = accent;

  static const spacing = 8.0;
  static const spacing2 = 16.0;
  static const spacing3 = 24.0;

  static const radiusMedium = 16.0;
  static const radiusLarge = 20.0;

  static const headerHeight = 72.0;
  static const minTouchTarget = 48.0;

  static const animationDuration = Duration(milliseconds: 200);
  static const animationCurve = Curves.easeInOut;

  static const drawerCollapsedWidth = 28.0;
  static const drawerExpandedWidth = 280.0;
  static const drawerExpandedWidthWide = 320.0;

  static const playbackCollapsedHeight = 72.0;
  static const playbackExpandedHeight = 140.0;

  /// Clearance for Google Maps attribution / keyboard-shortcuts bar (web).
  static const mapAttributionInset = 32.0;

  /// Insets passed to [GoogleMap.padding] so native map UI stays visible.
  static EdgeInsets get mapControlPadding => EdgeInsets.only(
        top: spacing,
        right: drawerCollapsedWidth + spacing2,
        bottom: mapAttributionInset + playbackCollapsedHeight + spacing3,
        left: spacing,
      );

  /// Bottom offset for floating playback bar (above map attribution).
  static double get playbackBottomOffset => mapAttributionInset;

  /// Bottom offset for Ask Guardian (sits above playback, left side).
  static double get assistantBottomOffset =>
      mapAttributionInset + playbackCollapsedHeight + spacing2;

  /// Solid pill background for map FAB menu items (opaque — readable on any map).
  static const fabItemFill = Color(0xFF1E293B);
  static const fabItemFillActive = Color(0xFF2563EB);

  /// Forces light text/icons for all journey map overlays (avoids app light-theme bleed).
  static Widget chrome({required Widget child}) {
    const textTheme = TextTheme(
      bodyLarge: TextStyle(color: textPrimary),
      bodyMedium: TextStyle(color: textPrimary),
      bodySmall: TextStyle(color: textSecondary),
      labelLarge: TextStyle(color: textPrimary, fontWeight: FontWeight.w600),
      labelMedium: TextStyle(color: textPrimary),
      labelSmall: TextStyle(color: textSecondary),
    );
    return Theme(
      data: ThemeData(
        brightness: Brightness.dark,
        useMaterial3: true,
        textTheme: textTheme,
        iconTheme: const IconThemeData(color: textPrimary),
      ),
      child: DefaultTextStyle(
        style: textStyle(),
        child: IconTheme(
          data: const IconThemeData(color: textPrimary),
          child: child,
        ),
      ),
    );
  }

  static TextStyle textStyle({
    double fontSize = 14,
    FontWeight fontWeight = FontWeight.w500,
    Color? color,
    double? height,
  }) {
    return TextStyle(
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color ?? textPrimary,
      height: height,
    );
  }

  static BoxDecoration glassCard({double radius = radiusMedium}) => BoxDecoration(
        color: cardFill,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: cardBorder),
      );

  static BoxDecoration glassOverlay({double radius = radiusMedium}) => BoxDecoration(
        color: cardFill,
        borderRadius: BorderRadius.circular(radius),
        border: Border.all(color: cardBorder),
        boxShadow: const [
          BoxShadow(
            color: Color(0x66000000),
            blurRadius: 20,
            offset: Offset(0, 4),
          ),
        ],
      );
}
