import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';

TextStyle? dashboardActionTextStyle(BuildContext context) =>
    Theme.of(context).filledButtonTheme.style?.textStyle?.resolve({});

ButtonStyle dashboardSecondaryActionStyle(BuildContext context) =>
    GuardianControlStyles.secondary(context).copyWith(
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      ),
    );
