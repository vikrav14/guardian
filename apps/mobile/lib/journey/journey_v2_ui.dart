import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/geofence.dart';
import '../theme/app_theme.dart';
import 'journey_models.dart';
import 'journey_v2_data.dart';
import 'journey_v2_replay_controller.dart';
import 'journey_v2_static_map.dart';

class JourneyV2Dashboard extends StatelessWidget {
  const JourneyV2Dashboard({
    super.key,
    required this.deviceName,
    this.deviceImei = '',
    this.avatarUrl,
    required this.day,
    required this.journeys,
    required this.selected,
    this.presentation,
    this.originGeofence,
    required this.onSelectJourney,
    required this.onBack,
    required this.onChooseDay,
  });

  final String deviceName;
  final String deviceImei;
  final String? avatarUrl;
  final DateTime day;
  final List<JourneyRecord> journeys;
  final JourneyRecord? selected;
  final JourneyRoutePresentation? presentation;
  final Geofence? originGeofence;
  final ValueChanged<JourneyRecord> onSelectJourney;
  final VoidCallback onBack;
  final VoidCallback onChooseDay;

  @override
  Widget build(BuildContext context) {
    final meaningful = journeyV2MeaningfulRecords(journeys);
    JourneyRecord? authoritativeSelected;
    if (selected != null) {
      for (final journey in meaningful) {
        if (journey.id == selected!.id) {
          authoritativeSelected = journey;
          break;
        }
      }
    }
    authoritativeSelected ??= meaningful.isEmpty ? null : meaningful.last;
    final selectedRoute = authoritativeSelected == null
        ? null
        : journeyV2DecodeRecord(
            authoritativeSelected,
            presentation: authoritativeSelected.id == selected?.id
                ? presentation
                : null,
          );
    final totals = _DayTotals.fromJourneys(
      meaningful,
      unconfirmedCount: journeys.length - meaningful.length,
    );

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
                        selectedId: authoritativeSelected?.id,
                        onSelectJourney: onSelectJourney,
                      ),
                    ),
                    const SizedBox(height: 14),
                    SizedBox(
                      height: 760,
                      child: _SelectedTripPanel(
                        selected: authoritativeSelected,
                        route: selectedRoute,
                        deviceName: deviceName,
                        deviceImei: deviceImei,
                        avatarUrl: avatarUrl,
                        originGeofence: originGeofence,
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
                        selectedId: authoritativeSelected?.id,
                        onSelectJourney: onSelectJourney,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      flex: 13,
                      child: _SelectedTripPanel(
                        selected: authoritativeSelected,
                        route: selectedRoute,
                        deviceName: deviceName,
                        deviceImei: deviceImei,
                        avatarUrl: avatarUrl,
                        originGeofence: originGeofence,
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
                  label: 'Recorded distance',
                ),
              ),
              Expanded(
                child: _OverviewMetric(
                  value: _compactDuration(totals.duration),
                  label: totals.allConfirmedReturns
                      ? 'Total time away'
                      : 'Recorded time',
                ),
              ),
              Expanded(
                child: _OverviewMetric(
                  value: '${totals.pointCount}',
                  label: 'Location points',
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
          _DayRouteStrip(
            startAt: totals.startAt,
            endAt: totals.endAt,
            confirmedReturn: totals.allConfirmedReturns,
          ),
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
  const _DayRouteStrip({
    required this.startAt,
    required this.endAt,
    required this.confirmedReturn,
  });

  final DateTime? startAt;
  final DateTime? endAt;
  final bool confirmedReturn;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _TimelineEndpoint(
          letter: 'A',
          label: startAt == null ? '--:--' : DateFormat.Hm().format(startAt!),
          caption: totals.allConfirmedReturns ? 'Left' : 'First recorded',
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
          caption: confirmedReturn ? 'Returned' : 'Last recorded',
          color: confirmedReturn
              ? GuardianColors.safe
              : const Color(0xFFE84C4C),
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
                  _dayGuardianReadText(deviceName, totals),
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
          Icon(
            totals.tripCount > 0
                ? Icons.route_rounded
                : Icons.info_outline_rounded,
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
            child: journeys.isEmpty
                ? Center(
                    child: Text(
                      'No confirmed journey recorded.',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  )
                : ListView.separated(
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
                  '${DateFormat.Hm().format(journey.confirmedDepartureAt)} - '
                  '${DateFormat.Hm().format(journey.confirmedReturnAt)}',
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
                  '${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km',
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
                  '${journey.pointCount} points',
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
  const _SelectedTripPanel({
    required this.selected,
    required this.route,
    required this.deviceName,
    required this.deviceImei,
    this.avatarUrl,
    this.originGeofence,
  });

  final JourneyRecord? selected;
  final JourneyV2Route? route;
  final String deviceName;
  final String deviceImei;
  final String? avatarUrl;
  final Geofence? originGeofence;

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
        oldWidget.route?.record.polyline != widget.route?.record.polyline ||
        oldWidget.route?.presentation?.generatedAt !=
            widget.route?.presentation?.generatedAt;
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
          'No confirmed journey recorded for this day.',
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
                          '${DateFormat.Hm().format(journey.confirmedDepartureAt)} - '
                          '${DateFormat.Hm().format(journey.confirmedReturnAt)}',
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
                          deviceName: widget.deviceName,
                          deviceImei: widget.deviceImei,
                          avatarUrl: widget.avatarUrl,
                          originGeofence: widget.originGeofence,
                          currentIndex: replay.currentIndex,
                          showReplayPosition: true,
                          onPointSelected: replay.seekIndex,
                        ),
                      ),
                      Positioned(
                        left: 16,
                        top: 16,
                        child: _MiniBadge(
                          label: _locationUpdateText(
                            journey,
                            replay.pointCount,
                          ),
                        ),
                      ),
                      Positioned(
                        left: 16,
                        top: 52,
                        child: _MapSourcePills(
                          hasGoogle:
                              selectedRoute.presentation?.hasGoogleSegments ==
                              true,
                        ),
                      ),
                      Positioned(
                        right: 16,
                        top: 16,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            _MapExpandButton(
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute<void>(
                                  builder: (_) => _JourneyFullScreenMap(
                                    journey: journey,
                                    route: selectedRoute,
                                    replay: replay,
                                    deviceName: widget.deviceName,
                                    deviceImei: widget.deviceImei,
                                    avatarUrl: widget.avatarUrl,
                                    originGeofence: widget.originGeofence,
                                  ),
                                ),
                              ),
                            ),
                            if (journey.hasInterruptedCoverage) ...[
                              const SizedBox(height: 8),
                              _MiniBadge(
                                label:
                                    'Tracking gap · ${_compactDuration(journey.routeCoverage.largestGap)}',
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              if (journey.hasInterruptedCoverage) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                  child: _RouteCoverageNotice(journey: journey),
                ),
              ],
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 0, 14, 12),
                child: _JourneyStoryCard(
                  journey: journey,
                  presentation: selectedRoute.presentation,
                ),
              ),
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
      '${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km  |  '
      '${_compactDuration(_durationOf(journey))}  |  '
      '${_locationUpdateText(journey, journey.pointCount)}',
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
                    time: DateFormat.Hm().format(journey.confirmedDepartureAt),
                    caption: _departureCaption(journey),
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
                    time: DateFormat.Hm().format(journey.confirmedReturnAt),
                    caption: _arrivalCaption(journey),
                    color: GuardianColors.safe,
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
              time: DateFormat.Hm().format(journey.confirmedDepartureAt),
              caption: _departureCaption(journey),
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
              time: DateFormat.Hm().format(journey.confirmedReturnAt),
              caption: _arrivalCaption(journey),
              color: GuardianColors.safe,
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

class _MapExpandButton extends StatelessWidget {
  const _MapExpandButton({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.96),
      borderRadius: BorderRadius.circular(11),
      elevation: 2,
      shadowColor: Colors.black.withValues(alpha: 0.10),
      child: InkWell(
        key: const ValueKey('journey-expand-map'),
        borderRadius: BorderRadius.circular(11),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.open_in_full_rounded,
                size: 15,
                color: GuardianColors.forest,
              ),
              SizedBox(width: 6),
              Text(
                'Expand map',
                style: TextStyle(
                  color: GuardianColors.forest,
                  fontSize: 8,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _JourneyFullScreenMap extends StatefulWidget {
  const _JourneyFullScreenMap({
    required this.journey,
    required this.route,
    required this.replay,
    required this.deviceName,
    required this.deviceImei,
    this.avatarUrl,
    this.originGeofence,
  });

  final JourneyRecord journey;
  final JourneyV2Route route;
  final JourneyV2ReplayController replay;
  final String deviceName;
  final String deviceImei;
  final String? avatarUrl;
  final Geofence? originGeofence;

  @override
  State<_JourneyFullScreenMap> createState() =>
      _JourneyFullScreenMapState();
}

class _JourneyFullScreenMapState extends State<_JourneyFullScreenMap> {
  final JourneyV2StaticMapController _mapController =
      JourneyV2StaticMapController();
  bool _showSourceEvidence = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final compact = MediaQuery.sizeOf(context).width < 600;
    final journey = widget.journey;
    final route = widget.route;
    final replay = widget.replay;
    final sourceEvidenceCount = journeyV2RecordedGpsEvidencePoints(
      route,
    ).length;
    return ListenableBuilder(
      listenable: replay,
      builder: (context, _) {
        return Scaffold(
          backgroundColor: colors.canvas,
          body: SafeArea(
            child: Stack(
              children: [
                Positioned.fill(
                  child: JourneyV2StaticMap(
                    key: ValueKey('journey-fullscreen-map-${journey.id}'),
                    route: route,
                    deviceName: widget.deviceName,
                    deviceImei: widget.deviceImei,
                    avatarUrl: widget.avatarUrl,
                    originGeofence: widget.originGeofence,
                    controller: _mapController,
                    currentIndex: replay.currentIndex,
                    showReplayPosition: true,
                    showMapTypeControl: true,
                    showSourceEvidence: _showSourceEvidence,
                    onPointSelected: replay.seekIndex,
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  top: 16,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Material(
                        color: Colors.white.withValues(alpha: 0.96),
                        shape: const CircleBorder(),
                        elevation: 2,
                        child: IconButton(
                          key: const ValueKey('journey-close-fullscreen-map'),
                          tooltip: 'Close full-screen map',
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded),
                          color: GuardianColors.forest,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 11,
                          ),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.96),
                            borderRadius: BorderRadius.circular(14),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.08),
                                blurRadius: 14,
                              ),
                            ],
                          ),
                          child: Text(
                            '${_departureCaption(journey)} · '
                            '${DateFormat.Hm().format(journey.confirmedDepartureAt)}  →  '
                            '${_arrivalCaption(journey)} · '
                            '${DateFormat.Hm().format(journey.confirmedReturnAt)}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: GuardianColors.forest,
                              fontSize: 11,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: compact ? 16 : 72,
                  right: compact ? 16 : null,
                  top: compact ? 132 : 84,
                  child: _ReplayLocationCard(
                    journey: journey,
                    route: route,
                    replay: replay,
                  ),
                ),
                Positioned(
                  left: 16,
                  right: compact ? 16 : null,
                  bottom: journey.hasInterruptedCoverage ? 160 : 94,
                  child: _FullScreenMapToolbar(
                    hasGoogle: route.presentation?.hasGoogleSegments == true,
                    sourceEvidenceCount: sourceEvidenceCount,
                    sourceEvidenceVisible: _showSourceEvidence,
                    onFitRoute: () {
                      unawaited(_mapController.fitCompleteRoute());
                    },
                    onToggleSourceEvidence: () => setState(() {
                      _showSourceEvidence = !_showSourceEvidence;
                    }),
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: journey.hasInterruptedCoverage ? 84 : 18,
                  child: _ReplayShell(journey: journey, replay: replay),
                ),
                if (journey.hasInterruptedCoverage)
                  Positioned(
                    left: 16,
                    right: 16,
                    bottom: 18,
                    child: _RouteCoverageNotice(journey: journey),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _MapSourcePills extends StatelessWidget {
  const _MapSourcePills({required this.hasGoogle, this.showSources = false});

  final bool hasGoogle;
  final bool showSources;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (!showSources)
          const _MapSourcePill(color: Color(0xFF4F5CCB), label: 'Journey route')
        else
          const _MapSourcePill(color: Color(0xFF2563EB), label: 'GPS'),
        if (showSources && hasGoogle) ...[
          const SizedBox(width: 6),
          const _MapSourcePill(color: Color(0xFF7C3AED), label: 'Google'),
        ],
      ],
    );
  }
}

class _FullScreenMapToolbar extends StatelessWidget {
  const _FullScreenMapToolbar({
    required this.hasGoogle,
    required this.sourceEvidenceCount,
    required this.sourceEvidenceVisible,
    required this.onFitRoute,
    required this.onToggleSourceEvidence,
  });

  final bool hasGoogle;
  final int sourceEvidenceCount;
  final bool sourceEvidenceVisible;
  final VoidCallback onFitRoute;
  final VoidCallback onToggleSourceEvidence;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.96),
      borderRadius: BorderRadius.circular(18),
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.10),
      child: Padding(
        padding: const EdgeInsets.all(9),
        child: Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            _MapSourcePills(
              hasGoogle: hasGoogle,
              showSources: sourceEvidenceVisible,
            ),
            _JourneyMapActionButton(
              key: const ValueKey('journey-fit-complete-route'),
              icon: Icons.fit_screen_rounded,
              label: 'Fit complete route',
              onTap: onFitRoute,
            ),
            _JourneyMapActionButton(
              key: const ValueKey('journey-toggle-source-evidence'),
              icon: sourceEvidenceVisible
                  ? Icons.visibility_off_outlined
                  : Icons.scatter_plot_rounded,
              label: sourceEvidenceVisible
                  ? 'Hide $sourceEvidenceCount GPS points'
                  : 'Show $sourceEvidenceCount GPS points',
              active: sourceEvidenceVisible,
              onTap: onToggleSourceEvidence,
            ),
          ],
        ),
      ),
    );
  }
}

class _JourneyMapActionButton extends StatelessWidget {
  const _JourneyMapActionButton({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.active = false,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final foreground = active ? const Color(0xFF5B34C8) : colors.textPrimary;
    return Material(
      color: active
          ? const Color(0xFF7C3AED).withValues(alpha: 0.10)
          : colors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: active
              ? const Color(0xFF7C3AED).withValues(alpha: 0.32)
              : colors.border,
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 15, color: foreground),
              const SizedBox(width: 7),
              Text(
                label,
                style: TextStyle(
                  color: foreground,
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MapSourcePill extends StatelessWidget {
  const _MapSourcePill({required this.color, required this.label});

  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(999),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 10,
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 16,
            height: 3,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(999),
            ),
          ),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              color: GuardianColors.forest,
              fontSize: 8,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReplayLocationCard extends StatelessWidget {
  const _ReplayLocationCard({
    required this.journey,
    required this.route,
    required this.replay,
  });

  final JourneyRecord journey;
  final JourneyV2Route route;
  final JourneyV2ReplayController replay;

  @override
  Widget build(BuildContext context) {
    final point = replay.currentPoint;
    if (point == null) return const SizedBox.shrink();
    final colors = context.guardianColors;
    final sourcePointIndex = point.sourcePointIndex ?? replay.currentIndex;
    final nearbyPlace = route.presentation?.placeForPoint(sourcePointIndex);
    final label = _pointPlaceLabel(
      journey,
      sourcePointIndex,
      presentation: route.presentation,
    );
    final time = point.recordedAt ?? journey.confirmedDepartureAt;
    final pendingGap = replay.pendingTrackingGap;
    final skippingGap = replay.isSkippingTrackingGap && pendingGap != null;

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 310),
      child: Container(
        key: const ValueKey('journey-replay-location-card'),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(13),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.09),
              blurRadius: 14,
            ),
          ],
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              skippingGap
                  ? Icons.signal_wifi_connected_no_internet_4_rounded
                  : Icons.location_on_outlined,
              size: 18,
              color: skippingGap
                  ? const Color(0xFFB66A00)
                  : const Color(0xFF4C5BD4),
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    skippingGap
                        ? 'Tracking unavailable · ${_compactDuration(pendingGap)}'
                        : '${DateFormat.Hm().format(time)} · $label',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    skippingGap
                        ? 'Skipping to the next recorded location'
                        : nearbyPlace != null
                        ? 'Nearby place · Google Maps'
                        : label == 'Recorded location'
                        ? 'Location name unavailable'
                        : 'Recorded GPS location',
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 8,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RouteCoverageNotice extends StatelessWidget {
  const _RouteCoverageNotice({required this.journey});

  final JourneyRecord journey;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF5E8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF1B35D)),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.signal_wifi_connected_no_internet_4_rounded,
            color: Color(0xFFB66A00),
            size: 18,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              _routeGapText(journey),
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 9,
                height: 1.35,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyStoryCard extends StatelessWidget {
  const _JourneyStoryCard({required this.journey, required this.presentation});

  final JourneyRecord journey;
  final JourneyRoutePresentation? presentation;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: GuardianColors.safe.withValues(alpha: 0.055),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: GuardianColors.safe.withValues(alpha: 0.15)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: GuardianColors.safe.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(9),
            ),
            child: const Icon(
              Icons.auto_stories_rounded,
              size: 16,
              color: GuardianColors.safe,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'JOURNEY STORY',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _journeyStoryText(journey, presentation: presentation),
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 9,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (presentation?.stopPlaces.isNotEmpty == true) ...[
                  const SizedBox(height: 5),
                  Text(
                    'Nearby places · Google Maps',
                    style: TextStyle(
                      color: colors.textSecondary.withValues(alpha: 0.82),
                      fontSize: 7.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ],
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
              value:
                  '${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km',
              label: 'Recorded distance',
            ),
          ),
          Expanded(
            child: _SelectedMetric(
              icon: Icons.schedule_rounded,
              value: _compactDuration(_durationOf(journey)),
              label: journey.hasConfirmedReturn ? 'Time away' : 'Recorded time',
            ),
          ),
          Expanded(
            child: _SelectedMetric(
              icon: Icons.route_rounded,
              value: '${route.decodedPointCount}',
              label: _allLocationUpdatesAreGps(journey)
                  ? 'GPS location points'
                  : 'Location points',
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
    final currentTime = replay.currentIndex == 0
        ? journey.confirmedDepartureAt
        : (replay.currentTime ?? journey.confirmedDepartureAt);

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
              DateFormat.Hm().format(journey.confirmedReturnAt),
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
    required this.allConfirmedReturns,
    required this.gapCount,
    required this.largestGap,
    this.unconfirmedCount = 0,
  });

  final double distanceKm;
  final Duration duration;
  final int pointCount;
  final int tripCount;
  final DateTime? startAt;
  final DateTime? endAt;
  final bool allConfirmedReturns;
  final int gapCount;
  final Duration largestGap;
  final int unconfirmedCount;

  factory _DayTotals.fromJourneys(
    List<JourneyRecord> journeys, {
    int unconfirmedCount = 0,
  }) {
    if (journeys.isEmpty) {
      return _DayTotals(
        distanceKm: 0,
        duration: Duration.zero,
        pointCount: 0,
        tripCount: 0,
        unconfirmedCount: unconfirmedCount,
        startAt: null,
        endAt: null,
        allConfirmedReturns: false,
        gapCount: 0,
        largestGap: Duration.zero,
      );
    }

    final sorted = [
      ...journeys,
    ]..sort((a, b) => a.confirmedDepartureAt.compareTo(b.confirmedDepartureAt));

    return _DayTotals(
      distanceKm: journeys.fold<double>(
        0,
        (sum, journey) => sum + journeyV2RecordedDistanceKm(journey),
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
      unconfirmedCount: unconfirmedCount,
      startAt: sorted.first.confirmedDepartureAt,
      endAt: sorted.last.confirmedReturnAt,
      allConfirmedReturns: journeys.every(
        (journey) => journey.hasConfirmedReturn,
      ),
      gapCount: journeys.fold<int>(
        0,
        (sum, journey) => sum + journey.routeCoverage.gapCount,
      ),
      largestGap: journeys.fold<Duration>(
        Duration.zero,
        (largest, journey) =>
            journey.routeCoverage.largestGap > largest
            ? journey.routeCoverage.largestGap
            : largest,
      ),
    );
  }
}

Duration _durationOf(JourneyRecord journey) {
  final duration = journey.confirmedReturnAt.difference(
    journey.confirmedDepartureAt,
  );
  return duration.isNegative ? Duration.zero : duration;
}

String _compactDuration(Duration duration) {
  if (duration <= Duration.zero) return '0m';
  final minutes = (duration.inSeconds + 59) ~/ 60;
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final remainder = minutes % 60;
  return remainder == 0 ? '${hours}h' : '${hours}h ${remainder}m';
}

String _departureCaption(JourneyRecord journey) {
  final origin = journey.originGeofenceName?.trim();
  return origin == null || origin.isEmpty ? 'First recorded' : 'Left $origin';
}

String _arrivalCaption(JourneyRecord journey) {
  if (!journey.hasConfirmedReturn) return 'Last recorded';
  return 'Returned ${journey.originGeofenceName!.trim()}';
}

String _pointPlaceLabel(
  JourneyRecord journey,
  int pointIndex, {
  JourneyRoutePresentation? presentation,
}) {
  final origin = journey.originGeofenceName?.trim();
  if (pointIndex <= 0 && origin != null && origin.isNotEmpty) {
    return origin;
  }
  if (journey.hasConfirmedReturn &&
      pointIndex >= journey.pointCount - 1 &&
      origin != null &&
      origin.isNotEmpty) {
    return origin;
  }

  final nearbyPlace = presentation?.placeForPoint(pointIndex)?.label.trim();
  if (nearbyPlace != null && nearbyPlace.isNotEmpty) return nearbyPlace;

  for (final stop in journey.stops) {
    if (pointIndex < stop.pointStartIndex || pointIndex > stop.pointEndIndex) {
      continue;
    }
    final place = stop.placeName?.trim();
    if (place != null && place.isNotEmpty) return place;
    return 'Recorded stop';
  }

  if (pointIndex >= 0 && pointIndex < journey.pointEvidence.length) {
    final place = journey.pointEvidence[pointIndex].placeName?.trim();
    if (place != null && place.isNotEmpty) return place;
  }

  return 'Recorded location';
}

JourneyRouteGap? _largestRouteGap(JourneyRecord journey) {
  JourneyRouteGap? largest;
  for (final gap in journey.routeGaps) {
    if (largest == null || gap.durationSeconds > largest.durationSeconds) {
      largest = gap;
    }
  }
  return largest;
}

String _routeGapText(JourneyRecord journey) {
  final gap = _largestRouteGap(journey);
  if (gap == null) {
    return 'Tracking resumed after a '
        '${_compactDuration(journey.routeCoverage.largestGap)} gap.';
  }

  final stoppedAt = journey.startAt.add(
    Duration(milliseconds: gap.fromOffsetMs),
  );
  final resumedAt = journey.startAt.add(Duration(milliseconds: gap.toOffsetMs));
  return 'Tracking stopped at ${DateFormat.Hm().format(stoppedAt)} and resumed '
      'at ${DateFormat.Hm().format(resumedAt)} '
      '(${_compactDuration(gap.duration)} gap).';
}

String _journeyStoryText(
  JourneyRecord journey, {
  JourneyRoutePresentation? presentation,
}) {
  final originName = journey.originGeofenceName?.trim();
  final origin = originName == null || originName.isEmpty
      ? 'Safe zone'
      : originName;
  final parts = <String>[
    originName == null || originName.isEmpty
        ? 'First recorded ${DateFormat.Hm().format(journey.confirmedDepartureAt)}'
        : '$origin ${DateFormat.Hm().format(journey.confirmedDepartureAt)} departure',
  ];

  final orderedStops = [if (_hasStructuredJourney(journey)) ...journey.stops]
    ..sort((a, b) => a.startAt.compareTo(b.startAt));
  if (orderedStops.isEmpty) {
    parts.add(
      'Recorded movement · ${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km',
    );
  } else {
    for (final stop in orderedStops.take(2)) {
      final place =
          presentation?.placeForStop(stop)?.label.trim() ??
          stop.placeName?.trim();
      final label = place == null || place.isEmpty ? 'Recorded stop' : place;
      parts.add(
        '$label · ${DateFormat.Hm().format(stop.startAt)}'
        '${stop.duration > Duration.zero ? ' · ${_compactDuration(stop.duration)}' : ''}',
      );
    }
    if (orderedStops.length > 2) {
      parts.add('${orderedStops.length - 2} more recorded stops');
    }
  }

  final gap = _largestRouteGap(journey);
  if (gap != null) {
    final stoppedAt = journey.startAt.add(
      Duration(milliseconds: gap.fromOffsetMs),
    );
    final resumedAt = journey.startAt.add(
      Duration(milliseconds: gap.toOffsetMs),
    );
    parts.add(
      'Tracking unavailable ${DateFormat.Hm().format(stoppedAt)}–'
      '${DateFormat.Hm().format(resumedAt)}',
    );
  }

  parts.add(
    journey.hasConfirmedReturn
        ? '$origin ${DateFormat.Hm().format(journey.confirmedReturnAt)} return confirmed'
        : 'Last location ${DateFormat.Hm().format(journey.confirmedReturnAt)}',
  );
  return parts.join('  →  ');
}

String _dayGuardianReadText(String deviceName, _DayTotals totals) {
  if (totals.tripCount == 0) {
    return totals.unconfirmedCount > 0
        ? 'Location updates were received, but a trip could not be confirmed. '
              'Approximate updates are excluded from trip totals.'
        : 'No confirmed journey was recorded for this day.';
  }

  final base = totals.allConfirmedReturns
      ? '$deviceName was away for ${_compactDuration(totals.duration)} across '
            '${totals.tripCount} confirmed ${totals.tripCount == 1 ? 'outing' : 'outings'}. '
      : '$deviceName has ${totals.tripCount} recorded '
            '${totals.tripCount == 1 ? 'journey' : 'journeys'}. ';
  final route = 'Guardian recorded ${totals.distanceKm.toStringAsFixed(1)} km '
      'from ${totals.pointCount} location points.';
  final omitted = totals.unconfirmedCount > 0
      ? ' Other updates could not confirm a trip and are excluded.'
      : '';
  if (totals.gapCount == 0) return '$base$route$omitted';
  return '$base$route Tracking resumed after '
      '${totals.gapCount == 1 ? 'a' : totals.gapCount} '
      '${_compactDuration(totals.largestGap)} '
      '${totals.gapCount == 1 ? 'gap' : 'largest gap'}.';
}

bool _hasStructuredJourney(JourneyRecord journey) {
  return journey.routeCoverage.structureReliable &&
      journey.pointEvidence.every((point) => point.isSatelliteObservation) &&
      (journey.stopCount > 0 ||
      journey.stops.isNotEmpty ||
      journey.legCount > 0 ||
      journey.legs.isNotEmpty);
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
  final origin = journey.originGeofenceName?.trim();
  final base = journey.hasConfirmedReturn
      ? '${origin ?? 'Safe-zone'} departure and return were confirmed. '
            'Time away: ${_compactDuration(_durationOf(journey))}. '
            'Guardian recorded ${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km '
            'from ${_locationUpdateText(journey, route.decodedPointCount)}.'
      : 'Guardian recorded ${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km '
            'from ${_locationUpdateText(journey, route.decodedPointCount)} over '
            '${_compactDuration(_durationOf(journey))}.';

  final coverage = journey.hasInterruptedCoverage
      ? ' ${_routeGapText(journey)} Distance excludes the unobserved interval.'
      : '';

  if (!_hasStructuredJourney(journey)) return '$base$coverage';

  if (journey.stopCount <= 0) {
    return journey.hasInterruptedCoverage
        ? '$base$coverage'
        : '$base No meaningful stops were recorded.';
  }

  final stopSummary = journey.stopCount == 1
      ? '1 stop was recorded during this outing'
      : '${journey.stopCount} stops were recorded during this outing';

  return '$base$coverage $stopSummary, totaling '
      '${_compactDuration(journey.totalStopDuration)}.';
}

bool _allLocationUpdatesAreGps(JourneyRecord journey) {
  return journey.pointEvidence.length == journey.pointCount &&
      journey.pointEvidence.every(
        (point) => point.gpsValid && point.source?.toLowerCase() == 'gps',
      );
}

String _locationUpdateText(JourneyRecord journey, int count) {
  return _allLocationUpdatesAreGps(journey)
      ? '$count GPS location points'
      : '$count location points';
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
