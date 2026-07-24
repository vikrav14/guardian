import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import 'journey_screen_theme.dart';

/// Single expandable FAB for map controls (top-right on map).
class JourneyFabMenu extends StatefulWidget {
  const JourneyFabMenu({
    super.key,
    required this.showHeatmap,
    required this.mapType,
    required this.compareMode,
    required this.mapLocked,
    required this.weatherLabel,
    required this.onLockToggle,
    required this.onMapTypeToggle,
    required this.onHistory,
    required this.onWeatherInfo,
    required this.onCenterMap,
    required this.onHeatmapToggle,
    required this.onCompareToggle,
  });

  final bool showHeatmap;
  final MapType mapType;
  final bool compareMode;
  final bool mapLocked;
  final String weatherLabel;
  final VoidCallback onLockToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onHistory;
  final VoidCallback onWeatherInfo;
  final VoidCallback onCenterMap;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onCompareToggle;

  @override
  State<JourneyFabMenu> createState() => _JourneyFabMenuState();
}

class _JourneyFabMenuState extends State<JourneyFabMenu>
    with SingleTickerProviderStateMixin {
  var _expanded = false;

  void _toggle() => setState(() => _expanded = !_expanded);

  void _action(VoidCallback callback) {
    callback();
    if (_expanded) setState(() => _expanded = false);
  }

  @override
  Widget build(BuildContext context) {
    final isSatellite = widget.mapType == MapType.hybrid;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedCrossFade(
          duration: JourneyScreenTheme.animationDuration,
          crossFadeState:
              _expanded ? CrossFadeState.showFirst : CrossFadeState.showSecond,
          firstChild: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              _FabMenuItem(
                icon: widget.mapLocked ? Icons.lock_rounded : Icons.lock_open_rounded,
                label: widget.mapLocked ? 'Unlock Map' : 'Lock Map',
                active: widget.mapLocked,
                onTap: () => _action(widget.onLockToggle),
              ),
              _FabMenuItem(
                icon: isSatellite ? Icons.map_outlined : Icons.satellite_alt_outlined,
                label: isSatellite ? 'Street View' : 'Satellite View',
                active: isSatellite,
                onTap: () => _action(widget.onMapTypeToggle),
              ),
              _FabMenuItem(
                icon: Icons.history_rounded,
                label: 'History',
                onTap: () => _action(widget.onHistory),
              ),
              _FabMenuItem(
                icon: Icons.wb_sunny_outlined,
                label: widget.weatherLabel,
                onTap: () => _action(widget.onWeatherInfo),
              ),
              _FabMenuItem(
                icon: Icons.my_location_rounded,
                label: 'Center Map',
                onTap: () => _action(widget.onCenterMap),
              ),
              _FabMenuItem(
                icon: widget.showHeatmap ? Icons.route_rounded : Icons.blur_on_rounded,
                label: widget.showHeatmap ? 'Show Route' : 'Heatmap',
                active: widget.showHeatmap,
                onTap: () => _action(widget.onHeatmapToggle),
              ),
              _FabMenuItem(
                icon: Icons.compare_arrows_rounded,
                label: widget.compareMode ? 'Exit Compare' : 'Compare',
                active: widget.compareMode,
                onTap: () => _action(widget.onCompareToggle),
              ),
              const SizedBox(height: JourneyScreenTheme.spacing),
            ],
          ),
          secondChild: const SizedBox.shrink(),
        ),
        FloatingActionButton(
          heroTag: 'journey_fab',
          backgroundColor: JourneyScreenTheme.success,
          foregroundColor: Colors.white,
          elevation: 4,
          onPressed: _toggle,
          child: AnimatedRotation(
            duration: JourneyScreenTheme.animationDuration,
            turns: _expanded ? 0.125 : 0,
            child: Icon(_expanded ? Icons.close_rounded : Icons.add_rounded),
          ),
        ),
      ],
    );
  }
}

class _FabMenuItem extends StatelessWidget {
  const _FabMenuItem({
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;

  Color get _iconColor =>
      active ? Colors.white : JourneyScreenTheme.textPrimary;

  Color get _textColor =>
      active ? Colors.white : JourneyScreenTheme.textPrimary;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: JourneyScreenTheme.spacing),
      child: Material(
        color: active ? JourneyScreenTheme.fabItemFillActive : JourneyScreenTheme.fabItemFill,
        elevation: 3,
        shadowColor: Colors.black54,
        borderRadius: BorderRadius.circular(JourneyScreenTheme.radiusMedium),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(JourneyScreenTheme.radiusMedium),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(JourneyScreenTheme.radiusMedium),
              border: Border.all(
                color: active
                    ? JourneyScreenTheme.accent
                    : JourneyScreenTheme.cardBorder,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 18, color: _iconColor),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: _textColor,
                    letterSpacing: 0.1,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
