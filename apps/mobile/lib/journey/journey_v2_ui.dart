import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../widgets/cards/guardian_surface.dart';
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

    return SingleChildScrollView(
      key: const ValueKey('journey-scroll'),
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 96),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _JourneyTopBar(
            deviceName: deviceName,
            day: day,
            onBack: onBack,
            onChooseDay: onChooseDay,
          ),
          const SizedBox(height: 24),
          if (meaningful.isNotEmpty) ...[
            if (meaningful.length > 1)
              _JourneyPicker(
                journeys: meaningful,
                selectedId: authoritativeSelected?.id,
                onSelectJourney: onSelectJourney,
              ),
            if (meaningful.length > 1) const SizedBox(height: 20),
            _SelectedTripPanel(
              selected: authoritativeSelected,
              route: selectedRoute,
              deviceName: deviceName,
              deviceImei: deviceImei,
              avatarUrl: avatarUrl,
              originGeofence: originGeofence,
            ),
            const SizedBox(height: 20),
            GuardianSurface(
              padding: EdgeInsets.zero,
              child: ExpansionTile(
                key: const ValueKey('journey-day-overview'),
                title: const Text('Day overview'),
                children: [
                  _DayOverviewCard(totals: totals),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                    child: Text(_dayGuardianReadText(deviceName, totals)),
                  ),
                ],
              ),
            ),
          ] else
            GuardianSurface(
              padding: const EdgeInsets.all(28),
              child: Column(
                children: [
                  Icon(
                    Icons.route_outlined,
                    size: 36,
                    color: context.guardianColors.textSecondary,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'No confirmed journey',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    _dayGuardianReadText(deviceName, totals),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _JourneyPicker extends StatelessWidget {
  const _JourneyPicker({
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
    final scheme = Theme.of(context).colorScheme;
    return Align(
      alignment: Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 640),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final useCards =
                journeys.length <= 3 &&
                constraints.maxWidth >=
                    journeys.length * 136 + (journeys.length - 1) * 8 &&
                MediaQuery.textScalerOf(context).scale(14) <= 20;
            if (useCards) {
              return Row(
                children: [
                  for (var index = 0; index < journeys.length; index++) ...[
                    if (index > 0) const SizedBox(width: 8),
                    Expanded(
                      child: Semantics(
                        selected: journeys[index].id == selectedId,
                        button: true,
                        child: Material(
                          color: journeys[index].id == selectedId
                              ? scheme.primary
                              : colors.surface,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(16),
                            side: BorderSide(
                              color: journeys[index].id == selectedId
                                  ? scheme.primary
                                  : colors.border,
                            ),
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: InkWell(
                            key: ValueKey('journey-trip-${journeys[index].id}'),
                            onTap: () => onSelectJourney(journeys[index]),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 14,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    _tripTitle(journeys[index]),
                                    style: TextStyle(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                      color: journeys[index].id == selectedId
                                          ? scheme.onPrimary
                                          : colors.textPrimary,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${DateFormat.Hm().format(journeys[index].confirmedDepartureAt)} – '
                                    '${DateFormat.Hm().format(journeys[index].confirmedReturnAt)}',
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: journeys[index].id == selectedId
                                          ? scheme.onPrimary
                                          : colors.textSecondary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ],
                ],
              );
            }
            return DropdownButtonFormField<String>(
              key: ValueKey('journey-picker-$selectedId'),
              initialValue: selectedId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: 'Choose a journey',
                filled: true,
                fillColor: colors.surface,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
              ),
              items: [
                for (var index = 0; index < journeys.length; index++)
                  DropdownMenuItem(
                    value: journeys[index].id,
                    child: Text(
                      '${index + 1} of ${journeys.length} · '
                      '${DateFormat.Hm().format(journeys[index].confirmedDepartureAt)} – '
                      '${DateFormat.Hm().format(journeys[index].confirmedReturnAt)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (id) {
                if (id != null) {
                  onSelectJourney(
                    journeys.firstWhere((journey) => journey.id == id),
                  );
                }
              },
            );
          },
        ),
      ),
    );
  }
}

class _JourneyTopBar extends StatelessWidget {
  const _JourneyTopBar({
    required this.deviceName,
    required this.day,
    required this.onBack,
    required this.onChooseDay,
  });

  final String deviceName;
  final DateTime day;
  final VoidCallback onBack;
  final VoidCallback onChooseDay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final now = DateTime.now();
    final isToday =
        day.year == now.year && day.month == now.month && day.day == now.day;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            IconButton(
              tooltip: 'Back',
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Journeys',
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 28,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.7,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '$deviceName · ${isToday ? 'Today' : DateFormat('EEE, d MMM').format(day)}',
                    style: TextStyle(color: colors.textSecondary, fontSize: 13),
                  ),
                ],
              ),
            ),
            IconButton.filledTonal(
              key: const ValueKey('journey-choose-day'),
              tooltip: 'Choose day',
              onPressed: onChooseDay,
              icon: const Icon(Icons.calendar_month_rounded, size: 22),
            ),
          ],
        ),
      ],
    );
  }
}

