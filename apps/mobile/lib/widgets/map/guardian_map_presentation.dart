import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:pointer_interceptor/pointer_interceptor.dart';

import '../../theme/app_theme.dart';

/// The calm Guardian map treatment used for live family tracking.
///
/// Roads and neighbourhood names stay readable, while commercial POIs,
/// transit clutter, and strong Google colours are reduced so the protected
/// person's position remains the visual focus.
abstract final class GuardianMapPresentation {
  static const style = r'''
[
  {
    "elementType": "geometry",
    "stylers": [{"color": "#F2F4EF"}]
  },
  {
    "elementType": "labels.icon",
    "stylers": [{"visibility": "off"}]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#65736B"}]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [{"color": "#F7F8F4"}]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#D8E0DA"}]
  },
  {
    "featureType": "landscape.natural",
    "elementType": "geometry",
    "stylers": [{"color": "#EAF3E9"}]
  },
  {
    "featureType": "poi",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry",
    "stylers": [{"color": "#FFFFFF"}]
  },
  {
    "featureType": "road",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#E2E8E3"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [{"color": "#D7E7DD"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry.stroke",
    "stylers": [{"color": "#BFD4C7"}]
  },
  {
    "featureType": "road.highway",
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#3F5B4E"}]
  },
  {
    "featureType": "transit",
    "stylers": [{"visibility": "off"}]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{"color": "#D9ECEC"}]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [{"color": "#668C8C"}]
  }
]
''';
}

/// Small Guardian-owned map controls.
///
/// The centre action follows the selected pendant wearer. It never requests or
/// uses the signed-in guardian's location.
class GuardianMapControlRail extends StatelessWidget {
  const GuardianMapControlRail({
    super.key,
    required this.trackedName,
    required this.onZoomIn,
    required this.onZoomOut,
    this.onCenterTrackedPerson,
  });

  final String trackedName;
  final VoidCallback onZoomIn;
  final VoidCallback onZoomOut;
  final VoidCallback? onCenterTrackedPerson;

  @override
  Widget build(BuildContext context) {
    final controls = Material(
      color: Colors.transparent,
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: context.guardianColors.surface.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.guardianColors.border),
          boxShadow: [
            BoxShadow(
              color: GuardianColors.forest.withValues(alpha: 0.12),
              blurRadius: 24,
              offset: const Offset(0, 9),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            _GuardianMapControl(
              tooltip: 'Zoom in',
              icon: Icons.add_rounded,
              onPressed: onZoomIn,
            ),
            const SizedBox(height: 3),
            _GuardianMapControl(
              tooltip: 'Zoom out',
              icon: Icons.remove_rounded,
              onPressed: onZoomOut,
            ),
            const SizedBox(height: 3),
            _GuardianMapControl(
              tooltip: 'Centre on $trackedName',
              icon: Icons.center_focus_strong_rounded,
              onPressed: onCenterTrackedPerson,
              accent: true,
            ),
          ],
        ),
      ),
    );

    if (!kIsWeb) return controls;
    return PointerInterceptor(child: controls);
  }
}

class _GuardianMapControl extends StatelessWidget {
  const _GuardianMapControl({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
    this.accent = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final enabled = onPressed != null;
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: tooltip,
        enabled: enabled,
        child: Material(
          color: accent && enabled ? colors.accentMuted : Colors.transparent,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            onTap: onPressed,
            borderRadius: BorderRadius.circular(11),
            child: SizedBox(
              width: 36,
              height: 36,
              child: Icon(
                icon,
                size: 19,
                color: !enabled
                    ? colors.textMuted.withValues(alpha: 0.45)
                    : accent
                        ? colors.accent
                        : colors.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
