import 'dart:ui';

import 'package:flutter/material.dart';

import 'guardian_surface.dart';
import '../../theme/app_theme.dart';

class GuardianCard extends StatelessWidget {
  const GuardianCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.radius = GuardianRadius.large,
    this.glass = false,
    this.color,
    this.onTap,
    this.borderColor,
    this.elevation = 1,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double radius;
  final bool glass;
  final Color? color;
  final VoidCallback? onTap;
  final Color? borderColor;
  final double elevation;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final content = GuardianSurface(
      padding: EdgeInsets.zero,
      radius: radius,
      color: color ?? (glass ? colors.glass : colors.surface),
      borderColor: borderColor,
      elevation: elevation,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(radius),
        child: Padding(padding: padding, child: child),
      ),
    );
    if (!glass) return content;
    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: content,
      ),
    );
  }
}
