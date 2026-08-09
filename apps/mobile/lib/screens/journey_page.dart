import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../journey/journey_map_controls.dart';
import '../journey/journey_models.dart';
import '../journey/journey_replay_controller.dart';
import '../journey/journey_share.dart';
import '../journey/journey_utils.dart';
import '../journey/ui/journey_assistant_button.dart';
import '../journey/ui/journey_compare_banner.dart';
import '../journey/ui/journey_header.dart';
import '../journey/ui/journey_map_markers.dart';
import '../journey/ui/journey_playback_bar.dart';
import '../journey/ui/journey_route_legend.dart';
import '../journey/ui/journey_screen_theme.dart';
import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../models/device.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/brand/dodo_ai_icon.dart';
import '../widgets/layout/guardian_page_frame.dart';
import '../widgets/map/guardian_map_presentation.dart';
import '../widgets/map/map_avatar_overlay.dart';
import '../widgets/map/person_map_marker.dart';

const _kMauritiusFallback = LatLng(-20.026, 57.596);

class JourneyPage extends StatefulWidget {
  const JourneyPage({
    super.key,
    required this.imei,
    required this.deviceName,
    this.avatarUrl,
  });

  final String imei;
  final String deviceName;
  final String? avatarUrl;

  @override
  State<JourneyPage> createState() => _JourneyPageState();
}

class _JourneyPageState extends State<JourneyPage> {
  late DateTime _day = DateTime(
    DateTime.now().year,
    DateTime.now().month,
    DateTime.now().day,
  );
  GoogleMapController? _mapController;
  JourneyReplayController? _replay;
  List<LocationHistoryPoint>? _cachedPoints;
  JourneyGpsContext? _cachedGpsContext;
  List<Geofence> _geofences = const [];
  bool _didFitForDay = false;

  MapType _mapType = MapType.normal;
  bool _showHeatmap = false;
  bool _compareMode = false;
  DateTime? _compareDay;
  List<LocationHistoryPoint>? _comparePoints;
  int? _similarityPercent;
  Set<DateTime> _daysWithHistory = {};
  bool _loadingCompare = false;

  bool get _isToday {
    final now = DateTime.now();
    return _day.year == now.year &&
        _day.month == now.month &&
        _day.day == now.day;
  }

  @override
  void initState() {
    super.initState();
    GeofenceService().watchAll().listen((zones) {
      if (!mounted) return;
      setState(
        () => _geofences = zones.where((z) => z.imei == widget.imei).toList(),
      );
    });
    _loadDaysWithHistory();
  }

  Future<void> _loadDaysWithHistory() async {
    try {
      final days = await DeviceService().fetchDaysWithHistory(widget.imei);
      if (!mounted) return;
      setState(() => _daysWithHistory = days);
    } catch (_) {
      // Non-fatal — Time Machine falls back to manual day nav.
    }
  }

  Future<void> _shareJourney(List<LocationHistoryPoint> points) async {
    final text = buildJourneyShareText(
      deviceName: widget.deviceName,
      day: _day,
      points: points,
    );
    final result = await shareJourneySummary(text);
    if (!mounted) return;
    final message = switch (result) {
      ShareJourneyResult.copiedAndWhatsApp =>
        'Journey summary copied — opening WhatsApp…',
      ShareJourneyResult.copiedOnly => 'Journey summary copied to clipboard.',
    };
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _openTimeMachine() async {
    if (_daysWithHistory.isEmpty) await _loadDaysWithHistory();
    if (!mounted) return;
    final picked = await showTimeMachineSheet(
      context: context,
      selectedDay: _day,
      daysWithData: _daysWithHistory,
    );
    if (picked != null) _selectDay(picked);
  }

  void _selectDay(DateTime day) {
    _replay?.dispose();
    _replay = null;
    setState(() {
      _day = DateTime(day.year, day.month, day.day);
      _didFitForDay = false;
      _compareDay = null;
      _comparePoints = null;
      _similarityPercent = null;
      _compareMode = false;
    });
  }

  Future<void> _toggleCompareMode(
    List<LocationHistoryPoint> primaryPoints,
  ) async {
    if (_compareMode) {
      setState(() {
        _compareMode = false;
        _compareDay = null;
        _comparePoints = null;
        _similarityPercent = null;
      });
      return;
    }

    if (_daysWithHistory.isEmpty) await _loadDaysWithHistory();
    if (!mounted) return;

    final picked = await showCompareDayPicker(
      context: context,
      primaryDay: _day,
      daysWithData: _daysWithHistory,
    );
    if (picked == null || !mounted) return;

    setState(() {
      _compareMode = true;
      _compareDay = picked;
      _loadingCompare = true;
      _comparePoints = null;
      _similarityPercent = null;
    });

    try {
      final comparePoints = await DeviceService().fetchDayHistory(
        widget.imei,
        picked,
      );
      if (!mounted) return;
      final similarity = computeRouteSimilarity(primaryPoints, comparePoints);
      setState(() {
        _comparePoints = comparePoints;
        _similarityPercent = similarity;
        _loadingCompare = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _compareMode = false;
        _loadingCompare = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not load comparison day.')),
      );
    }
  }

  JourneyReplayController _controllerFor(
    JourneyDayData dayData, {
    JourneyGpsContext? gpsContext,
  }) {
    if (_replay != null &&
        _cachedPoints != null &&
        _pointsEqual(_cachedPoints!, dayData.points) &&
        _gpsContextEqual(_cachedGpsContext, gpsContext)) {
      return _replay!;
    }
    _replay?.dispose();
    _cachedPoints = dayData.points;
    _cachedGpsContext = gpsContext;
    _replay = JourneyReplayController(
      rawPoints: dayData.points,
      journeys: dayData.journeys,
      geofences: _geofences,
      timelineEvents: dayData.events,
      gpsContext: gpsContext,
    );
    return _replay!;
  }

  bool _gpsContextEqual(JourneyGpsContext? a, JourneyGpsContext? b) {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a.liveGpsFresh == b.liveGpsFresh &&
        a.staleGpsActive == b.staleGpsActive &&
        a.isViewingToday == b.isViewingToday;
  }

  bool _pointsEqual(
    List<LocationHistoryPoint> a,
    List<LocationHistoryPoint> b,
  ) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      final left = a[i];
      final right = b[i];
      if (left.lat != right.lat ||
          left.lng != right.lng ||
          left.speedKmh != right.speedKmh ||
          left.recordedAt != right.recordedAt) {
        return false;
      }
    }
    return true;
  }

