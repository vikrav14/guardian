import 'package:flutter/material.dart';

import '../../theme/colors.dart';
import '../../theme/guardian_appearance.dart';

/// Bundled, decorative scenery. Content stays opaque and interactive above it.
/// Works both in a scrolling page and in a bounded Scaffold body.
class GuardianScenicBackground extends StatelessWidget {
  const GuardianScenicBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final scene = Theme.of(context).extension<GuardianSceneTheme>();
    final canvas = context.guardianColors.canvas;
    final visible =
        scene?.enabled == true && !MediaQuery.highContrastOf(context);
    return Stack(
      children: [
        if (visible)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            height: 560,
            child: IgnorePointer(
              child: ExcludeSemantics(
                child: RepaintBoundary(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.asset(
                        scene!.asset,
                        fit: BoxFit.cover,
                        alignment: const Alignment(0, -.2),
                        filterQuality: FilterQuality.medium,
                        errorBuilder: (_, _, _) => ColoredBox(color: canvas),
                      ),
                      DecoratedBox(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            stops: const [0, .25, .64, 1],
                            colors: [
                              canvas.withValues(
                                alpha: 1 - scene.strength * .45,
                              ),
                              canvas.withValues(alpha: 1 - scene.strength),
                              canvas.withValues(
                                alpha: 1 - scene.strength * .65,
                              ),
                              canvas,
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        child,
      ],
    );
  }
}
