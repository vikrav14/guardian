import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../brand/dodo_ai_icon.dart';

/// Shared responsive frame for every primary Guardian destination.
///
/// It keeps the warm care-focused canvas and readable content width from the
/// approved concepts on both mobile and desktop.
class GuardianPageFrame extends StatelessWidget {
  const GuardianPageFrame({
    super.key,
    required this.child,
    this.maxWidth = 560,
  });

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          top: -120,
          right: -90,
          child: _Glow(
            size: 300,
            color: context.guardianColors.accent.withValues(alpha: 0.09),
          ),
        ),
        const Positioned(
          top: 360,
          left: -120,
          child: _Glow(size: 260, color: Color(0x16E8B765)),
        ),
        Center(
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: maxWidth),
            child: child,
          ),
        ),
      ],
    );
  }
}

class GuardianPageHeader extends StatelessWidget {
  const GuardianPageHeader({
    super.key,
    required this.title,
    required this.subtitle,
    this.action,
    this.showDodo = true,
  });

  final String title;
  final String subtitle;
  final Widget? action;
  final bool showDodo;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      children: [
        if (showDodo) ...[
          const GuardianBrandMark(size: 44, borderRadius: 15, iconScale: 0.62),
          const SizedBox(width: 12),
        ],
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontSize: 23,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.6,
                    ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: colors.textSecondary,
                      height: 1.3,
                    ),
              ),
            ],
          ),
        ),
        if (action != null) ...[const SizedBox(width: 10), action!],
      ],
    );
  }
}

class GuardianEmptyState extends StatelessWidget {
  const GuardianEmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(22, 28, 22, 24),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white.withValues(alpha: 0.82)),
        boxShadow: [
          BoxShadow(
            color: colors.textPrimary.withValues(alpha: 0.07),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: colors.accentMuted,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: colors.accent, size: 27),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
          ),
          const SizedBox(height: 5),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                  height: 1.45,
                ),
          ),
          if (action != null) ...[const SizedBox(height: 18), action!],
        ],
      ),
    );
  }
}

class _Glow extends StatelessWidget {
  const _Glow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(
            colors: [color, color.withValues(alpha: 0)],
          ),
        ),
      ),
    );
  }
}