  Future<void> _fitBounds(List<LocationHistoryPoint> points) async {
    final controller = _mapController;
    final boundsPoints = pointsForMapBounds(points);
    if (controller == null || boundsPoints.isEmpty || _didFitForDay) return;
    _didFitForDay = true;

    if (boundsPoints.length == 1) {
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(
          LatLng(boundsPoints.first.lat, boundsPoints.first.lng),
          15,
        ),
      );
      return;
    }

    double minLat = boundsPoints.first.lat, maxLat = boundsPoints.first.lat;
    double minLng = boundsPoints.first.lng, maxLng = boundsPoints.first.lng;
    for (final p in boundsPoints) {
      minLat = minLat < p.lat ? minLat : p.lat;
      maxLat = maxLat > p.lat ? maxLat : p.lat;
      minLng = minLng < p.lng ? minLng : p.lng;
      maxLng = maxLng > p.lng ? maxLng : p.lng;
    }
    try {
      await controller.animateCamera(
        CameraUpdate.newLatLngBounds(
          LatLngBounds(
            southwest: LatLng(minLat, minLng),
            northeast: LatLng(maxLat, maxLng),
          ),
          48,
        ),
      );
    } catch (_) {
      final center = boundsPoints[boundsPoints.length ~/ 2];
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(center.lat, center.lng), 15),
      );
    }
  }

  void _centerMap(JourneyReplayController replay) {
    _didFitForDay = false;
    _fitBounds(replay.smoothedPoints);
  }

  void _toggleMapLock(JourneyReplayController replay) {
    replay.toggleFollowCamera();
    setState(() {});
  }

  void _showWeatherInfo(TypicalWeather weather) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('${weather.display} · Typical for this season')),
    );
  }

  void _showJourneySettings() {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Journey settings coming soon.')),
    );
  }

  @override
  void dispose() {
    _replay?.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    return Scaffold(
      backgroundColor: colors.canvas,
      body: JourneyScreenTheme.chrome(
        child: Column(
          children: [
            StreamBuilder<List<Device>>(
              stream: DeviceService().watchLinkedDevices(),
              builder: (context, deviceSnapshot) {
                final device = deviceSnapshot.data
                    ?.where((d) => d.imei == widget.imei)
                    .firstOrNull;

                return JourneyHeader(
                  deviceName: widget.deviceName,
                  imei: widget.imei,
                  avatarUrl: widget.avatarUrl,
                  selectedDay: _day,
                  isOnline: device?.online ?? false,
                  compareActive: _compareMode,
                  onBack: () => Navigator.maybePop(context),
                  onDateTap: _openTimeMachine,
                  onShare: () {
                    final points = _cachedPoints;
                    if (points == null || points.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('No journey data to share yet.'),
                        ),
                      );
                      return;
                    }
                    _shareJourney(points);
                  },
                  onCompare: () {
                    final points = _cachedPoints;
                    if (points != null) _toggleCompareMode(points);
                  },
                  onSettings: _showJourneySettings,
                );
              },
            ),
            Expanded(
              child: GuardianPageFrame(
                maxWidth: 1360,
                child: StreamBuilder<List<Device>>(
                  stream: DeviceService().watchLinkedDevices(),
                  builder: (context, deviceSnapshot) {
                    final device = deviceSnapshot.data
                        ?.where((d) => d.imei == widget.imei)
                        .firstOrNull;
                    final gpsContext = journeyGpsContextForDevice(
                      device,
                      isViewingToday: _isToday,
                    );

                    return StreamBuilder<JourneyDayData>(
                      key: ValueKey(_day),
                      stream: DeviceService().watchDayJourneyData(
                        widget.imei,
                        _day,
                        geofences: _geofences,
                      ),
                      builder: (context, snapshot) {
                        if (snapshot.hasError) {
                          return _JourneyMessageState(
                            icon: Icons.cloud_off_rounded,
                            title: 'Journey unavailable',
                            message:
                                'Guardian could not load this recorded route. '
                                'Your saved journey data has not been changed.',
                            actionLabel: 'Choose another day',
                            onAction: _openTimeMachine,
                          );
                        }
                        if (!snapshot.hasData) {
                          return const Center(
                            child: CircularProgressIndicator(
                              color: GuardianColors.safe,
                            ),
                          );
                        }
                        final dayData = snapshot.data!;
                        if (dayData.isEmpty) {
                          return _JourneyMessageState(
                            icon: Icons.route_outlined,
                            title: 'No journey recorded',
                            message:
                                'There is no movement history for '
                                '${formatJourneyHeaderDate(_day)}.',
                            actionLabel: 'Choose another day',
                            onAction: _openTimeMachine,
                          );
                        }

                        final replay = _controllerFor(
                          dayData,
                          gpsContext: gpsContext,
                        );
                        final weather = typicalWeatherForMonth(_day.month);

                        WidgetsBinding.instance.addPostFrameCallback((_) {
                          _fitBounds(replay.smoothedPoints);
                        });

                        return _JourneyScreenLayout(
                          replay: replay,
                          deviceName: widget.deviceName,
                          imei: widget.imei,
                          avatarUrl: device?.avatarUrl ?? widget.avatarUrl,
                          selectedDay: _day,
                          weather: weather,
                          mapType: _mapType,
                          showHeatmap: _showHeatmap,
                          compareMode: _compareMode,
                          compareDay: _compareDay,
                          comparePoints: _comparePoints,
                          similarityPercent: _similarityPercent,
                          loadingCompare: _loadingCompare,
                          onMapCreated: (c) {
                            _mapController = c;
                            _fitBounds(replay.smoothedPoints);
                          },
                          onHeatmapToggle: () =>
                              setState(() => _showHeatmap = !_showHeatmap),
                          onMapTypeToggle: () => setState(() {
                            _mapType = _mapType == MapType.normal
                                ? MapType.hybrid
                                : MapType.normal;
                          }),
                          onCompareToggle: () =>
                              _toggleCompareMode(dayData.points),
                          onTimeMachine: _openTimeMachine,
                          onCenterMap: () => _centerMap(replay),
                          onMapLockToggle: () => _toggleMapLock(replay),
                          onWeatherInfo: () => _showWeatherInfo(weather),
                          onCompareDismiss: () =>
                              _toggleCompareMode(dayData.points),
                        );
                      },
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _JourneyScreenLayout extends StatelessWidget {
  const _JourneyScreenLayout({
    required this.replay,
    required this.deviceName,
    required this.imei,
    this.avatarUrl,
    required this.selectedDay,
    required this.weather,
    required this.mapType,
    required this.showHeatmap,
    required this.compareMode,
    required this.compareDay,
    required this.comparePoints,
    required this.similarityPercent,
    required this.loadingCompare,
    required this.onMapCreated,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
    required this.onCenterMap,
    required this.onMapLockToggle,
    required this.onWeatherInfo,
    required this.onCompareDismiss,
  });

  final JourneyReplayController replay;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final DateTime selectedDay;
  final TypicalWeather weather;
  final MapType mapType;
  final bool showHeatmap;
  final bool compareMode;
  final DateTime? compareDay;
  final List<LocationHistoryPoint>? comparePoints;
  final int? similarityPercent;
  final bool loadingCompare;
  final ValueChanged<GoogleMapController> onMapCreated;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;
  final VoidCallback onCenterMap;
  final VoidCallback onMapLockToggle;
  final VoidCallback onWeatherInfo;
  final VoidCallback onCompareDismiss;

  String get _weatherLabel => '${weather.tempC}°C ${weather.label}';

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: replay,
      builder: (context, _) {
        return LayoutBuilder(
          builder: (context, constraints) {
            final isWide = constraints.maxWidth >= 980;
            final horizontalPadding = constraints.maxWidth < 600 ? 14.0 : 24.0;
            final overview = _JourneyOverview(
              replay: replay,
              selectedDay: selectedDay,
              weather: weather,
            );
            final mapCard = _JourneyMapCard(
              replay: replay,
              deviceName: deviceName,
              imei: imei,
              avatarUrl: avatarUrl,
              weatherLabel: _weatherLabel,
              mapType: mapType,
              showHeatmap: showHeatmap,
              compareMode: compareMode,
              compareDay: compareDay,
              comparePoints: comparePoints,
              similarityPercent: similarityPercent,
              loadingCompare: loadingCompare,
              onMapCreated: onMapCreated,
              onHeatmapToggle: onHeatmapToggle,
              onMapTypeToggle: onMapTypeToggle,
              onCompareToggle: onCompareToggle,
              onTimeMachine: onTimeMachine,
              onCenterMap: onCenterMap,
              onMapLockToggle: onMapLockToggle,
              onWeatherInfo: onWeatherInfo,
              onCompareDismiss: onCompareDismiss,
            );
            final insight = _JourneyInsightPanel(
              replay: replay,
              weather: weather,
            );

            if (isWide) {
              return Padding(
                padding: EdgeInsets.fromLTRB(
                  horizontalPadding,
                  18,
                  horizontalPadding,
                  22,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    overview,
                    const SizedBox(height: 14),
                    Expanded(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Expanded(child: mapCard),
                          const SizedBox(width: 14),
                          SizedBox(width: 310, child: insight),
                        ],
                      ),
                    ),
                  ],
                ),
              );
            }

            final mapHeight = constraints.maxWidth < 520 ? 480.0 : 540.0;
            return SingleChildScrollView(
              padding: EdgeInsets.fromLTRB(
                horizontalPadding,
                14,
                horizontalPadding,
                28,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  overview,
                  const SizedBox(height: 14),
                  SizedBox(height: mapHeight, child: mapCard),
                  const SizedBox(height: 14),
                  insight,
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _JourneyMessageState extends StatelessWidget {
  const _JourneyMessageState({
    required this.icon,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: GuardianEmptyState(
            icon: icon,
            title: title,
            message: message,
            action: ElevatedButton.icon(
              onPressed: onAction,
              icon: const Icon(Icons.calendar_month_rounded, size: 18),
              label: Text(actionLabel),
            ),
          ),
        ),
      ),
    );
  }
}

class _JourneyOverview extends StatelessWidget {
  const _JourneyOverview({
    required this.replay,
    required this.selectedDay,
    required this.weather,
  });

  final JourneyReplayController replay;
  final DateTime selectedDay;
  final TypicalWeather weather;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final stats = replay.stats;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'RECORDED JOURNEY',
                    style: TextStyle(
                      color: colors.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.3,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _overviewTitle(selectedDay),
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 24,
                      height: 1.08,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.7,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _journeyTimeRange(stats),
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
              decoration: BoxDecoration(
                color: colors.surface.withValues(alpha: 0.9),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.wb_sunny_outlined,
                    color: GuardianColors.warning,
                    size: 16,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '${weather.tempC}° · ${weather.label}',
                    style: TextStyle(
                      color: colors.textSecondary,
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 13),
        LayoutBuilder(
          builder: (context, constraints) {
            const gap = 10.0;
            final columns = constraints.maxWidth >= 760
                ? 4
                : constraints.maxWidth >= 390
                ? 2
                : 1;
            final width =
                (constraints.maxWidth - (gap * (columns - 1))) / columns;
            final metrics = [
              (
                icon: Icons.route_rounded,
                label: 'Distance',
                value: '${stats.distanceKm.toStringAsFixed(1)} km',
                color: GuardianColors.safe,
              ),
              (
                icon: Icons.schedule_rounded,
                label: 'Travel time',
                value: formatJourneyDuration(stats.duration),
                color: const Color(0xFF5079C9),
              ),
              (
                icon: Icons.pause_circle_outline_rounded,
                label: 'Stops',
                value: '${replay.insights.stopCount}',
                color: GuardianColors.warning,
              ),
              (
                icon: Icons.gps_fixed_rounded,
                label: 'GPS record',
                value: replay.insights.gpsQualityLabel,
                color: const Color(0xFF8C6FC7),
              ),
            ];

            return Wrap(
              spacing: gap,
              runSpacing: gap,
              children: [
                for (final metric in metrics)
                  SizedBox(
                    width: width,
                    child: _JourneyMetricCard(
                      icon: metric.icon,
                      label: metric.label,
                      value: metric.value,
                      color: metric.color,
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }

  String _overviewTitle(DateTime day) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(day.year, day.month, day.day);
    final difference = target.difference(today).inDays;
    if (difference == 0) return 'Today so far';
    if (difference == -1) return 'Yesterday’s route';
    return '${DateFormat.EEEE().format(day)}’s route';
  }

  String _journeyTimeRange(JourneyStats stats) {
    final start = stats.startTime;
    final end = stats.endTime;
    if (start == null || end == null) {
      return '${stats.pointCount} recorded location points';
    }
    return '${DateFormat.Hm().format(start)}–${DateFormat.Hm().format(end)}'
        ' · ${stats.pointCount} recorded location points';
  }
}

class _JourneyMetricCard extends StatelessWidget {
  const _JourneyMetricCard({
    required this.icon,
    required this.label,
    required this.value,
    required this.color,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      height: 76,
      padding: const EdgeInsets.symmetric(horizontal: 13),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.055),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.25,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  value,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
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

class _JourneyMapCard extends StatelessWidget {
  const _JourneyMapCard({
    required this.replay,
    required this.deviceName,
    required this.imei,
    this.avatarUrl,
    required this.weatherLabel,
    required this.mapType,
    required this.showHeatmap,
    required this.compareMode,
    required this.compareDay,
    required this.comparePoints,
    required this.similarityPercent,
    required this.loadingCompare,
    required this.onMapCreated,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
    required this.onCenterMap,
    required this.onMapLockToggle,
    required this.onWeatherInfo,
    required this.onCompareDismiss,
  });

  final JourneyReplayController replay;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final String weatherLabel;
  final MapType mapType;
  final bool showHeatmap;
  final bool compareMode;
  final DateTime? compareDay;
  final List<LocationHistoryPoint>? comparePoints;
  final int? similarityPercent;
  final bool loadingCompare;
  final ValueChanged<GoogleMapController> onMapCreated;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;
  final VoidCallback onCenterMap;
  final VoidCallback onMapLockToggle;
  final VoidCallback onWeatherInfo;
  final VoidCallback onCompareDismiss;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final isSatellite = mapType == MapType.hybrid;

    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white.withValues(alpha: 0.92)),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.1),
            blurRadius: 30,
            offset: const Offset(0, 13),
          ),
        ],
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          SizedBox(
            height: 58,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 9, 8),
              child: Row(
                children: [
                  Container(
                    width: 34,
                    height: 34,
                    decoration: BoxDecoration(
                      color: GuardianColors.safeBg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.map_outlined,
                      color: GuardianColors.safe,
                      size: 19,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Route replay',
                          style: TextStyle(
                            color: colors.textPrimary,
                            fontSize: 13,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          replay.isReplayMode
                              ? 'Following the recorded route'
                              : 'Complete recorded route',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: colors.textMuted,
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Flexible(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      reverse: true,
                      child: Row(
                        children: [
                          _JourneyMapTool(
                            tooltip: 'Choose date',
                            icon: Icons.calendar_month_outlined,
                            onTap: onTimeMachine,
                          ),
                          _JourneyMapTool(
                            tooltip: weatherLabel,
                            icon: Icons.wb_sunny_outlined,
                            onTap: onWeatherInfo,
                          ),
                          _JourneyMapTool(
                            tooltip: replay.followCamera
                                ? 'Stop following'
                                : 'Follow replay',
                            icon: replay.followCamera
                                ? Icons.gps_fixed_rounded
                                : Icons.gps_off_rounded,
                            active: replay.followCamera,
                            onTap: onMapLockToggle,
                          ),
                          _JourneyMapTool(
                            tooltip: isSatellite
                                ? 'Street map'
                                : 'Satellite map',
                            icon: isSatellite
                                ? Icons.map_outlined
                                : Icons.satellite_alt_outlined,
                            active: isSatellite,
                            onTap: onMapTypeToggle,
                          ),
                          _JourneyMapTool(
                            tooltip: showHeatmap ? 'Show route' : 'Heat map',
                            icon: showHeatmap
                                ? Icons.route_rounded
                                : Icons.blur_on_rounded,
                            active: showHeatmap,
                            onTap: onHeatmapToggle,
                          ),
                          _JourneyMapTool(
                            tooltip: 'Center route',
                            icon: Icons.center_focus_strong_rounded,
                            onTap: onCenterMap,
                          ),
                          _JourneyMapTool(
                            tooltip: compareMode
                                ? 'Exit comparison'
                                : 'Compare days',
                            icon: Icons.compare_arrows_rounded,
                            active: compareMode,
                            onTap: onCompareToggle,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                _JourneyMap(
                  replay: replay,
                  deviceName: deviceName,
                  imei: imei,
                  avatarUrl: avatarUrl,
                  mapType: mapType,
                  showHeatmap: showHeatmap,
                  comparePoints: comparePoints,
                  compareMode: compareMode,
                  onMapCreated: onMapCreated,
                ),
                if (compareMode)
                  Positioned(
                    top: 10,
                    left: 4,
                    right: 4,
                    child: JourneyCompareBanner(
                      compareDay: compareDay,
                      similarityPercent: similarityPercent,
                      loading: loadingCompare,
                      primaryStats: replay.stats,
                      comparePoints: comparePoints,
                      onDismiss: onCompareDismiss,
                    ),
                  ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom:
                      JourneyScreenTheme.playbackBottomOffset +
                      JourneyScreenTheme.playbackCollapsedHeight +
                      8,
                  child: Center(
                    child: JourneyRouteLegend(
                      trackedPersonLabel: deviceName,
                      trackedPersonColor: avatarColorForKey(imei),
                    ),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: JourneyScreenTheme.playbackBottomOffset,
                  child: JourneyPlaybackBar(replay: replay),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyMapTool extends StatelessWidget {
  const _JourneyMapTool({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.active = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.only(left: 5),
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: active ? GuardianColors.safeBg : colors.surfaceMuted,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(11),
            child: SizedBox(
              width: 36,
              height: 36,
              child: Icon(
                icon,
                size: 18,
                color: active ? GuardianColors.safe : colors.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _JourneyInsightPanel extends StatelessWidget {
  const _JourneyInsightPanel({required this.replay, required this.weather});

  final JourneyReplayController replay;
  final TypicalWeather weather;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final stats = replay.stats;
    final insights = replay.insights;
    final highlights = replay.highlights;
    final events = replay.events.take(4).toList(growable: false);

    return Container(
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(26),
        border: Border.all(color: Colors.white.withValues(alpha: 0.92)),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.075),
            blurRadius: 28,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(17),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const GuardianAiIcon(size: 34),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Guardian’s view',
                        style: TextStyle(
                          color: colors.textPrimary,
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          letterSpacing: -0.2,
                        ),
                      ),
                      const Text(
                        'Guardian AI · Backed by Claude',
                        style: TextStyle(
                          color: GuardianColors.safe,
                          fontSize: 9,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: GuardianColors.safeBg,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '${insights.confidenceScore}%',
                    style: const TextStyle(
                      color: GuardianColors.safeText,
                      fontSize: 10,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 13),
            Container(
              padding: const EdgeInsets.all(13),
              decoration: BoxDecoration(
                color: GuardianColors.safeBg.withValues(alpha: 0.78),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Text(
                insights.routeSummary,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 12,
                  height: 1.45,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(height: 17),
            _JourneyPanelTitle(label: 'Journey details'),
            const SizedBox(height: 9),
            _JourneyDetailRow(
              icon: Icons.play_circle_outline_rounded,
              label: 'Started',
              value: _formatTime(stats.startTime),
            ),
            _JourneyDetailRow(
              icon: Icons.flag_outlined,
              label: 'Finished',
              value: _formatTime(stats.endTime),
            ),
            _JourneyDetailRow(
              icon: Icons.speed_rounded,
              label: 'Average speed',
              value: insights.avgSpeedKmh == null
                  ? 'Not available'
                  : '${insights.avgSpeedKmh!.toStringAsFixed(1)} km/h',
            ),
            _JourneyDetailRow(
              icon: Icons.flash_on_rounded,
              label: 'Highest speed',
              value: highlights.highestSpeedKmh == null
                  ? 'Not available'
                  : '${highlights.highestSpeedKmh!.toStringAsFixed(0)} km/h',
            ),
            _JourneyDetailRow(
              icon: Icons.wb_sunny_outlined,
              label: 'Typical weather',
              value: '${weather.tempC}° · ${weather.label}',
            ),
            if (events.isNotEmpty) ...[
              const SizedBox(height: 13),
              _JourneyPanelTitle(label: 'Route moments'),
              const SizedBox(height: 8),
              for (var index = 0; index < events.length; index++)
                _JourneyEventRow(
                  event: events[index],
                  isLast: index == events.length - 1,
                ),
            ],
            const SizedBox(height: 13),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 9, 8, 9),
              decoration: BoxDecoration(
                color: colors.surfaceMuted,
                borderRadius: BorderRadius.circular(17),
                border: Border.all(color: colors.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Need more context?',
                          style: TextStyle(
                            color: colors.textPrimary,
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          'Ask Guardian about this route',
                          style: TextStyle(
                            color: colors.textMuted,
                            fontSize: 9,
                          ),
                        ),
                      ],
                    ),
                  ),
                  JourneyAssistantButton(replay: replay),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime? time) {
    if (time == null) return 'Not recorded';
    return DateFormat.Hm().format(time);
  }
}

class _JourneyPanelTitle extends StatelessWidget {
  const _JourneyPanelTitle({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Text(
      label.toUpperCase(),
      style: TextStyle(
        color: colors.textMuted,
        fontSize: 8,
        fontWeight: FontWeight.w900,
        letterSpacing: 1.05,
      ),
    );
  }
}

class _JourneyDetailRow extends StatelessWidget {
  const _JourneyDetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        children: [
          Icon(icon, size: 16, color: GuardianColors.safe),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 10,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.right,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 10,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyEventRow extends StatelessWidget {
  const _JourneyEventRow({required this.event, required this.isLast});

  final JourneyEvent event;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final color = _colorFor(event.type);

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 18,
            child: Column(
              children: [
                Container(
                  width: 9,
                  height: 9,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                    border: Border.all(color: Colors.white, width: 2),
                    boxShadow: [
                      BoxShadow(
                        color: color.withValues(alpha: 0.28),
                        blurRadius: 7,
                      ),
                    ],
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 1.5,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      color: colors.border,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 11),
              child: Text(
                event.label,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 10,
                  height: 1.25,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _colorFor(JourneyEventType type) {
    return switch (type) {
      JourneyEventType.leftHome => const Color(0xFF5079C9),
      JourneyEventType.walking => GuardianColors.safe,
      JourneyEventType.vehicle => const Color(0xFF5079C9),
      JourneyEventType.stopped => GuardianColors.warning,
      JourneyEventType.arrived => GuardianColors.safe,
      JourneyEventType.dwell => const Color(0xFF8C6FC7),
    };
  }
}

class _JourneyMap extends StatefulWidget {
  const _JourneyMap({
    required this.replay,
    required this.deviceName,
    required this.imei,
    this.avatarUrl,
    required this.onMapCreated,
    required this.mapType,
    required this.showHeatmap,
    required this.comparePoints,
    required this.compareMode,
  });

  final JourneyReplayController replay;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final ValueChanged<GoogleMapController> onMapCreated;
  final MapType mapType;
  final bool showHeatmap;
  final List<LocationHistoryPoint>? comparePoints;
  final bool compareMode;

  @override
  State<_JourneyMap> createState() => _JourneyMapState();
}

class _JourneyMapState extends State<_JourneyMap> {
  GoogleMapController? _mapController;
  final ValueNotifier<int> _mapCameraGeneration = ValueNotifier(0);
  BitmapDescriptor? _replayAvatarIcon;
  String _avatarFingerprint = '';
  int _avatarGeneration = 0;

  @override
  void initState() {
    super.initState();
    widget.replay.addListener(_onReplayChanged);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    unawaited(_refreshReplayAvatarIcon());
  }

  @override
  void didUpdateWidget(covariant _JourneyMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.replay != widget.replay) {
      oldWidget.replay.removeListener(_onReplayChanged);
      widget.replay.addListener(_onReplayChanged);
    }
    if (oldWidget.deviceName != widget.deviceName ||
        oldWidget.imei != widget.imei ||
        oldWidget.avatarUrl != widget.avatarUrl) {
      unawaited(_refreshReplayAvatarIcon());
    }
  }

  @override
  void dispose() {
    widget.replay.removeListener(_onReplayChanged);
    _mapCameraGeneration.dispose();
    super.dispose();
  }

  Future<void> _refreshReplayAvatarIcon() async {
    if (kIsWeb) return;
    final fingerprint =
        '${widget.imei}|${widget.deviceName}|${widget.avatarUrl ?? ''}';
    if (fingerprint == _avatarFingerprint) return;
    _avatarFingerprint = fingerprint;
    final generation = ++_avatarGeneration;

    try {
      final icon = await PersonMapMarker.create(
        initials: initialsFor(widget.deviceName),
        color: avatarColorForKey(widget.imei),
        selected: true,
        surfaceColor: context.guardianColors.surface,
        imageUrl: widget.avatarUrl,
      );
      if (!mounted || generation != _avatarGeneration) return;
      setState(() => _replayAvatarIcon = icon);
    } catch (_) {
      // Keep the standard replay marker if an avatar cannot be rendered.
    }
  }

  void _onReplayChanged() {
    if (mounted) {
      setState(() {});
      unawaited(_followReplayMarker());
    }
  }

  Future<void> _followReplayMarker() async {
    final replay = widget.replay;
    final controller = _mapController;
    final point = replay.currentPoint;
    if (controller == null || point == null || !replay.shouldMoveCamera) return;
    replay.markCameraMoved();
    final update = CameraUpdate.newLatLng(LatLng(point.lat, point.lng));
    if (replay.isPlaying) {
      await controller.moveCamera(update);
    } else {
      await controller.animateCamera(update);
    }
  }

  Set<Polyline> _buildPolylines() {
    final replay = widget.replay;
    final polylines = <Polyline>{};

    if (!widget.showHeatmap) {
      final points = replay.smoothedPoints;
      if (points.length >= 2) {
        final maxIndex = replay.isReplayMode
            ? replay.currentIndex
            : points.length - 1;
        var segmentIndex = 0;

        for (final segment in replay.displayRouteSegments) {
          if (segment.startIndex > maxIndex) break;
          final end = segment.endIndex.clamp(segment.startIndex, maxIndex);
          if (end <= segment.startIndex) continue;

          final segmentPoints = points
              .sublist(segment.startIndex, end + 1)
              .map((p) => LatLng(p.lat, p.lng))
              .toList();
          if (segmentPoints.length < 2) continue;

          polylines.add(
            Polyline(
              polylineId: PolylineId('segment_$segmentIndex'),
              points: segmentPoints,
              color: JourneyScreenTheme.accent,
              width: 5,
              startCap: Cap.roundCap,
              endCap: Cap.roundCap,
              jointType: JointType.round,
            ),
          );
          segmentIndex++;
        }
      }
    }

    final compare = widget.comparePoints;
    if (widget.compareMode && compare != null && compare.length >= 2) {
      polylines.add(
        Polyline(
          polylineId: const PolylineId('compare'),
          points: compare.map((p) => LatLng(p.lat, p.lng)).toList(),
          color: JourneyScreenTheme.danger.withValues(alpha: 0.75),
          width: 4,
          patterns: [PatternItem.dash(20), PatternItem.gap(12)],
        ),
      );
    }

    return polylines;
  }

  Set<Circle> _buildHeatmapCircles() {
    if (!widget.showHeatmap) return const {};

    final cells = buildHeatmapCells(widget.replay.rawPoints);
    if (cells.isEmpty) return const {};

    final maxCount = cells
        .map((c) => c.visitCount)
        .reduce((a, b) => a > b ? a : b);

    return cells.map((cell) {
      final intensity = cell.visitCount / maxCount;
      return Circle(
        circleId: CircleId('heat_${cell.lat}_${cell.lng}'),
        center: LatLng(cell.lat, cell.lng),
        radius: 40 + (intensity * 60),
        fillColor: JourneyScreenTheme.accent.withValues(
          alpha: 0.15 + intensity * 0.45,
        ),
        strokeColor: JourneyScreenTheme.accent.withValues(
          alpha: 0.1 + intensity * 0.2,
        ),
        strokeWidth: 1,
      );
    }).toSet();
  }

  void _onMapCameraMove(CameraPosition position) {
    _mapCameraGeneration.value++;
  }

  @override
  Widget build(BuildContext context) {
    final replay = widget.replay;
    final routePoints = replay.smoothedPoints;
    final cameraTarget = routePoints.isNotEmpty
        ? LatLng(routePoints.first.lat, routePoints.first.lng)
        : _kMauritiusFallback;

    return Stack(
      fit: StackFit.expand,
      children: [
        GoogleMap(
          initialCameraPosition: CameraPosition(target: cameraTarget, zoom: 14),
          padding: JourneyScreenTheme.mapControlPadding,
          onMapCreated: (controller) {
            _mapController = controller;
            _mapCameraGeneration.value++;
            widget.onMapCreated(controller);
          },
          onCameraMove: _onMapCameraMove,
          onCameraIdle: () => _mapCameraGeneration.value++,
          polylines: _buildPolylines(),
          circles: _buildHeatmapCircles(),
          markers: buildJourneyColoredMarkers(
            replay,
            includeCurrentMarker: !kIsWeb,
            replayAvatarIcon: _replayAvatarIcon,
          ),
          mapType: widget.mapType,
          style: widget.mapType == MapType.normal
              ? GuardianMapPresentation.style
              : null,
          webCameraControlEnabled: false,
          zoomControlsEnabled: false,
          mapToolbarEnabled: false,
          myLocationEnabled: false,
          myLocationButtonEnabled: false,
          tiltGesturesEnabled: false,
          rotateGesturesEnabled: false,
        ),
        ValueListenableBuilder<int>(
          valueListenable: _mapCameraGeneration,
          builder: (context, generation, _) {
            final point = replay.currentPoint;
            if (!kIsWeb || !replay.isReplayMode || point == null) {
              return const SizedBox.shrink();
            }
            return JourneyMapAvatarOverlay(
              controller: _mapController,
              slots: [
                JourneyMapAvatarSlot(
                  id: 'replay-${widget.imei}',
                  latLng: LatLng(point.lat, point.lng),
                  selected: true,
                ),
              ],
              cameraGeneration: generation,
              deviceName: widget.deviceName,
              imei: widget.imei,
              avatarUrl: widget.avatarUrl,
            );
          },
        ),
      ],
    );
  }
}

/// Back-compat export — dashboard imports may still reference the old name.
typedef RouteHistoryPage = JourneyPage;
