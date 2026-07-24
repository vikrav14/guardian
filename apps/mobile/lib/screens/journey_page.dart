import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../journey/journey_map_controls.dart';
import '../journey/journey_map_styles.dart';
import '../journey/journey_models.dart';
import '../journey/journey_replay_controller.dart';
import '../journey/journey_share.dart';
import '../journey/journey_utils.dart';
import '../journey/ui/journey_assistant_button.dart';
import '../journey/ui/journey_compare_banner.dart';
import '../journey/ui/journey_details_drawer.dart';
import '../journey/ui/journey_fab_menu.dart';
import '../journey/ui/journey_header.dart';
import '../journey/ui/journey_map_markers.dart';
import '../journey/ui/journey_playback_bar.dart';
import '../journey/ui/journey_route_legend.dart';
import '../journey/ui/journey_screen_theme.dart';
import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../models/device.dart';
import '../services/guardian_services.dart';

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
    return _day.year == now.year && _day.month == now.month && _day.day == now.day;
  }

  @override
  void initState() {
    super.initState();
    GeofenceService().watchAll().listen((zones) {
      if (!mounted) return;
      setState(() => _geofences = zones.where((z) => z.imei == widget.imei).toList());
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
      ShareJourneyResult.copiedAndWhatsApp => 'Journey summary copied — opening WhatsApp…',
      ShareJourneyResult.copiedOnly => 'Journey summary copied to clipboard.',
    };
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
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

  Future<void> _toggleCompareMode(List<LocationHistoryPoint> primaryPoints) async {
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
      final comparePoints = await DeviceService().fetchDayHistory(widget.imei, picked);
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

  bool _pointsEqual(List<LocationHistoryPoint> a, List<LocationHistoryPoint> b) {
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
    return Scaffold(
      backgroundColor: JourneyScreenTheme.background,
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
                      const SnackBar(content: Text('No journey data to share yet.')),
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
                      return Center(
                        child: Text(
                          '${snapshot.error}',
                          style: JourneyScreenTheme.textStyle(color: JourneyScreenTheme.textSecondary),
                        ),
                      );
                    }
                    if (!snapshot.hasData) {
                      return const Center(child: CircularProgressIndicator());
                    }
                    final dayData = snapshot.data!;
                    if (dayData.isEmpty) {
                      return Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(
                            'No journey data for this day.',
                            style: JourneyScreenTheme.textStyle(color: JourneyScreenTheme.textSecondary),
                            textAlign: TextAlign.center,
                          ),
                        ),
                      );
                    }

                    final replay = _controllerFor(dayData, gpsContext: gpsContext);
                    final weather = typicalWeatherForMonth(_day.month);

                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      _fitBounds(replay.smoothedPoints);
                    });

                    return _JourneyScreenLayout(
                      replay: replay,
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
                      onHeatmapToggle: () => setState(() => _showHeatmap = !_showHeatmap),
                      onMapTypeToggle: () => setState(() {
                        _mapType =
                            _mapType == MapType.normal ? MapType.hybrid : MapType.normal;
                      }),
                      onCompareToggle: () => _toggleCompareMode(dayData.points),
                      onTimeMachine: _openTimeMachine,
                      onCenterMap: () => _centerMap(replay),
                      onMapLockToggle: () => _toggleMapLock(replay),
                      onWeatherInfo: () => _showWeatherInfo(weather),
                      onCompareDismiss: () => _toggleCompareMode(dayData.points),
                    );
                  },
                );
              },
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
        return JourneyScreenTheme.chrome(
          child: Stack(
            fit: StackFit.expand,
            children: [
            Positioned.fill(
              child: _JourneyMap(
                replay: replay,
                mapType: mapType,
                showHeatmap: showHeatmap,
                comparePoints: comparePoints,
                compareMode: compareMode,
                onMapCreated: onMapCreated,
              ),
            ),
            if (compareMode)
              Positioned(
                top: JourneyScreenTheme.spacing,
                left: 0,
                right: JourneyScreenTheme.drawerCollapsedWidth + 8,
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
              top: JourneyScreenTheme.spacing2,
              right: JourneyScreenTheme.spacing2,
              child: JourneyFabMenu(
                showHeatmap: showHeatmap,
                mapType: mapType,
                compareMode: compareMode,
                mapLocked: !replay.followCamera,
                weatherLabel: _weatherLabel,
                onLockToggle: onMapLockToggle,
                onMapTypeToggle: onMapTypeToggle,
                onHistory: onTimeMachine,
                onWeatherInfo: onWeatherInfo,
                onCenterMap: onCenterMap,
                onHeatmapToggle: onHeatmapToggle,
                onCompareToggle: onCompareToggle,
              ),
            ),
            Positioned(
              top: 0,
              bottom: 0,
              right: 0,
              child: JourneyDetailsDrawer(
                replay: replay,
                weather: weather,
              ),
            ),
            Positioned(
              left: JourneyScreenTheme.spacing2,
              right: JourneyScreenTheme.drawerCollapsedWidth + JourneyScreenTheme.spacing2,
              bottom: JourneyScreenTheme.playbackBottomOffset +
                  JourneyScreenTheme.playbackCollapsedHeight +
                  JourneyScreenTheme.spacing,
              child: const Center(child: JourneyRouteLegend()),
            ),
            Positioned(
              left: JourneyScreenTheme.spacing2,
              right: JourneyScreenTheme.drawerCollapsedWidth + JourneyScreenTheme.spacing2,
              bottom: JourneyScreenTheme.playbackBottomOffset,
              child: JourneyPlaybackBar(replay: replay),
            ),
            Positioned(
              left: JourneyScreenTheme.spacing2,
              bottom: JourneyScreenTheme.assistantBottomOffset,
              child: JourneyAssistantButton(replay: replay),
            ),
          ],
        ),
        );
      },
    );
  }
}

