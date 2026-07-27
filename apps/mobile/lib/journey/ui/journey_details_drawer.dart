import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../journey_replay_controller.dart';
import '../journey_utils.dart';
import 'journey_screen_theme.dart';

/// Collapsible right-side drawer with journey stats and summary.
class JourneyDetailsDrawer extends StatefulWidget {
  const JourneyDetailsDrawer({
    super.key,
    required this.replay,
    required this.weather,
  });

  final JourneyReplayController replay;
  final TypicalWeather weather;

  @override
  State<JourneyDetailsDrawer> createState() => _JourneyDetailsDrawerState();
}

class _JourneyDetailsDrawerState extends State<JourneyDetailsDrawer>
    with SingleTickerProviderStateMixin {
  var _expanded = false;

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= GuardianBreakpoints.expanded;
    final expandedWidth = isWide
        ? JourneyScreenTheme.drawerExpandedWidthWide
        : JourneyScreenTheme.drawerExpandedWidth;
    final width = _expanded ? expandedWidth : JourneyScreenTheme.drawerCollapsedWidth;

    return AnimatedContainer(
      duration: JourneyScreenTheme.animationDuration,
      curve: JourneyScreenTheme.animationCurve,
      width: width,
      child: Align(
        alignment: Alignment.centerRight,
        child: Material(
          color: Colors.transparent,
          child: Container(
            height: double.infinity,
            decoration: BoxDecoration(
              color: JourneyScreenTheme.cardFill,
              borderRadius: const BorderRadius.horizontal(
                left: Radius.circular(JourneyScreenTheme.radiusLarge),
              ),
              border: Border.all(color: JourneyScreenTheme.cardBorder),
            ),
            child: _expanded
                ? _ExpandedContent(
                    replay: widget.replay,
                    weather: widget.weather,
                    onCollapse: () => setState(() => _expanded = false),
                  )
                : _CollapsedHandle(onExpand: () => setState(() => _expanded = true)),
          ),
        ),
      ),
    );
  }
}

class _CollapsedHandle extends StatelessWidget {
  const _CollapsedHandle({required this.onExpand});

  final VoidCallback onExpand;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onExpand,
        borderRadius: const BorderRadius.horizontal(
          left: Radius.circular(JourneyScreenTheme.radiusLarge),
        ),
        child: Center(
          child: RotatedBox(
            quarterTurns: 3,
            child: Text(
              'Stats',
              style: JourneyScreenTheme.textStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: JourneyScreenTheme.textSecondary,
              ).copyWith(letterSpacing: 0.5),
            ),
          ),
        ),
      ),
    );
  }
}

class _ExpandedContent extends StatelessWidget {
  const _ExpandedContent({
    required this.replay,
    required this.weather,
    required this.onCollapse,
  });

  final JourneyReplayController replay;
  final TypicalWeather weather;
  final VoidCallback onCollapse;

  @override
  Widget build(BuildContext context) {
    final stats = replay.stats;
    final insights = replay.insights;
    final highlights = replay.highlights;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 12, 4, 8),
          child: Row(
            children: [
              Text(
                'Journey Stats',
                style: JourneyScreenTheme.textStyle(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Collapse',
                onPressed: onCollapse,
                icon: const Icon(
                  Icons.chevron_right_rounded,
                  color: JourneyScreenTheme.textMuted,
                ),
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
        ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
            children: [
              _StatRow(
                icon: Icons.route_rounded,
                label: 'Distance',
                value: '${stats.distanceKm.toStringAsFixed(1)} km',
              ),
              _StatRow(
                icon: Icons.schedule_rounded,
                label: 'Duration',
                value: formatJourneyDuration(stats.duration),
              ),
              _StatRow(
                icon: Icons.speed_rounded,
                label: 'Avg Speed',
                value: insights.avgSpeedKmh != null
                    ? '${insights.avgSpeedKmh!.toStringAsFixed(1)} km/h'
                    : 'N/A',
              ),
              _StatRow(
                icon: Icons.flash_on_rounded,
                label: 'Max Speed',
                value: highlights.highestSpeedKmh != null
                    ? '${highlights.highestSpeedKmh!.toStringAsFixed(0)} km/h'
                    : 'N/A',
              ),
              _StatRow(
                icon: Icons.gps_fixed_rounded,
                label: 'GPS Quality',
                value: insights.gpsQualityLabel,
              ),
              _StatRow(
                icon: Icons.battery_charging_full_rounded,
                label: 'Battery',
                value: '${replay.score.battery}/100',
              ),
              _StatRow(
                icon: Icons.pause_circle_outline_rounded,
                label: 'Stops',
                value: '${insights.stopCount}',
              ),
              _StatRow(
                icon: Icons.wb_sunny_outlined,
                label: 'Weather',
                value: '${weather.tempC}°C ${weather.label}',
              ),
              const SizedBox(height: JourneyScreenTheme.spacing2),
              _SummaryCard(
                routeSummary: insights.routeSummary,
                healthSummary: replay.health.summary,
                stars: replay.health.stars,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _StatRow extends StatelessWidget {
  const _StatRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(icon, size: 18, color: JourneyScreenTheme.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: JourneyScreenTheme.textStyle(
                fontSize: 12,
                color: JourneyScreenTheme.textSecondary,
              ),
            ),
          ),
          Text(
            value,
            style: JourneyScreenTheme.textStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.routeSummary,
    required this.healthSummary,
    required this.stars,
  });

  final String routeSummary;
  final String healthSummary;
  final int stars;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: JourneyScreenTheme.glassCard(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Summary',
            style: JourneyScreenTheme.textStyle(
              fontWeight: FontWeight.w700,
              fontSize: 13,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            routeSummary,
            style: JourneyScreenTheme.textStyle(
              fontSize: 12,
              height: 1.4,
              color: JourneyScreenTheme.textSecondary,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '${'★' * stars}${'☆' * (5 - stars)} $healthSummary',
            style: JourneyScreenTheme.textStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: JourneyScreenTheme.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
