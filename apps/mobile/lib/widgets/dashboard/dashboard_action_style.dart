import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';

TextStyle? dashboardActionTextStyle(BuildContext context) => Theme.of(
  context,
).textTheme.titleMedium?.copyWith(fontSize: 14, fontWeight: FontWeight.w700);

ButtonStyle dashboardSecondaryActionStyle(BuildContext context) {
  final colors = context.guardianColors;
  return OutlinedButton.styleFrom(
    foregroundColor: colors.textPrimary,
    disabledForegroundColor: colors.textSecondary,
    minimumSize: const Size(48, 48),
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
    side: BorderSide(
      color: Theme.of(context).brightness == Brightness.dark
          ? colors.accent
          : GuardianColors.forest,
    ),
    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
    textStyle: dashboardActionTextStyle(context),
    tapTargetSize: MaterialTapTargetSize.padded,
  );
}
