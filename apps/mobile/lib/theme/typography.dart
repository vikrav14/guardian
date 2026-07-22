import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

abstract final class GuardianTypography {
  static TextTheme build(TextTheme base, Color primary, Color secondary) {
    return GoogleFonts.interTextTheme(base).copyWith(
      headlineSmall: GoogleFonts.inter(
        fontSize: 24,
        height: 1.15,
        fontWeight: FontWeight.w700,
        color: primary,
      ),
      titleLarge: GoogleFonts.inter(
        fontSize: 19,
        fontWeight: FontWeight.w700,
        color: primary,
      ),
      titleMedium: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: primary,
      ),
      bodyMedium: GoogleFonts.inter(fontSize: 13, color: secondary),
      labelSmall: GoogleFonts.inter(fontSize: 11, color: secondary),
    );
  }
}
