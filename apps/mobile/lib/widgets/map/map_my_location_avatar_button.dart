import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';

/// Circular guardian-avatar control that recenters the map on the user's
/// location (replaces stock Maps my-location button).
class MapMyLocationAvatarButton extends StatelessWidget {
  const MapMyLocationAvatarButton({
    super.key,
    required this.initials,
    required this.onPressed,
    this.size = 40,
    this.avatarUrls,
    this.active = false,
    this.tooltip = 'My location',
  });

  final String initials;
  final VoidCallback onPressed;
  final double size;
  final Stream<String?>? avatarUrls;
  final bool active;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final button = Tooltip(
      message: tooltip,
      child: Material(
        color: active ? colors.accentMuted : colors.surface,
        elevation: 2,
        shadowColor: colors.textPrimary.withValues(alpha: 0.2),
        shape: const CircleBorder(),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onPressed,
          child: Stack(
            alignment: Alignment.center,
            children: [
              GuardianHeaderAvatar(
                initials: initials,
                color: colors.accent,
                size: size,
                avatarUrls: avatarUrls,
              ),
              if (active)
                Positioned(
                  right: 2,
                  bottom: 2,
                  child: Container(
                    width: 10,
                    height: 10,
                    decoration: BoxDecoration(
                      color: colors.accent,
                      shape: BoxShape.circle,
                      border: Border.all(color: colors.surface, width: 1.5),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );

    if (!kIsWeb) return button;
    return PointerInterceptor(child: button);
  }
}