class _JourneyMap extends StatefulWidget {
  const _JourneyMap({
    required this.replay,
    required this.onMapCreated,
    required this.mapType,
    required this.showHeatmap,
    required this.comparePoints,
    required this.compareMode,
  });

  final JourneyReplayController replay;
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

  @override
  void initState() {
    super.initState();
    widget.replay.addListener(_onReplayChanged);
  }

  @override
  void dispose() {
    widget.replay.removeListener(_onReplayChanged);
    _mapCameraGeneration.dispose();
    super.dispose();
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
        final maxIndex = replay.isReplayMode ? replay.currentIndex : points.length - 1;
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

    final maxCount = cells.map((c) => c.visitCount).reduce((a, b) => a > b ? a : b);

    return cells.map((cell) {
      final intensity = cell.visitCount / maxCount;
      return Circle(
        circleId: CircleId('heat_${cell.lat}_${cell.lng}'),
        center: LatLng(cell.lat, cell.lng),
        radius: 40 + (intensity * 60),
        fillColor: JourneyScreenTheme.accent.withValues(alpha: 0.15 + intensity * 0.45),
        strokeColor: JourneyScreenTheme.accent.withValues(alpha: 0.1 + intensity * 0.2),
        strokeWidth: 1,
      );
    }).toSet();
  }

  List<Map<String, dynamic>> _mapStyleForReplay() {
    if (!widget.replay.isReplayMode || !widget.replay.isPlaying) {
      return JourneyMapStyles.light;
    }

    final time = interpolateJourneyTime(widget.replay.rawPoints, widget.replay.progress);
    if (time != null && !isEveningOrNight(time)) {
      return JourneyMapStyles.light;
    }
    return JourneyMapStyles.dark;
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
    final mapStyle = _mapStyleForReplay();

    return Stack(
      fit: StackFit.expand,
      children: [
        GoogleMap(
          initialCameraPosition: CameraPosition(
            target: cameraTarget,
            zoom: 14,
          ),
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
          ),
          mapType: widget.mapType,
          style: mapStyle.isEmpty ? null : jsonEncode(mapStyle),
          zoomControlsEnabled: false,
          mapToolbarEnabled: false,
          myLocationButtonEnabled: false,
          tiltGesturesEnabled: false,
          rotateGesturesEnabled: false,
        ),
        ValueListenableBuilder<int>(
          valueListenable: _mapCameraGeneration,
          builder: (context, generation, _) {
            return JourneyReplayPulseOverlay(
              controller: _mapController,
              replay: replay,
              cameraGeneration: generation,
            );
          },
        ),
      ],
    );
  }
}

/// Back-compat export — dashboard imports may still reference the old name.
typedef RouteHistoryPage = JourneyPage;
