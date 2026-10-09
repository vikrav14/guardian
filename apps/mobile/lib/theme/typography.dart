import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

abstract final class GuardianTypography {
  static TextTheme build(TextTheme base, Color primary, Color secondary) {
    return GoogleFonts.interTextTheme(base).copyWith(
      headlineSmall: GoogleFonts.inter(
        fontSize: 26,
        height: 1.2,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.7,
        color: primary,
      ),
      titleLarge: GoogleFonts.inter(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.35,
        color: primary,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: primary,
      ),
      bodyMedium: GoogleFonts.inter(
        fontSize: 14,
        height: 1.4,
        color: secondary,
      ),
      labelSmall: GoogleFonts.inter(fontSize: 11, color: secondary),
    );
  }
}