class _DayOverviewCard extends StatelessWidget {
  const _DayOverviewCard({required this.totals});
  final _DayTotals totals;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(20),
    child: Wrap(
      spacing: 28,
      runSpacing: 20,
      children: [
        _TripFact(value: '${totals.tripCount}', label: 'Trips'),
        _TripFact(
          value: '${totals.distanceKm.toStringAsFixed(1)} km',
          label: 'Recorded distance',
        ),
        _TripFact(
          value: _compactDuration(totals.duration),
          label: totals.allConfirmedReturns
              ? 'Total time away'
              : 'Recorded time',
        ),
        _TripFact(value: '${totals.pointCount}', label: 'Location points'),
      ],
    ),
  );
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
  bool _mapExpanded = false;
  bool _replayNeedsRefresh = false;
  final _mapKey = GlobalKey();

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
      if (_mapExpanded) {
        // The expanded route owns the visible snapshot until it is closed.
        _replayNeedsRefresh = true;
      } else {
        _configureReplay();
      }
    }
  }

  void _configureReplay() {
    _replayNeedsRefresh = false;
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

  Future<void> _openMap(
    JourneyRecord journey,
    JourneyV2Route route,
    JourneyV2ReplayController replay,
  ) async {
    if (_mapExpanded) return;
    setState(() => _mapExpanded = true);
    try {
      await Navigator.of(context).push<void>(
        MaterialPageRoute(
          builder: (_) => _JourneyFullScreenMap(
            journey: journey,
            route: route,
            replay: replay,
            deviceName: widget.deviceName,
            deviceImei: widget.deviceImei,
            avatarUrl: widget.avatarUrl,
            originGeofence: widget.originGeofence,
          ),
        ),
      );
    } finally {
      if (mounted) {
        setState(() {
          _mapExpanded = false;
          if (_replayNeedsRefresh) _configureReplay();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final journey = widget.selected;
    final selectedRoute = widget.route;
    final replay = _replay;

    if (journey == null || selectedRoute == null || replay == null) {
      return Container(
        padding: const EdgeInsets.all(24),
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
      builder: (context, _) => LayoutBuilder(
        builder: (context, constraints) {
          final wide = constraints.maxWidth >= 900;
          final map = GuardianSurface(
            key: _mapKey,
            padding: EdgeInsets.zero,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  height: wide ? 440 : 330,
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Stack(
                      children: [
                        Positioned.fill(
                          child: _mapExpanded
                              ? ColoredBox(color: colors.canvas)
                              : JourneyV2StaticMap(
                                  key: ValueKey('journey-map-${journey.id}'),
                                  route: selectedRoute,
                                  deviceName: widget.deviceName,
                                  deviceImei: widget.deviceImei,
                                  avatarUrl: widget.avatarUrl,
                                  originGeofence: widget.originGeofence,
                                  currentIndex: replay.currentIndex,
                                  showReplayPosition: true,
                                  mapPadding: const EdgeInsets.fromLTRB(
                                    24,
                                    68,
                                    24,
                                    32,
                                  ),
                                  onPointSelected: replay.seekIndex,
                                ),
                        ),
                        Positioned(
                          left: 12,
                          right: 72,
                          top: 12,
                          child: const Align(
                            alignment: Alignment.topLeft,
                            child: _MiniBadge(label: 'Journey history'),
                          ),
                        ),
                        Positioned(
                          right: 12,
                          top: 12,
                          child: _MapExpandButton(
                            onTap: () => unawaited(
                              _openMap(journey, selectedRoute, replay),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _tripTitle(journey),
                        style: TextStyle(
                          color: colors.textPrimary,
                          fontSize: 22,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.5,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(
                        '${DateFormat.Hm().format(journey.confirmedDepartureAt)} – '
                        '${DateFormat.Hm().format(journey.confirmedReturnAt)}',
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Wrap(
                        spacing: 28,
                        runSpacing: 12,
                        children: [
                          _TripFact(
                            value:
                                '${journeyV2RecordedDistanceKm(journey).toStringAsFixed(1)} km',
                            label: 'Recorded distance',
                          ),
                          _TripFact(
                            value: _compactDuration(_durationOf(journey)),
                            label: journey.hasConfirmedReturn
                                ? 'Time away'
                                : 'Recorded time',
                          ),
                          if (_hasStructuredJourney(journey))
                            _TripFact(
                              value: '${journey.stops.length}',
                              label: 'Stops',
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: _ReplayShell(journey: journey, replay: replay),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 0, 18, 18),
                  child: _ReplayLocationCard(
                    journey: journey,
                    route: selectedRoute,
                    replay: replay,
                  ),
                ),
                if (selectedRoute.presentation?.segments.any(
                      (segment) =>
                          segment.source == 'google' ||
                          segment.source == 'gps_bridge',
                    ) ==
                    true)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
                    child: Text(
                      'Some sections are estimated between recorded locations.',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 12,
                      ),
                    ),
                  ),
              ],
            ),
          );
          final story = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _JourneyTimeline(
                journey: journey,
                presentation: selectedRoute.presentation,
                onSeek: (at) {
                  var nearestIndex = 0;
                  var nearestDelta = double.infinity;
                  for (var index = 0; index < replay.points.length; index++) {
                    final recordedAt = replay.points[index].recordedAt;
                    if (recordedAt == null) continue;
                    final delta = recordedAt
                        .difference(at)
                        .inMilliseconds
                        .abs();
                    if (delta < nearestDelta) {
                      nearestDelta = delta.toDouble();
                      nearestIndex = index;
                    }
                  }
                  replay.pause();
                  replay.seekIndex(nearestIndex);
                  final mapContext = _mapKey.currentContext;
                  if (mapContext != null) {
                    unawaited(
                      Scrollable.ensureVisible(
                        mapContext,
                        duration: MediaQuery.disableAnimationsOf(context)
                            ? Duration.zero
                            : const Duration(milliseconds: 250),
                        alignment: 0.05,
                      ),
                    );
                  }
                },
              ),
              const SizedBox(height: 16),
              GuardianSurface(
                padding: EdgeInsets.zero,
                child: ExpansionTile(
                  key: ValueKey('journey-recording-details-${journey.id}'),
                  title: const Text('Recording details'),
                  children: [
                    if (journey.hasInterruptedCoverage)
                      Padding(
                        padding: const EdgeInsets.all(18),
                        child: _RouteCoverageNotice(journey: journey),
                      ),
                    for (final gap in journey.routeGaps)
                      ListTile(
                        leading: const Icon(Icons.portable_wifi_off_rounded),
                        title: Text(
                          '${DateFormat.Hm().format(journey.startAt.add(Duration(milliseconds: gap.fromOffsetMs)))} – '
                          '${DateFormat.Hm().format(journey.startAt.add(Duration(milliseconds: gap.toOffsetMs)))}',
                        ),
                        subtitle: Text(
                          '${_compactDuration(gap.duration)} without a recorded location',
                        ),
                      ),
                    _SelectedMetricsRow(journey: journey, route: selectedRoute),
                    Padding(
                      padding: const EdgeInsets.all(18),
                      child: Text(
                        _selectedTripGuardianReadText(journey, selectedRoute),
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 13,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
          if (wide) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 7, child: map),
                const SizedBox(width: 20),
                Expanded(flex: 4, child: story),
              ],
            );
          }
          return Column(children: [map, const SizedBox(height: 20), story]);
        },
      ),
    );
  }
}

class _TripFact extends StatelessWidget {
  const _TripFact({required this.value, required this.label});
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        value,
        style: TextStyle(
          color: context.guardianColors.textPrimary,
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(height: 3),
      Text(
        label,
        style: TextStyle(
          color: context.guardianColors.textSecondary,
          fontSize: 12,
        ),
      ),
    ],
  );
}

class _JourneyTimeline extends StatelessWidget {
  const _JourneyTimeline({
    required this.journey,
    required this.presentation,
    required this.onSeek,
  });

  final JourneyRecord journey;
  final JourneyRoutePresentation? presentation;
  final ValueChanged<DateTime> onSeek;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final events =
        <
            ({
              DateTime at,
              String title,
              String detail,
              IconData icon,
              int? point,
            })
          >[
            (
              at: journey.confirmedDepartureAt,
              title: _timelineEndpointLabel(journey, 0, presentation),
              detail: journey.routeStartAnchored
                  ? _departureCaption(journey)
                  : 'First recorded location',
              icon: Icons.trip_origin_rounded,
              point: 0,
            ),
            if (_hasStructuredJourney(journey))
              for (final stop in journey.stops)
                (
                  at: stop.startAt,
                  title: _stopPlaceLabel(stop, presentation),
                  detail: 'Stopped for ${_compactDuration(stop.duration)}',
                  icon: Icons.pause_circle_outline_rounded,
                  point: stop.pointStartIndex,
                ),
            ..._namedJourneyTimelinePoints(journey, presentation),
            (
              at: journey.confirmedReturnAt,
              title: _timelineEndpointLabel(
                journey,
                journey.pointCount - 1,
                presentation,
              ),
              detail: journey.hasConfirmedReturn
                  ? _arrivalCaption(journey)
                  : 'Last recorded location',
              icon: journey.hasConfirmedReturn
                  ? Icons.home_outlined
                  : Icons.location_on_outlined,
              point: journey.pointCount - 1,
            ),
          ]
          ..sort((a, b) => a.at.compareTo(b.at));

    return GuardianSurface(
      key: const ValueKey('journey-timeline'),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Journey timeline',
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Tap a location to view it on the map.',
            style: TextStyle(
              color: colors.textSecondary,
              fontSize: 12,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 20),
          for (var index = 0; index < events.length; index++)
            Builder(
              builder: (context) {
                final event = events[index];
                final gap = event.point == null;
                final accent = gap ? const Color(0xFFB77919) : colors.accent;
                return InkWell(
                  key: ValueKey('journey-event-${journey.id}-$index'),
                  borderRadius: BorderRadius.circular(12),
                  onTap: gap ? null : () => onSeek(event.at),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(9),
                          decoration: BoxDecoration(
                            color: accent.withValues(alpha: 0.10),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Icon(event.icon, size: 20, color: accent),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                DateFormat.Hm().format(event.at),
                                style: TextStyle(
                                  color: colors.textSecondary,
                                  fontSize: 12,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                event.title,
                                style: TextStyle(
                                  color: colors.textPrimary,
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                event.detail,
                                style: TextStyle(
                                  color: colors.textSecondary,
                                  fontSize: 12,
                                  height: 1.4,
                                ),
                              ),
                              if (index < events.length - 1)
                                Padding(
                                  padding: const EdgeInsets.only(top: 16),
                                  child: Divider(
                                    height: 1,
                                    color: colors.border,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          if (presentation?.stopPlaces.isNotEmpty == true) ...[
            const SizedBox(height: 12),
            Text(
              'Nearby places · Google Maps',
              style: TextStyle(color: colors.textSecondary, fontSize: 11),
            ),
          ],
        ],
      ),
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
        color: context.guardianColors.surface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: context.guardianColors.textPrimary,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _MapExpandButton extends StatelessWidget {
  const _MapExpandButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Material(
    color: context.guardianColors.surface.withValues(alpha: 0.96),
    borderRadius: BorderRadius.circular(14),
    elevation: 2,
    shadowColor: Colors.black.withValues(alpha: 0.10),
    child: IconButton(
      key: const ValueKey('journey-expand-map'),
      tooltip: 'Expand map',
      onPressed: onTap,
      constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
      icon: Icon(
        Icons.open_in_full_rounded,
        size: 20,
        color: context.guardianColors.textPrimary,
      ),
    ),
  );
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
  State<_JourneyFullScreenMap> createState() => _JourneyFullScreenMapState();
}

class _JourneyFullScreenMapState extends State<_JourneyFullScreenMap> {
  final JourneyV2StaticMapController _mapController =
      JourneyV2StaticMapController();
  bool _showSourceEvidence = false;

  void _showDetails() {
    final colors = context.guardianColors;
    final journey = widget.journey;
    final route = widget.route;
    final gpsCount = journeyV2RecordedGpsEvidencePoints(route).length;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: colors.surface,
      builder: (context) => StatefulBuilder(
        builder: (context, updateSheet) => SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Journey details',
                        style: TextStyle(
                          color: colors.textPrimary,
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('journey-close-details'),
                      tooltip: 'Close details',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  '${journeyV2DepartureCaption(route)} · ${DateFormat.Hm().format(journey.confirmedDepartureAt)}',
                  style: TextStyle(color: colors.textPrimary),
                ),
                const SizedBox(height: 8),
                Text(
                  '${journeyV2ArrivalCaption(route)} · ${DateFormat.Hm().format(journey.confirmedReturnAt)}',
                  style: TextStyle(color: colors.textPrimary),
                ),
                if (!journey.hasConfirmedReturn) ...[
                  const SizedBox(height: 8),
                  Text(
                    'Return home not confirmed',
                    style: TextStyle(color: colors.textSecondary),
                  ),
                ],
                const SizedBox(height: 12),
                Text(
                  '${journey.pointCount} recorded location points',
                  style: TextStyle(color: colors.textSecondary),
                ),
                if (journey.hasInterruptedCoverage) ...[
                  const SizedBox(height: 12),
                  _RouteCoverageNotice(journey: journey),
                ],
                const SizedBox(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _MapSourcePills(
                      hasGoogle: route.presentation?.hasGoogleSegments == true,
                      showSources: _showSourceEvidence,
                    ),
                    _JourneyMapActionButton(
                      key: const ValueKey('journey-toggle-source-evidence'),
                      icon: Icons.scatter_plot_rounded,
                      label:
                          '${_showSourceEvidence ? 'Hide' : 'Show'} $gpsCount GPS points',
                      active: _showSourceEvidence,
                      onTap: () {
                        setState(
                          () => _showSourceEvidence = !_showSourceEvidence,
                        );
                        updateSheet(() {});
                      },
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final journey = widget.journey;
    final route = widget.route;
    final replay = widget.replay;
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
                    mapPadding: const EdgeInsets.only(
                      top: 90,
                      bottom: 210,
                      left: 16,
                      right: 16,
                    ),
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
                        color: colors.surface.withValues(alpha: 0.96),
                        shape: const CircleBorder(),
                        elevation: 2,
                        child: IconButton(
                          key: const ValueKey('journey-close-fullscreen-map'),
                          tooltip: 'Close full-screen map',
                          onPressed: () => Navigator.of(context).pop(),
                          icon: const Icon(Icons.close_rounded),
                          color: colors.textPrimary,
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
                            color: colors.surface.withValues(alpha: 0.96),
                            borderRadius: BorderRadius.circular(14),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.08),
                                blurRadius: 14,
                              ),
                            ],
                          ),
                          child: Text(
                            '${widget.deviceName} · Journey history\n'
                            '${DateFormat('d MMMM yyyy').format(journey.startAt)}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: colors.textPrimary,
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  left: 16,
                  right: 16,
                  bottom: 12,
                  child: Material(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(18),
                    elevation: 3,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(10, 10, 10, 0),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _ReplayLocationCard(
                            journey: journey,
                            route: route,
                            replay: replay,
                          ),
                          const SizedBox(height: 8),
                          _ReplayShell(journey: journey, replay: replay),
                          Wrap(
                            alignment: WrapAlignment.spaceBetween,
                            spacing: 8,
                            children: [
                              TextButton.icon(
                                key: const ValueKey(
                                  'journey-fit-complete-route',
                                ),
                                onPressed: () => unawaited(
                                  _mapController.fitCompleteRoute(),
                                ),
                                icon: const Icon(
                                  Icons.fit_screen_rounded,
                                  size: 18,
                                ),
                                label: const Text('Fit route'),
                              ),
                              TextButton.icon(
                                key: const ValueKey('journey-open-details'),
                                onPressed: _showDetails,
                                icon: Icon(
                                  journey.hasInterruptedCoverage
                                      ? Icons
                                            .signal_wifi_connected_no_internet_4_rounded
                                      : Icons.info_outline,
                                  size: 18,
                                ),
                                label: const Text('Details'),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
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
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: [
        if (!showSources)
          const _MapSourcePill(color: Color(0xFF4F5CCB), label: 'Journey route')
        else
          const _MapSourcePill(color: Color(0xFF2563EB), label: 'GPS'),
        if (showSources && hasGoogle) ...[
          const _MapSourcePill(color: Color(0xFF7C3AED), label: 'Google'),
        ],
      ],
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
              Flexible(
                child: Text(
                  label,
                  style: TextStyle(
                    color: foreground,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
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
          Flexible(
            child: Text(
              label,
              style: const TextStyle(
                color: GuardianColors.forest,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
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
    final label = _pointPlaceLabel(
      journey,
      sourcePointIndex,
      presentation: route.presentation,
    );
    final time = replay.currentIndex == 0 && journey.routeStartAnchored
        ? journey.confirmedDepartureAt
        : point.recordedAt ?? journey.confirmedDepartureAt;
    final source = (point.source ?? point.accuracySource ?? '').toLowerCase();
    final evidence = switch (source) {
      'google' || 'gps_bridge' => 'Estimated route position',
      'wifi' || 'lbs' => 'Approximate network location',
      'gps' => 'Recorded GPS location',
      _ =>
        point.gpsValid == true ? 'Recorded GPS location' : 'Recorded location',
    };
    final pendingGap = replay.pendingTrackingGap;
    final skippingGap = replay.isSkippingTrackingGap && pendingGap != null;

    return ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 600),
      child: Container(
        key: const ValueKey('journey-replay-location-card'),
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
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
                        : 'At ${DateFormat.Hm().format(time)} · $label',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    skippingGap
                        ? 'Skipping to the next recorded location'
                        : evidence,
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
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
        color: Theme.of(context).brightness == Brightness.dark
            ? const Color(0xFF3F3321)
            : const Color(0xFFFFF5E8),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFF1B35D)),
      ),
      child: Row(
        children: [
          Icon(
            Icons.signal_wifi_connected_no_internet_4_rounded,
            color: Theme.of(context).brightness == Brightness.dark
                ? const Color(0xFFF1B35D)
                : const Color(0xFFB66A00),
            size: 18,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              _routeGapText(journey),
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 12,
                height: 1.35,
                fontWeight: FontWeight.w500,
              ),
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
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
    child: Wrap(
      spacing: 28,
      runSpacing: 20,
      children: [
        _TripFact(
          value: route.decodedPointCount.toString(),
          label: _allLocationUpdatesAreGps(journey)
              ? 'GPS location points'
              : 'Location points',
        ),
        if (_hasStructuredJourney(journey))
          _TripFact(
            value: _structuredStopMetric(journey),
            label: 'Stops · total duration',
          ),
      ],
    ),
  );
}

class _ReplayShell extends StatelessWidget {
  const _ReplayShell({required this.journey, required this.replay});
  final JourneyRecord journey;
  final JourneyV2ReplayController replay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final currentTime = replay.currentIndex == 0 && journey.routeStartAnchored
        ? journey.confirmedDepartureAt
        : (replay.currentTime ?? journey.confirmedDepartureAt);
    final play = IconButton.filled(
      key: const ValueKey('journey-replay-toggle'),
      tooltip: replay.isPlaying ? 'Pause replay' : 'Play replay',
      onPressed: replay.canReplay ? replay.toggle : null,
      style: IconButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      icon: Icon(
        replay.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
      ),
    );
    final speed = TextButton(
      key: const ValueKey('journey-replay-speed'),
      onPressed: replay.canReplay ? replay.cycleSpeed : null,
      style: TextButton.styleFrom(
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 8),
      ),
      child: Text(
        replay.speedLabel,
        semanticsLabel: 'Replay speed ${replay.speedLabel}',
      ),
    );
    final progress = Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Flexible(
              child: Text(
                DateFormat.Hm().format(currentTime),
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            ),
            Flexible(
              child: Text(
                DateFormat.Hm().format(journey.confirmedReturnAt),
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            ),
          ],
        ),
        SliderTheme(
          data: SliderTheme.of(context).copyWith(
            trackHeight: 3,
            thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 6),
            overlayShape: const RoundSliderOverlayShape(overlayRadius: 12),
          ),
          child: Slider(
            key: const ValueKey('journey-replay-slider'),
            value: replay.progress,
            semanticFormatterCallback: (_) =>
                DateFormat.Hm().format(currentTime),
            onChanged: replay.canReplay ? replay.seekProgress : null,
          ),
        ),
      ],
    );
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(18),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          if (constraints.maxWidth < 330 &&
              MediaQuery.textScalerOf(context).scale(12) > 18) {
            return Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(children: [play, const Spacer(), speed]),
                const SizedBox(height: 8),
                progress,
              ],
            );
          }
          return Row(
            children: [
              play,
              const SizedBox(width: 12),
              Expanded(child: progress),
              const SizedBox(width: 4),
              speed,
            ],
          );
        },
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
    required this.allConfirmedReturns,
    required this.gapCount,
    required this.largestGap,
    this.unconfirmedCount = 0,
  });

  final double distanceKm;
  final Duration duration;
  final int pointCount;
  final int tripCount;
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
        allConfirmedReturns: false,
        gapCount: 0,
        largestGap: Duration.zero,
      );
    }

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
      allConfirmedReturns: journeys.every(
        (journey) => journey.hasConfirmedReturn,
      ),
      gapCount: journeys.fold<int>(
        0,
        (sum, journey) => sum + journey.routeCoverage.gapCount,
      ),
      largestGap: journeys.fold<Duration>(
        Duration.zero,
        (largest, journey) => journey.routeCoverage.largestGap > largest
            ? journey.routeCoverage.largestGap
            : largest,
      ),
    );
  }
}

String _tripTitle(JourneyRecord journey) {
  final hour = journey.confirmedDepartureAt.hour;
  if (hour < 5 || hour >= 21) return 'Night outing';
  if (hour < 12) return 'Morning outing';
  if (hour < 17) return 'Afternoon outing';
  return 'Evening outing';
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
  return !journey.routeStartAnchored || origin == null || origin.isEmpty
      ? 'First recorded'
      : 'Left $origin';
}

String _arrivalCaption(JourneyRecord journey) {
  if (!journey.hasConfirmedReturn) return 'Last recorded';
  return 'Returned ${journey.originGeofenceName!.trim()}';
}

String _timelineEndpointLabel(
  JourneyRecord journey,
  int index,
  JourneyRoutePresentation? presentation,
) {
  final name = _pointPlaceLabel(journey, index, presentation: presentation);
  return name == 'Recorded location' || name == 'Recorded stop'
      ? (index == 0 ? 'First recorded' : 'Last recorded')
      : _timelinePlaceName(name);
}

String _timelinePlaceName(String label) => label.split(' · near ').first.trim();

String _timelinePlaceKey(String label) => _timelinePlaceName(
  label,
).toLowerCase().replaceFirst(RegExp(r'^st[.\s]+'), 'saint ');

List<({DateTime at, String title, String detail, IconData icon, int? point})>
_namedJourneyTimelinePoints(
  JourneyRecord journey,
  JourneyRoutePresentation? presentation,
) {
  final rows =
      <
        ({DateTime at, String title, String detail, IconData icon, int? point})
      >[];
  var previous = _timelinePlaceKey(
    _pointPlaceLabel(journey, 0, presentation: presentation),
  );
  for (var index = 1; index < journey.pointEvidence.length - 1; index++) {
    if (_hasStructuredJourney(journey) &&
        journey.stops.any(
          (stop) =>
              index >= stop.pointStartIndex && index <= stop.pointEndIndex,
        )) {
      previous = _timelinePlaceKey(
        _pointPlaceLabel(journey, index, presentation: presentation),
      );
      continue;
    }
    final evidence = journey.pointEvidence[index];
    final name = evidence.placeName?.trim();
    if (name == null || name.isEmpty) continue;
    final key = _timelinePlaceKey(name);
    if (key == previous) continue;
    previous = key;
    final nearby = name.split(' · near ');
    rows.add((
      at: journey.startAt.add(Duration(milliseconds: evidence.offsetMs)),
      title: _timelinePlaceName(name),
      detail: nearby.length > 1
          ? 'Near ${nearby.skip(1).join(' · near ')}'
          : evidence.isSatelliteObservation
          ? 'Recorded location'
          : 'Approximate location',
      icon: Icons.location_on_outlined,
      point: index,
    ));
  }
  return rows;
}

String _stopPlaceLabel(
  JourneyStop stop,
  JourneyRoutePresentation? presentation,
) {
  final nearby = presentation?.placeForStop(stop)?.label.trim();
  if (nearby != null && nearby.isNotEmpty) return nearby;
  final name = stop.placeName?.trim();
  return name == null || name.isEmpty ? 'Recorded stop' : name;
}

String _pointPlaceLabel(
  JourneyRecord journey,
  int pointIndex, {
  JourneyRoutePresentation? presentation,
}) {
  final origin = journey.originGeofenceName?.trim();
  if (pointIndex <= 0 &&
      journey.routeStartAnchored &&
      origin != null &&
      origin.isNotEmpty) {
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
  final route =
      'Guardian recorded ${totals.distanceKm.toStringAsFixed(1)} km '
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
