import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

abstract final class GuardianTypography {
  static TextTheme build(TextTheme base, Color primary, Color secondary) {
    return GoogleFonts.manropeTextTheme(base).copyWith(
      headlineSmall: GoogleFonts.inter(
        fontSize: 26,
        height: 1.12,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.7,
        color: primary,
      ),
      titleLarge: GoogleFonts.inter(
        fontSize: 20,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.35,
        color: primary,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w700,
        color: primary,
      ),
      bodyMedium: GoogleFonts.manrope(fontSize: 13, height: 1.4, color: secondary),
      labelSmall: GoogleFonts.inter(fontSize: 11, color: secondary),
    );
  }
}
