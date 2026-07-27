import 'package:flutter/material.dart';

/// Journey screen design tokens aligned with Guardian's calm care experience.
abstract final class JourneyScreenTheme {
  static const background = Color(0xFFEDF1ED);

  static const cardFill = Color(0xF7FFFFFF);
  static const cardBorder = Color(0xFFE7ECE8);

  static const accent = Color(0xFF28A66D);
  static const success = Color(0xFF28A66D);
  static const warning = Color(0xFFD89B18);
  static const danger = Color(0xFFE83D45);

  static const textPrimary = Color(0xFF10233F);
  static const textSecondary = Color(0xFF60746B);
  static const textMuted = Color(0xFF89978E);

  static const markerStart = Color(0xFF173C32);
  static const markerStop = warning;
  static const markerEnd = danger;
  static const markerCurrent = Color(0xFF286BF3);

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
        right: spacing2,
        bottom: mapAttributionInset + playbackCollapsedHeight + spacing3,
        left: spacing2,
      );

  /// Bottom offset for floating playback bar (above map attribution).
  static double get playbackBottomOffset => mapAttributionInset;

  /// Bottom offset for Ask Guardian (sits above playback, left side).
  static double get assistantBottomOffset =>
      mapAttributionInset + playbackCollapsedHeight + spacing2;

  /// Solid pill background for map controls.
  static const fabItemFill = Color(0xFF173C32);
  static const fabItemFillActive = Color(0xFF2563EB);

  /// Gives all journey overlays the same light Guardian chrome.
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
        brightness: Brightness.light,
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: success,
          brightness: Brightness.light,
          surface: cardFill,
        ),
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
            color: Color(0x1A173C32),
            blurRadius: 28,
            offset: Offset(0, 10),
          ),
        ],
      );
}
