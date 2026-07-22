import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'journey_models.dart';
import 'journey_time_machine.dart';

/// Matches journey map overlay glass in [JourneyPage].
const _kJourneyControlGlassBlur = 20.0;
const _kJourneyControlGlassFillAlpha = 0.45;
const _kJourneyControlGlassBorderAlpha = 0.28;

Color _journeyControlGlassFill(GuardianThemeColors colors) =>
    colors.glass.withValues(alpha: _kJourneyControlGlassFillAlpha);

/// Corner controls for heat map, compare, map type, weather, and lighting info.
class JourneyMapControls extends StatelessWidget {
  const JourneyMapControls({
    super.key,
    required this.showHeatmap,
    required this.mapType,
    required this.compareMode,
    required this.lightingActive,
    required this.weatherLabel,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
  });

  final bool showHeatmap;
  final MapType mapType;
  final bool compareMode;
  final bool lightingActive;
  final String weatherLabel;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;

  @override
  Widget build(BuildContext context) {
    final isSatellite = mapType == MapType.hybrid;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        _ControlChip(
          icon: Icons.history_rounded,
          tooltip: JourneyPhase2Features.timeMachine,
          onPressed: onTimeMachine,
          active: false,
        ),
        const SizedBox(height: 6),
        _ControlChip(
          icon: showHeatmap ? Icons.route_rounded : Icons.blur_on_rounded,
          tooltip: showHeatmap ? 'Show route' : JourneyPhase2Features.heatMap,
          onPressed: onHeatmapToggle,
          active: showHeatmap,
        ),
        const SizedBox(height: 6),
        _ControlChip(
          icon: Icons.compare_arrows_rounded,
          tooltip: JourneyPhase2Features.compareMode,
          onPressed: onCompareToggle,
          active: compareMode,
        ),
        const SizedBox(height: 6),
        _ControlChip(
          icon: isSatellite ? Icons.map_outlined : Icons.satellite_alt_outlined,
          tooltip: isSatellite ? 'Street map' : 'Satellite',
          onPressed: onMapTypeToggle,
          active: isSatellite,
        ),
        const SizedBox(height: 6),
        _WeatherChip(label: weatherLabel),
        if (lightingActive) ...[
          const SizedBox(height: 6),
          _ControlChip(
            icon: Icons.nightlight_round,
            tooltip: JourneyPhase2Features.dynamicMapLighting,
            onPressed: () {},
            active: true,
          ),
        ],
      ],
    );
  }
}

class _ControlChip extends StatelessWidget {
  const _ControlChip({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    required this.active,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _kJourneyControlGlassBlur,
          sigmaY: _kJourneyControlGlassBlur,
        ),
        child: Material(
          color: active
              ? colors.accent.withValues(alpha: 0.22)
              : _journeyControlGlassFill(colors),
          borderRadius: BorderRadius.circular(12),
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(
                color: Colors.white.withValues(alpha: _kJourneyControlGlassBorderAlpha),
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: IconButton(
              tooltip: tooltip,
              onPressed: onPressed,
              icon: Icon(
                icon,
                size: 18,
                color: active ? colors.accent : colors.textPrimary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _WeatherChip extends StatelessWidget {
  const _WeatherChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _kJourneyControlGlassBlur,
          sigmaY: _kJourneyControlGlassBlur,
        ),
        child: Material(
          color: _journeyControlGlassFill(colors),
          borderRadius: BorderRadius.circular(12),
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border.all(
                color: Colors.white.withValues(alpha: _kJourneyControlGlassBorderAlpha),
              ),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: colors.textPrimary,
                  shadows: const [
                    Shadow(color: Color(0x33000000), blurRadius: 2),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Future<DateTime?> showTimeMachineSheet({
  required BuildContext context,
  required DateTime selectedDay,
  required Set<DateTime> daysWithData,
}) {
  final options = buildTimeMachineOptions(
    selectedDay: selectedDay,
    daysWithData: daysWithData,
  );
  final colors = context.guardianColors;

  return showModalBottomSheet<DateTime>(
    context: context,
    backgroundColor: colors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: colors.border,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                JourneyPhase2Features.timeMachine,
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                'Jump to a day with journey data',
                style: TextStyle(fontSize: 12, color: colors.textMuted),
              ),
              const SizedBox(height: 12),
              if (options.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    'No recent journey history found.',
                    style: TextStyle(color: colors.textSecondary),
                  ),
                )
              else
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: options.length,
                    separatorBuilder: (context, index) => Divider(color: colors.border, height: 1),
                    itemBuilder: (context, index) {
                      final option = options[index];
                      final isSelected = _sameDay(option.date, selectedDay);
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          option.label,
                          style: TextStyle(
                            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                            color: isSelected ? colors.accent : colors.textPrimary,
                          ),
                        ),
                        subtitle: option.subtitle != null
                            ? Text(
                                option.subtitle!,
                                style: TextStyle(fontSize: 11, color: colors.textMuted),
                              )
                            : null,
                        trailing: isSelected
                            ? Icon(Icons.check_rounded, color: colors.accent, size: 20)
                            : null,
                        onTap: () => Navigator.pop(context, option.date),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

Future<DateTime?> showCompareDayPicker({
  required BuildContext context,
  required DateTime primaryDay,
  required Set<DateTime> daysWithData,
}) {
  final candidates = daysWithData
      .where((d) => !_sameDay(d, primaryDay))
      .toList()
    ..sort((a, b) => b.compareTo(a));

  final colors = context.guardianColors;

  return showModalBottomSheet<DateTime>(
    context: context,
    backgroundColor: colors.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (context) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: colors.border,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              Text(
                'Compare with…',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 16,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 12),
              if (candidates.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    'No other days with journey data.',
                    style: TextStyle(color: colors.textSecondary),
                  ),
                )
              else
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: candidates.length.clamp(0, 14),
                    separatorBuilder: (context, index) => Divider(color: colors.border, height: 1),
                    itemBuilder: (context, index) {
                      final day = candidates[index];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          DateFormat.yMMMEd().format(day),
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            color: colors.textPrimary,
                          ),
                        ),
                        onTap: () => Navigator.pop(context, day),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
      );
    },
  );
}

bool _sameDay(DateTime a, DateTime b) {
  return a.year == b.year && a.month == b.month && a.day == b.day;
}
