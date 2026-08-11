import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../theme/app_theme.dart';
import 'journey_models.dart';
import 'journey_v2_data.dart';
import 'journey_v2_replay_controller.dart';
import 'journey_v2_static_map.dart';

class JourneyV2Dashboard extends StatelessWidget {
  const JourneyV2Dashboard({
    super.key,
    required this.deviceName,
    this.avatarUrl,
    required this.day,
    required this.journeys,
    required this.selected,
    required this.onSelectJourney,
    required this.onBack,
    required this.onChooseDay,
  });

  final String deviceName;
  final String? avatarUrl;
  final DateTime day;
  final List<JourneyRecord> journeys;
  final JourneyRecord? selected;
  final ValueChanged<JourneyRecord> onSelectJourney;
  final VoidCallback onBack;
  final VoidCallback onChooseDay;

  @override
  Widget build(BuildContext context) {
    final meaningful = journeyV2MeaningfulRecords(journeys);
    final selectedRoute = selected == null
        ? null
        : journeyV2DecodeRecord(selected!);
    final totals = _DayTotals.fromJourneys(meaningful);

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 980;

        if (!desktop) {
          return CustomScrollView(
            slivers: [
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 180),
                sliver: SliverList.list(
                  children: [
                    _JourneyTopBar(
                      deviceName: deviceName,
                      avatarUrl: avatarUrl,
                      day: day,
                      tripCount: meaningful.length,
                      totalKm: totals.distanceKm,
                      totalDuration: totals.duration,
                      onBack: onBack,
                      onChooseDay: onChooseDay,
                    ),
                    const SizedBox(height: 14),
                    _DayOverviewCard(totals: totals),
                    const SizedBox(height: 14),
                    _DayGuardianRead(deviceName: deviceName, totals: totals),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: (meaningful.length * 58.0 + 72.0).clamp(
                        180.0,
                        560.0,
                      ),
                      child: _TripList(
                        journeys: meaningful,
                        selectedId: selected?.id,
                        onSelectJourney: onSelectJourney,
                      ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 760,
                      child: _SelectedTripPanel(
                        selected: selected,
                        route: selectedRoute,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        }

        return SingleChildScrollView(
          padding: const EdgeInsets.all(18),
          child: Column(
            children: [
              _JourneyTopBar(
                deviceName: deviceName,
                avatarUrl: avatarUrl,
                day: day,
                tripCount: meaningful.length,
                totalKm: totals.distanceKm,
                totalDuration: totals.duration,
                onBack: onBack,
                onChooseDay: onChooseDay,
              ),
              const SizedBox(height: 14),
              SizedBox(
                height: 760,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(
                      flex: 10,
                      child: _LeftDayColumn(
                        deviceName: deviceName,
                        totals: totals,
                        journeys: meaningful,
                        selectedId: selected?.id,
                        onSelectJourney: onSelectJourney,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      flex: 13,
                      child: _SelectedTripPanel(
                        selected: selected,
                        route: selectedRoute,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _JourneyTopBar extends StatelessWidget {
  const _JourneyTopBar({
    required this.deviceName,
    this.avatarUrl,
    required this.day,
    required this.tripCount,
    required this.totalKm,
    required this.totalDuration,
    required this.onBack,
    required this.onChooseDay,
  });

  final String deviceName;
  final String? avatarUrl;
  final DateTime day;
  final int tripCount;
  final double totalKm;
  final Duration totalDuration;
  final VoidCallback onBack;
  final VoidCallback onChooseDay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final now = DateTime.now();
    final isToday =
        day.year == now.year && day.month == now.month && day.day == now.day;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colors.border.withValues(alpha: 0.62)),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.05),
            blurRadius: 24,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          _SquareAction(icon: Icons.arrow_back_rounded, onTap: onBack),
          const SizedBox(width: 12),
          _JourneyAvatar(deviceName: deviceName, avatarUrl: avatarUrl),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$deviceName \u00B7 Journey',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                    letterSpacing: -0.35,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  '$tripCount trips | ${totalKm.toStringAsFixed(1)} km | '
                  '${_compactDuration(totalDuration)}',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onChooseDay,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 10),
              decoration: BoxDecoration(
                color: colors.canvas,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.calendar_month_rounded,
                    size: 16,
                    color: GuardianColors.safe,
                  ),
                  const SizedBox(width: 7),
                  Text(
                    isToday ? 'Today' : DateFormat('EEE, d MMM').format(day),
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyAvatar extends StatelessWidget {
  const _JourneyAvatar({required this.deviceName, this.avatarUrl});

  final String deviceName;
  final String? avatarUrl;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final url = avatarUrl?.trim();
    final hasAvatar = url != null && url.isNotEmpty;
    final trimmedName = deviceName.trim();
    final initial = trimmedName.isEmpty ? '?' : trimmedName[0].toUpperCase();

    return Container(
      width: 46,
      height: 46,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: GuardianColors.safe.withValues(alpha: 0.10),
        border: Border.all(color: GuardianColors.safe.withValues(alpha: 0.18)),
      ),
      child: hasAvatar
          ? Image.network(
              url,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => Center(
                child: Text(
                  initial,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            )
          : Center(
              child: Text(
                initial,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
    );
  }
}

class _SquareAction extends StatelessWidget {
  const _SquareAction({required this.icon, required this.onTap});

  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: colors.canvas,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Icon(icon, size: 20),
      ),
    );
  }
}

class _LeftDayColumn extends StatelessWidget {
  const _LeftDayColumn({
    required this.deviceName,
    required this.totals,
    required this.journeys,
    required this.selectedId,
    required this.onSelectJourney,
  });

  final String deviceName;
  final _DayTotals totals;
  final List<JourneyRecord> journeys;
  final String? selectedId;
  final ValueChanged<JourneyRecord> onSelectJourney;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _DayOverviewCard(totals: totals),
        const SizedBox(height: 12),
        _DayGuardianRead(deviceName: deviceName, totals: totals),
        const SizedBox(height: 12),
        Expanded(
          child: _TripList(
            journeys: journeys,
            selectedId: selectedId,
            onSelectJourney: onSelectJourney,
          ),
        ),
      ],
    );
  }
}

class _DayOverviewCard extends StatelessWidget {
  const _DayOverviewCard({required this.totals});

  final _DayTotals totals;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: colors.border.withValues(alpha: 0.62)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _SectionTitle(
            icon: Icons.bar_chart_rounded,
            title: "TODAY'S JOURNEY OVERVIEW",
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: _OverviewMetric(
                  value: '${totals.distanceKm.toStringAsFixed(1)} km',
                  label: 'Total distance',
                ),
              ),
              Expanded(
                child: _OverviewMetric(
                  value: _compactDuration(totals.duration),
                  label: 'Total duration',
                ),
              ),
              Expanded(
                child: _OverviewMetric(
                  value: '${totals.pointCount}',
                  label: 'Route points',
                ),
              ),
              Expanded(
                child: _OverviewMetric(
                  value: '${totals.tripCount}',
                  label: 'Trips',
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),
          _DayRouteStrip(startAt: totals.startAt, endAt: totals.endAt),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      children: [
        Container(
          width: 30,
          height: 30,
          decoration: BoxDecoration(
            color: GuardianColors.safe.withValues(alpha: 0.11),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(icon, size: 17, color: GuardianColors.safe),
        ),
        const SizedBox(width: 9),
        Text(
          title,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: 11,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }
}

class _OverviewMetric extends StatelessWidget {
  const _OverviewMetric({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      children: [
        Text(
          value,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: 15,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: colors.textMuted,
            fontSize: 8,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _DayRouteStrip extends StatelessWidget {
  const _DayRouteStrip({required this.startAt, required this.endAt});

  final DateTime? startAt;
  final DateTime? endAt;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _TimelineEndpoint(
          letter: 'A',
          label: startAt == null ? '--:--' : DateFormat.Hm().format(startAt!),
          caption: 'Start',
          color: GuardianColors.safe,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                height: 3,
                decoration: BoxDecoration(
                  color: GuardianColors.safe,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  for (var i = 0; i < 7; i++)
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: GuardianColors.safe,
                          width: 2,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 9),
        _TimelineEndpoint(
          letter: 'B',
          label: endAt == null ? '--:--' : DateFormat.Hm().format(endAt!),
          caption: 'Arrival',
          color: const Color(0xFFE84C4C),
        ),
      ],
    );
  }
}

class _TimelineEndpoint extends StatelessWidget {
  const _TimelineEndpoint({
    required this.letter,
    required this.label,
    required this.caption,
    required this.color,
  });

  final String letter;
  final String label;
  final String caption;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      children: [
        Container(
          width: 34,
          height: 34,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Text(
            letter,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: 9,
            fontWeight: FontWeight.w900,
          ),
        ),
        Text(caption, style: TextStyle(color: colors.textMuted, fontSize: 8)),
      ],
    );
  }
}

class _DayGuardianRead extends StatelessWidget {
  const _DayGuardianRead({required this.deviceName, required this.totals});

  final String deviceName;
  final _DayTotals totals;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: GuardianColors.forest,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: GuardianColors.safe.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(13),
            ),
            child: const Icon(
              Icons.auto_awesome_rounded,
              color: GuardianColors.safe,
              size: 20,
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'GUARDIAN READ',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  '$deviceName recorded ${totals.distanceKm.toStringAsFixed(1)} km '
                  'across ${totals.tripCount} trips. '
                  '${totals.pointCount} route points are available for review.',
                  style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.78),
                    fontSize: 9,
                    height: 1.45,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          const Icon(
            Icons.verified_rounded,
            color: GuardianColors.safe,
            size: 20,
          ),
        ],
      ),
    );
  }
}

class _TripList extends StatelessWidget {
  const _TripList({
    required this.journeys,
    required this.selectedId,
    required this.onSelectJourney,
  });

  final List<JourneyRecord> journeys;
  final String? selectedId;
  final ValueChanged<JourneyRecord> onSelectJourney;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: colors.border.withValues(alpha: 0.62)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'TRIPS',
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontSize: 11,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${journeys.length} recorded',
                      style: TextStyle(
                        color: colors.textMuted,
                        fontSize: 8,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
              Text(
                'Sort by time',
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.keyboard_arrow_down_rounded, size: 16),
            ],
          ),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.separated(
              itemCount: journeys.length,
              separatorBuilder: (_, _) => const SizedBox(height: 7),
              itemBuilder: (context, index) {
                final journey = journeys[index];
                return _TripRow(
                  key: ValueKey('journey-trip-${journey.id}'),
                  index: index,
                  journey: journey,
                  selected: journey.id == selectedId,
                  onTap: () => onSelectJourney(journey),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _TripRow extends StatelessWidget {
  const _TripRow({
    super.key,
    required this.index,
    required this.journey,
    required this.selected,
    required this.onTap,
  });

  final int index;
  final JourneyRecord journey;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final duration = _durationOf(journey);

    return Material(
      color: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 10),
          decoration: BoxDecoration(
            color: selected
                ? GuardianColors.safe.withValues(alpha: 0.10)
                : colors.canvas,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: selected
                  ? GuardianColors.safe.withValues(alpha: 0.48)
                  : colors.border.withValues(alpha: 0.58),
              width: selected ? 1.4 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 30,
                height: 30,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: selected ? GuardianColors.safe : colors.surface,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: selected ? GuardianColors.safe : colors.border,
                  ),
                ),
                child: Text(
                  '${index + 1}',
                  style: TextStyle(
                    color: selected ? Colors.white : colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              const SizedBox(width: 9),
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: _tripIconColor(index).withValues(alpha: 0.10),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _tripIcon(index),
                  size: 15,
                  color: _tripIconColor(index),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 4,
                child: Text(
                  '${DateFormat.Hm().format(journey.startAt)} - '
                  '${DateFormat.Hm().format(journey.endAt)}',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  '${journey.distanceKm.toStringAsFixed(1)} km',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  _compactDuration(duration),
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Expanded(
                flex: 2,
                child: Text(
                  '${journey.pointCount} pts',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              Icon(
                selected
                    ? Icons.check_circle_rounded
                    : Icons.chevron_right_rounded,
                size: 17,
                color: selected ? GuardianColors.safe : colors.textMuted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SelectedTripPanel extends StatefulWidget {
  const _SelectedTripPanel({required this.selected, required this.route});

  final JourneyRecord? selected;
  final JourneyV2Route? route;

  @override
  State<_SelectedTripPanel> createState() => _SelectedTripPanelState();
}

class _SelectedTripPanelState extends State<_SelectedTripPanel> {
  JourneyV2ReplayController? _replay;

  @override
  void initState() {
    super.initState();
    _configureReplay();
  }

  @override
  void didUpdateWidget(covariant _SelectedTripPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    final tripChanged = oldWidget.selected?.id != widget.selected?.id;
    final routeChanged =
        oldWidget.route?.record.polyline != widget.route?.record.polyline;
    if (tripChanged || routeChanged) {
      _configureReplay();
    }
  }

  void _configureReplay() {
    _replay?.dispose();
    final route = widget.route;
    _replay = route == null
        ? null
        : JourneyV2ReplayController(points: journeyV2StaticMapPoints(route));
  }

  @override
  void dispose() {
    _replay?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final journey = widget.selected;
    final selectedRoute = widget.route;
    final replay = _replay;

    if (journey == null || selectedRoute == null || replay == null) {
      return Container(
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: colors.border),
        ),
        child: Text(
          'Select a journey to inspect it.',
          style: TextStyle(color: colors.textSecondary),
        ),
      );
    }

    return ListenableBuilder(
      listenable: replay,
      builder: (context, _) {
        return Container(
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: colors.border.withValues(alpha: 0.62)),
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Text(
                          'SELECTED TRIP',
                          style: TextStyle(
                            color: colors.textPrimary,
                            fontSize: 11,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '${DateFormat.Hm().format(journey.startAt)} - '
                          '${DateFormat.Hm().format(journey.endAt)}',
                          style: TextStyle(
                            color: colors.textSecondary,
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    _SelectedTripAB(journey: journey),
                  ],
                ),
              ),
              Expanded(
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 14),
                  decoration: BoxDecoration(
                    color: colors.canvas,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: colors.border.withValues(alpha: 0.55),
                    ),
                  ),
                  child: Stack(
                    children: [
                      Positioned.fill(
                        child: JourneyV2StaticMap(
                          key: ValueKey('journey-map-${journey.id}'),
                          route: selectedRoute,
                          currentIndex: replay.currentIndex,
                        ),
                      ),
                      Positioned(
                        left: 16,
                        top: 16,
                        child: _MiniBadge(
                          label: '${replay.pointCount} route points',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              _SelectedMetricsRow(journey: journey, route: selectedRoute),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: _SelectedTripGuardianRead(
                  journey: journey,
                  route: selectedRoute,
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 14),
                child: _ReplayShell(journey: journey, replay: replay),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _SelectedTripAB extends StatelessWidget {
  const _SelectedTripAB({required this.journey});

  final JourneyRecord journey;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    final summary = Text(
      '${journey.distanceKm.toStringAsFixed(1)} km  |  '
      '${_compactDuration(_durationOf(journey))}  |  '
      '${journey.pointCount} pts',
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      textAlign: TextAlign.center,
      style: TextStyle(
        color: colors.textPrimary,
        fontSize: 10,
        fontWeight: FontWeight.w900,
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 760) {
          return Column(
            children: [
              Row(
                children: [
                  _CompactEndpoint(
                    letter: 'A',
                    time: DateFormat.Hm().format(journey.startAt),
                    caption: 'Start',
                    color: GuardianColors.safe,
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Container(
                        height: 2,
                        decoration: BoxDecoration(
                          color: GuardianColors.safe,
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                    ),
                  ),
                  _CompactEndpoint(
                    letter: 'B',
                    time: DateFormat.Hm().format(journey.endAt),
                    caption: 'Arrival',
                    color: const Color(0xFFE84C4C),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: GuardianColors.safe.withValues(alpha: 0.06),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: summary,
              ),
            ],
          );
        }

        return Row(
          children: [
            _CompactEndpoint(
              letter: 'A',
              time: DateFormat.Hm().format(journey.startAt),
              caption: 'Start',
              color: GuardianColors.safe,
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                children: [
                  Container(
                    height: 2,
                    decoration: BoxDecoration(
                      color: GuardianColors.safe,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 7),
                  summary,
                ],
              ),
            ),
            const SizedBox(width: 14),
            _CompactEndpoint(
              letter: 'B',
              time: DateFormat.Hm().format(journey.endAt),
              caption: 'Arrival',
              color: const Color(0xFFE84C4C),
            ),
          ],
        );
      },
    );
  }
}

class _CompactEndpoint extends StatelessWidget {
  const _CompactEndpoint({
    required this.letter,
    required this.time,
    required this.caption,
    required this.color,
  });

  final String letter;
  final String time;
  final String caption;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          child: Text(
            letter,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              time,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            ),
            Text(
              caption,
              style: TextStyle(color: colors.textMuted, fontSize: 8),
            ),
          ],
        ),
      ],
    );
  }
}

class _MiniBadge extends StatelessWidget {
  const _MiniBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: GuardianColors.forest,
          fontSize: 8,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _SelectedMetricsRow extends StatelessWidget {
  const _SelectedMetricsRow({required this.journey, required this.route});

  final JourneyRecord journey;
  final JourneyV2Route route;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 14),
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: colors.canvas,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Expanded(
            child: _SelectedMetric(
              icon: Icons.straighten_rounded,
              value: '${journey.distanceKm.toStringAsFixed(1)} km',
              label: 'Distance',
            ),
          ),
          Expanded(
            child: _SelectedMetric(
              icon: Icons.schedule_rounded,
              value: _compactDuration(_durationOf(journey)),
              label: 'Duration',
            ),
          ),
          Expanded(
            child: _SelectedMetric(
              icon: Icons.route_rounded,
              value: '${route.decodedPointCount}',
              label: 'Route points',
            ),
          ),
          Expanded(
            child: _SelectedMetric(
              icon: Icons.pause_circle_outline_rounded,
              value: _structuredStopMetric(journey),
              label: 'Stops',
            ),
          ),
        ],
      ),
    );
  }
}

class _SelectedMetric extends StatelessWidget {
  const _SelectedMetric({
    required this.icon,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      children: [
        Icon(icon, size: 17, color: GuardianColors.safe),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
        Text(label, style: TextStyle(color: colors.textMuted, fontSize: 8)),
      ],
    );
  }
}

class _SelectedTripGuardianRead extends StatelessWidget {
  const _SelectedTripGuardianRead({required this.journey, required this.route});

  final JourneyRecord journey;
  final JourneyV2Route route;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: GuardianColors.safe.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: GuardianColors.safe.withValues(alpha: 0.16)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.psychology_alt_rounded,
            color: GuardianColors.safe,
            size: 20,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'GUARDIAN READ',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  _selectedTripGuardianReadText(journey, route),
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    height: 1.45,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ReplayShell extends StatelessWidget {
  const _ReplayShell({required this.journey, required this.replay});

  final JourneyRecord journey;
  final JourneyV2ReplayController replay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final currentTime = replay.currentTime ?? journey.startAt;

    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      decoration: BoxDecoration(
        color: colors.canvas,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.border.withValues(alpha: 0.58)),
      ),
      child: Row(
        children: [
          IconButton(
            key: const ValueKey('journey-replay-toggle'),
            tooltip: replay.isPlaying ? 'Pause replay' : 'Play replay',
            onPressed: replay.canReplay ? replay.toggle : null,
            style: IconButton.styleFrom(
              fixedSize: const Size(40, 40),
              backgroundColor: replay.isPlaying
                  ? GuardianColors.safe
                  : GuardianColors.safe.withValues(alpha: 0.10),
              foregroundColor: replay.isPlaying
                  ? Colors.white
                  : GuardianColors.safe,
              side: const BorderSide(color: GuardianColors.safe),
            ),
            icon: Icon(
              replay.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
            ),
          ),
          const SizedBox(width: 8),
          SizedBox(
            width: 42,
            child: Text(
              DateFormat.Hm().format(currentTime),
              textAlign: TextAlign.center,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: SliderTheme(
              data: SliderTheme.of(context).copyWith(
                trackHeight: 3,
                activeTrackColor: GuardianColors.safe,
                inactiveTrackColor: colors.border,
                thumbColor: GuardianColors.safe,
                overlayColor: GuardianColors.safe.withValues(alpha: 0.10),
                thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
                overlayShape: const RoundSliderOverlayShape(overlayRadius: 13),
              ),
              child: Slider(
                key: const ValueKey('journey-replay-slider'),
                value: replay.progress,
                onChanged: replay.canReplay ? replay.seekProgress : null,
              ),
            ),
          ),
          const SizedBox(width: 6),
          SizedBox(
            width: 42,
            child: Text(
              DateFormat.Hm().format(journey.endAt),
              textAlign: TextAlign.center,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 9,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(width: 8),
          InkWell(
            key: const ValueKey('journey-replay-speed'),
            borderRadius: BorderRadius.circular(10),
            onTap: replay.canReplay ? replay.cycleSpeed : null,
            child: Container(
              constraints: const BoxConstraints(minWidth: 42),
              padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 8),
              decoration: BoxDecoration(
                color: colors.surface,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                replay.speedLabel,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 9,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DayTotals {
  const _DayTotals({
    required this.distanceKm,
    required this.duration,
    required this.pointCount,
    required this.tripCount,
    required this.startAt,
    required this.endAt,
  });

  final double distanceKm;
  final Duration duration;
  final int pointCount;
  final int tripCount;
  final DateTime? startAt;
  final DateTime? endAt;

  factory _DayTotals.fromJourneys(List<JourneyRecord> journeys) {
    if (journeys.isEmpty) {
      return const _DayTotals(
        distanceKm: 0,
        duration: Duration.zero,
        pointCount: 0,
        tripCount: 0,
        startAt: null,
        endAt: null,
      );
    }

    final sorted = [...journeys]
      ..sort((a, b) => a.startAt.compareTo(b.startAt));

    return _DayTotals(
      distanceKm: journeys.fold<double>(
        0,
        (sum, journey) => sum + journey.distanceKm,
      ),
      duration: journeys.fold<Duration>(
        Duration.zero,
        (sum, journey) => sum + _durationOf(journey),
      ),
      pointCount: journeys.fold<int>(
        0,
        (sum, journey) => sum + journey.pointCount,
      ),
      tripCount: journeys.length,
      startAt: sorted.first.startAt,
      endAt: sorted.last.endAt,
    );
  }
}

Duration _durationOf(JourneyRecord journey) {
  final duration = journey.endAt.difference(journey.startAt);
  return duration.isNegative ? Duration.zero : duration;
}

String _compactDuration(Duration duration) {
  final minutes = duration.inMinutes;
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final remainder = minutes % 60;
  return remainder == 0 ? '${hours}h' : '${hours}h ${remainder}m';
}

bool _hasStructuredJourney(JourneyRecord journey) {
  return journey.stopCount > 0 ||
      journey.stops.isNotEmpty ||
      journey.legCount > 0 ||
      journey.legs.isNotEmpty;
}

String _structuredStopMetric(JourneyRecord journey) {
  if (!_hasStructuredJourney(journey)) return '--';
  if (journey.stopCount <= 0) return '0';

  return '${journey.stopCount} \u00B7 '
      '${_compactDuration(journey.totalStopDuration)}';
}

String _selectedTripGuardianReadText(
  JourneyRecord journey,
  JourneyV2Route route,
) {
  final base =
      'This trip recorded ${journey.distanceKm.toStringAsFixed(1)} km '
      'over ${_compactDuration(_durationOf(journey))}. '
      '${route.decodedPointCount} route points are available for this stored route.';

  if (!_hasStructuredJourney(journey)) return base;

  if (journey.stopCount <= 0) {
    return '$base No meaningful stops were recorded.';
  }

  final stopSummary = journey.stopCount == 1
      ? '1 stop was recorded during this outing'
      : '${journey.stopCount} stops were recorded during this outing';

  return '$base $stopSummary, totaling '
      '${_compactDuration(journey.totalStopDuration)}.';
}

IconData _tripIcon(int index) {
  const icons = [
    Icons.home_rounded,
    Icons.shopping_bag_rounded,
    Icons.local_hospital_rounded,
    Icons.apartment_rounded,
    Icons.park_rounded,
    Icons.restaurant_rounded,
    Icons.directions_car_rounded,
    Icons.flag_rounded,
  ];
  return icons[index % icons.length];
}

Color _tripIconColor(int index) {
  const colors = [
    Color(0xFF2CAF7B),
    Color(0xFFB05BE6),
    Color(0xFFF26767),
    Color(0xFF4385E7),
    Color(0xFF2CAF7B),
    Color(0xFFF3A23A),
    Color(0xFF4385E7),
    Color(0xFF2CAF7B),
  ];
  return colors[index % colors.length];
}
