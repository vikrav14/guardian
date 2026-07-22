import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

class ResponsiveLayout extends StatelessWidget {
  const ResponsiveLayout({
    super.key,
    required this.mobile,
    required this.desktop,
    this.breakpoint = GuardianBreakpoints.expanded,
  });

  final Widget mobile;
  final Widget desktop;
  final double breakpoint;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return width >= breakpoint ? desktop : mobile;
  }
}
