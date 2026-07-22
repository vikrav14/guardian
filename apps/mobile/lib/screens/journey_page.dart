import 'dart:convert';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';

import '../journey/journey_map_controls.dart';
import '../journey/journey_map_styles.dart';
import '../journey/journey_models.dart';
import '../journey/journey_replay_controller.dart';
import '../journey/journey_share.dart';
import '../journey/journey_utils.dart';
import '../models/geofence.dart';
import '../models/location_history_point.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/brand/dodo_ai_icon.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/map/person_map_marker.dart';

/// Map overlay glass — lighter than [GuardianThemeColors.glass] so the route shows through.
const _kJourneyMapGlassBlur = 24.0;
const _kJourneyMapGlassFillAlpha = 0.38;
const _kJourneyMapGlassBorderAlpha = 0.28;

Color _journeyMapGlassFill(GuardianThemeColors colors) =>
    colors.glass.withValues(alpha: _kJourneyMapGlassFillAlpha);

Border _journeyMapGlassBorder() =>
    Border.all(color: Colors.white.withValues(alpha: _kJourneyMapGlassBorderAlpha));

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
  late DateTime _day = DateTime.now();
  GoogleMapController? _mapController;
  JourneyReplayController? _replay;
  List<LocationHistoryPoint>? _cachedPoints;
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

  String get _journeyTitle =>
      _isToday ? "Today's Journey" : '${DateFormat.yMMMEd().format(_day)} Journey';

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

  void _changeDay(int deltaDays) {
    _selectDay(_day.add(Duration(days: deltaDays)));
  }

  JourneyReplayController _controllerFor(List<LocationHistoryPoint> points) {
    if (_replay != null &&
        _cachedPoints != null &&
        _pointsEqual(_cachedPoints!, points)) {
      return _replay!;
    }
    _replay?.dispose();
    _cachedPoints = points;
    _replay = JourneyReplayController(
      rawPoints: points,
      geofences: _geofences,
    );
    return _replay!;
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
    if (controller == null || points.isEmpty || _didFitForDay) return;
    _didFitForDay = true;

    if (points.length == 1) {
      await controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(points.first.lat, points.first.lng), 15),
      );
      return;
    }

    double minLat = points.first.lat, maxLat = points.first.lat;
    double minLng = points.first.lng, maxLng = points.first.lng;
    for (final p in points) {
      minLat = minLat < p.lat ? minLat : p.lat;
      maxLat = maxLat > p.lat ? maxLat : p.lat;
      minLng = minLng < p.lng ? minLng : p.lng;
      maxLng = maxLng > p.lng ? maxLng : p.lng;
    }
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(southwest: LatLng(minLat, minLng), northeast: LatLng(maxLat, maxLng)),
        48,
      ),
    );
  }

  Future<void> _followReplayMarker(JourneyReplayController replay) async {
    final controller = _mapController;
    final point = replay.currentPoint;
    if (controller == null || point == null || !replay.shouldMoveCamera) return;
    replay.markCameraMoved();
    await controller.animateCamera(
      CameraUpdate.newLatLng(LatLng(point.lat, point.lng)),
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
    final isWide = MediaQuery.sizeOf(context).width >= GuardianBreakpoints.expanded;

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: Text('${widget.deviceName} · Journey'),
        backgroundColor: colors.surface,
        foregroundColor: colors.textPrimary,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: JourneyPhase2Features.share,
            onPressed: () {
              final points = _cachedPoints;
              if (points == null || points.isEmpty) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('No journey data to share yet.')),
                );
                return;
              }
              _shareJourney(points);
            },
            icon: const Icon(Icons.ios_share_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.chevron_left),
                  onPressed: () => _changeDay(-1),
                ),
                InkWell(
                  onTap: _openTimeMachine,
                  borderRadius: BorderRadius.circular(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.history_rounded, size: 16, color: colors.textMuted),
                        const SizedBox(width: 6),
                        Text(
                          _journeyTitle,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        Icon(Icons.arrow_drop_down, color: colors.textMuted),
                      ],
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _isToday ? null : () => _changeDay(1),
                ),
              ],
            ),
          ),
          Expanded(
            child: StreamBuilder<List<LocationHistoryPoint>>(
              key: ValueKey(_day),
              stream: DeviceService().watchDayHistory(widget.imei, _day),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(child: Text('${snapshot.error}'));
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }
                final points = snapshot.data!;
                if (points.isEmpty) {
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        'No journey data for this day.',
                        style: TextStyle(color: colors.textSecondary),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  );
                }

                final replay = _controllerFor(points);
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  _fitBounds(replay.smoothedPoints);
                  _followReplayMarker(replay);
                });

                if (isWide) {
                  return _WideJourneyLayout(
                    replay: replay,
                    journeyTitle: _journeyTitle,
                    deviceName: widget.deviceName,
                    imei: widget.imei,
                    avatarUrl: widget.avatarUrl,
                    mapType: _mapType,
                    showHeatmap: _showHeatmap,
                    compareMode: _compareMode,
                    compareDay: _compareDay,
                    comparePoints: _comparePoints,
                    similarityPercent: _similarityPercent,
                    loadingCompare: _loadingCompare,
                    weather: typicalWeatherForMonth(_day.month),
                    onMapCreated: (c) {
                      _mapController = c;
                      _fitBounds(replay.smoothedPoints);
                    },
                    onHeatmapToggle: () => setState(() => _showHeatmap = !_showHeatmap),
                    onMapTypeToggle: () => setState(() {
                      _mapType =
                          _mapType == MapType.normal ? MapType.hybrid : MapType.normal;
                    }),
                    onCompareToggle: () => _toggleCompareMode(points),
                    onTimeMachine: _openTimeMachine,
                  );
                }

                return _MobileJourneyLayout(
                  replay: replay,
                  journeyTitle: _journeyTitle,
                  deviceName: widget.deviceName,
                  imei: widget.imei,
                  avatarUrl: widget.avatarUrl,
                  mapType: _mapType,
                  showHeatmap: _showHeatmap,
                  compareMode: _compareMode,
                  compareDay: _compareDay,
                  comparePoints: _comparePoints,
                  similarityPercent: _similarityPercent,
                  loadingCompare: _loadingCompare,
                  weather: typicalWeatherForMonth(_day.month),
                  onMapCreated: (c) {
                    _mapController = c;
                    _fitBounds(replay.smoothedPoints);
                  },
                  onHeatmapToggle: () => setState(() => _showHeatmap = !_showHeatmap),
                  onMapTypeToggle: () => setState(() {
                    _mapType =
                        _mapType == MapType.normal ? MapType.hybrid : MapType.normal;
                  }),
                  onCompareToggle: () => _toggleCompareMode(points),
                  onTimeMachine: _openTimeMachine,
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _WideJourneyLayout extends StatelessWidget {
  const _WideJourneyLayout({
    required this.replay,
    required this.journeyTitle,
    required this.deviceName,
    required this.imei,
    required this.onMapCreated,
    required this.mapType,
    required this.showHeatmap,
    required this.compareMode,
    required this.compareDay,
    required this.comparePoints,
    required this.similarityPercent,
    required this.loadingCompare,
    required this.weather,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
    this.avatarUrl,
  });

  final JourneyReplayController replay;
  final String journeyTitle;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final ValueChanged<GoogleMapController> onMapCreated;
  final MapType mapType;
  final bool showHeatmap;
  final bool compareMode;
  final DateTime? compareDay;
  final List<LocationHistoryPoint>? comparePoints;
  final int? similarityPercent;
  final bool loadingCompare;
  final TypicalWeather weather;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: replay,
      builder: (context, _) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                flex: 3,
                child: Column(
                  children: [
                    Expanded(
                      child: _JourneyMap(
                        replay: replay,
                        journeyTitle: journeyTitle,
                        deviceName: deviceName,
                        imei: imei,
                        avatarUrl: avatarUrl,
                        mapType: mapType,
                        showHeatmap: showHeatmap,
                        comparePoints: comparePoints,
                        weather: weather,
                        onMapCreated: onMapCreated,
                        onHeatmapToggle: onHeatmapToggle,
                        onMapTypeToggle: onMapTypeToggle,
                        onCompareToggle: onCompareToggle,
                        onTimeMachine: onTimeMachine,
                        compareMode: compareMode,
                      ),
                    ),
                    if (compareMode) ...[
                      const SizedBox(height: 8),
                      _CompareModeBanner(
                        compareDay: compareDay,
                        similarityPercent: similarityPercent,
                        loading: loadingCompare,
                        primaryStats: replay.stats,
                        comparePoints: comparePoints,
                      ),
                    ],
                    const SizedBox(height: 10),
                    _JourneyHealthFooter(health: replay.health),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              SizedBox(
                width: 300,
                child: SingleChildScrollView(
                  child: _JourneyDetailsColumn(replay: replay),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _MobileJourneyLayout extends StatelessWidget {
  const _MobileJourneyLayout({
    required this.replay,
    required this.journeyTitle,
    required this.deviceName,
    required this.imei,
    required this.onMapCreated,
    required this.mapType,
    required this.showHeatmap,
    required this.compareMode,
    required this.compareDay,
    required this.comparePoints,
    required this.similarityPercent,
    required this.loadingCompare,
    required this.weather,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
    this.avatarUrl,
  });

  final JourneyReplayController replay;
  final String journeyTitle;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final ValueChanged<GoogleMapController> onMapCreated;
  final MapType mapType;
  final bool showHeatmap;
  final bool compareMode;
  final DateTime? compareDay;
  final List<LocationHistoryPoint>? comparePoints;
  final int? similarityPercent;
  final bool loadingCompare;
  final TypicalWeather weather;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: replay,
      builder: (context, _) {
        return Column(
          children: [
            Expanded(
              flex: 5,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: Column(
                  children: [
                    Expanded(
                      child: _JourneyMap(
                        replay: replay,
                        journeyTitle: journeyTitle,
                        deviceName: deviceName,
                        imei: imei,
                        avatarUrl: avatarUrl,
                        mapType: mapType,
                        showHeatmap: showHeatmap,
                        comparePoints: comparePoints,
                        weather: weather,
                        onMapCreated: onMapCreated,
                        onHeatmapToggle: onHeatmapToggle,
                        onMapTypeToggle: onMapTypeToggle,
                        onCompareToggle: onCompareToggle,
                        onTimeMachine: onTimeMachine,
                        compareMode: compareMode,
                      ),
                    ),
                    if (compareMode) ...[
                      const SizedBox(height: 8),
                      _CompareModeBanner(
                        compareDay: compareDay,
                        similarityPercent: similarityPercent,
                        loading: loadingCompare,
                        primaryStats: replay.stats,
                        comparePoints: comparePoints,
                      ),
                    ],
                  ],
                ),
              ),
            ),
            Expanded(
              flex: 4,
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                child: _JourneyDetailsColumn(replay: replay),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _CompactSummaryRow extends StatelessWidget {
  const _CompactSummaryRow({
    required this.journeyTitle,
    required this.replay,
  });

  final String journeyTitle;
  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final stats = replay.stats;
    final quality = replay.quality;
    final routeLabel = replay.insights.stopCount == 0
        ? 'Normal'
        : replay.insights.stopCount <= 2
            ? 'Brief stops'
            : 'Unusual';

    return ClipRRect(
      borderRadius: BorderRadius.circular(GuardianRadius.medium),
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _kJourneyMapGlassBlur,
          sigmaY: _kJourneyMapGlassBlur,
        ),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: _journeyMapGlassFill(colors),
            borderRadius: BorderRadius.circular(GuardianRadius.medium),
            border: _journeyMapGlassBorder(),
          ),
          child: Text.rich(
            TextSpan(
              style: TextStyle(
                fontSize: 12,
                color: colors.textSecondary,
                height: 1.4,
                shadows: const [
                  Shadow(color: Color(0x33000000), blurRadius: 3),
                ],
              ),
              children: [
                TextSpan(
                  text: journeyTitle,
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: colors.textPrimary,
                  ),
                ),
                const TextSpan(text: '  |  '),
                TextSpan(text: '${stats.distanceKm.toStringAsFixed(1)} km'),
                const TextSpan(text: '  |  '),
                TextSpan(text: formatJourneyDuration(stats.duration)),
                const TextSpan(text: '  |  '),
                TextSpan(text: quality.fixesLabel),
                const TextSpan(text: '  |  '),
                TextSpan(
                  text: '✓ $routeLabel',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: replay.insights.stopCount <= 2
                        ? colors.accent
                        : colors.textPrimary,
                  ),
                ),
              ],
            ),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ),
    );
  }
}

class _JourneyDetailsColumn extends StatelessWidget {
  const _JourneyDetailsColumn({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _JourneyTimelinePanel(replay: replay),
        const SizedBox(height: 10),
        _JourneyScoreCard(score: replay.score, quality: replay.quality),
        const SizedBox(height: 10),
        _JourneyHighlightsCard(highlights: replay.highlights),
        const SizedBox(height: 10),
        _JourneyInsightsCard(insights: replay.insights),
        const SizedBox(height: 10),
        _JourneyHealthFooter(health: replay.health),
      ],
    );
  }
}

class _JourneyMap extends StatefulWidget {
  const _JourneyMap({
    required this.replay,
    required this.journeyTitle,
    required this.deviceName,
    required this.imei,
    required this.onMapCreated,
    required this.mapType,
    required this.showHeatmap,
    required this.comparePoints,
    required this.weather,
    required this.onHeatmapToggle,
    required this.onMapTypeToggle,
    required this.onCompareToggle,
    required this.onTimeMachine,
    required this.compareMode,
    this.avatarUrl,
  });

  final JourneyReplayController replay;
  final String journeyTitle;
  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final ValueChanged<GoogleMapController> onMapCreated;
  final MapType mapType;
  final bool showHeatmap;
  final List<LocationHistoryPoint>? comparePoints;
  final TypicalWeather weather;
  final VoidCallback onHeatmapToggle;
  final VoidCallback onMapTypeToggle;
  final VoidCallback onCompareToggle;
  final VoidCallback onTimeMachine;
  final bool compareMode;

  @override
  State<_JourneyMap> createState() => _JourneyMapState();
}

class _JourneyMapState extends State<_JourneyMap> {
  BitmapDescriptor? _personIcon;
  BitmapDescriptor? _personIconSelected;

  @override
  void initState() {
    super.initState();
    widget.replay.addListener(_onReplayChanged);
    _loadMarkerIcons();
  }

  @override
  void dispose() {
    widget.replay.removeListener(_onReplayChanged);
    super.dispose();
  }

  void _onReplayChanged() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(covariant _JourneyMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.deviceName != widget.deviceName ||
        oldWidget.imei != widget.imei ||
        oldWidget.avatarUrl != widget.avatarUrl) {
      _loadMarkerIcons();
    }
  }

  Future<void> _loadMarkerIcons() async {
    if (kIsWeb) return;
    final colors = context.guardianColors;
    final initials = initialsFor(widget.deviceName);
    final color = avatarColorForKey(widget.imei);
    try {
      final icon = await PersonMapMarker.create(
        initials: initials,
        color: color,
        selected: false,
        surfaceColor: colors.surface,
        imageUrl: widget.avatarUrl,
      );
      final selected = await PersonMapMarker.create(
        initials: initials,
        color: color,
        selected: true,
        surfaceColor: colors.surface,
        imageUrl: widget.avatarUrl,
      );
      if (!mounted) return;
      setState(() {
        _personIcon = icon;
        _personIconSelected = selected;
      });
    } catch (_) {
      // Fall back to default marker below.
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
              color: segment.color.toColor(),
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
          color: const Color(0xFFFF6B6B).withValues(alpha: 0.75),
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
        fillColor: const Color(0xFF378ADD).withValues(alpha: 0.15 + intensity * 0.45),
        strokeColor: const Color(0xFF378ADD).withValues(alpha: 0.1 + intensity * 0.2),
        strokeWidth: 1,
      );
    }).toSet();
  }

  List<Map<String, dynamic>> _mapStyleForReplay() {
    if (!widget.replay.isReplayMode || !widget.replay.isPlaying) {
      return JourneyMapStyles.dark;
    }

    final time = interpolateJourneyTime(widget.replay.rawPoints, widget.replay.progress);
    if (time != null && !isEveningOrNight(time)) {
      return JourneyMapStyles.light;
    }
    return JourneyMapStyles.dark;
  }

  String get _weatherLabel {
    return '${widget.weather.display} · Typical';
  }

  Set<Marker> _buildMarkers() {
    final replay = widget.replay;
    final first = replay.smoothedPoints.first;
    final last = replay.smoothedPoints.last;
    final current = replay.currentPoint;
    final markers = <Marker>{
      Marker(
        markerId: const MarkerId('start'),
        position: LatLng(first.lat, first.lng),
        icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),
        infoWindow: const InfoWindow(title: 'Start'),
      ),
    };

    if (replay.smoothedPoints.length > 1 && !replay.isReplayMode) {
      markers.add(
        Marker(
          markerId: const MarkerId('end'),
          position: LatLng(last.lat, last.lng),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRose),
          infoWindow: const InfoWindow(title: 'End'),
        ),
      );
    }

    if (replay.isReplayMode && current != null) {
      final icon = _personIconSelected ?? _personIcon;
      markers.add(
        Marker(
          markerId: const MarkerId('replay'),
          position: LatLng(current.lat, current.lng),
          icon: icon ??
              BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          zIndexInt: 3,
          anchor: const Offset(0.5, 0.5),
        ),
      );
    }

    return markers;
  }

  String? _aiNarrationMessage(JourneyReplayController replay) {
    if (replay.isReplayMode && replay.currentNarration != null) {
      return replay.currentNarration;
    }
    if (!replay.isReplayMode) {
      return replay.insights.routeSummary;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final replay = widget.replay;
    final first = replay.smoothedPoints.first;
    final mapStyle = _mapStyleForReplay();
    final lightingActive = mapStyle.isNotEmpty;

    final aiMessage = _aiNarrationMessage(replay);

    return ClipRRect(
      borderRadius: BorderRadius.circular(GuardianRadius.large),
      child: Stack(
        fit: StackFit.expand,
        children: [
          GoogleMap(
            initialCameraPosition: CameraPosition(
              target: LatLng(first.lat, first.lng),
              zoom: 14,
            ),
            onMapCreated: widget.onMapCreated,
            polylines: _buildPolylines(),
            circles: _buildHeatmapCircles(),
            markers: _buildMarkers(),
            mapType: widget.mapType,
            style: mapStyle.isEmpty ? null : jsonEncode(mapStyle),
            zoomControlsEnabled: false,
            mapToolbarEnabled: false,
            myLocationButtonEnabled: false,
          ),
          Positioned(
            top: 10,
            left: 10,
            right: 52,
            child: _CompactSummaryRow(
              journeyTitle: widget.journeyTitle,
              replay: replay,
            ),
          ),
          if (aiMessage != null)
            Positioned(
              left: 12,
              right: 12,
              top: 58,
              child: _AiNarrationBubble(message: aiMessage),
            ),
          Positioned(
            top: 10,
            right: 10,
            child: JourneyMapControls(
              showHeatmap: widget.showHeatmap,
              mapType: widget.mapType,
              compareMode: widget.compareMode,
              lightingActive: lightingActive,
              weatherLabel: _weatherLabel,
              onHeatmapToggle: widget.onHeatmapToggle,
              onMapTypeToggle: widget.onMapTypeToggle,
              onCompareToggle: widget.onCompareToggle,
              onTimeMachine: widget.onTimeMachine,
            ),
          ),
          Positioned(
            left: 10,
            right: 10,
            bottom: 10,
            child: _GlassReplayPanel(replay: replay),
          ),
        ],
      ),
    );
  }
}

class _AiNarrationBubble extends StatelessWidget {
  const _AiNarrationBubble({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _kJourneyMapGlassBlur,
          sigmaY: _kJourneyMapGlassBlur,
        ),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: _journeyMapGlassFill(colors),
            borderRadius: BorderRadius.circular(16),
            border: _journeyMapGlassBorder(),
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const GuardianAiIcon(size: 36),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Guardian AI',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                        color: colors.textPrimary,
                        shadows: const [
                          Shadow(color: Color(0x33000000), blurRadius: 3),
                        ],
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      message,
                      style: TextStyle(
                        fontSize: 12,
                        height: 1.35,
                        color: colors.textSecondary,
                        shadows: const [
                          Shadow(color: Color(0x26000000), blurRadius: 2),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GlassReplayPanel extends StatelessWidget {
  const _GlassReplayPanel({required this.replay});

  final JourneyReplayController replay;

  List<JourneyEvent> get _scrubberEvents => replay.events.where((event) {
        return event.type == JourneyEventType.leftHome ||
            event.type == JourneyEventType.vehicle ||
            event.type == JourneyEventType.stopped ||
            event.type == JourneyEventType.arrived;
      }).toList();

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final start = replay.stats.startTime;
    final end = replay.stats.endTime;
    final currentTime = interpolateJourneyTime(replay.rawPoints, replay.progress);
    final scrubberEvents = _scrubberEvents;

    final iconColor = colors.textPrimary;

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: BackdropFilter(
        filter: ImageFilter.blur(
          sigmaX: _kJourneyMapGlassBlur,
          sigmaY: _kJourneyMapGlassBlur,
        ),
        child: Container(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
          decoration: BoxDecoration(
            color: _journeyMapGlassFill(colors),
            borderRadius: BorderRadius.circular(18),
            border: _journeyMapGlassBorder(),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 16,
                offset: const Offset(0, 6),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (replay.isReplayMode)
                    IconButton(
                      tooltip: 'Reset replay',
                      visualDensity: VisualDensity.compact,
                      onPressed: replay.exitReplayMode,
                      icon: Icon(Icons.close_rounded, size: 20, color: iconColor),
                    ),
                  IconButton(
                    tooltip: 'Skip to start',
                    visualDensity: VisualDensity.compact,
                    onPressed: replay.skipToStart,
                    icon: Icon(Icons.skip_previous_rounded, size: 22, color: iconColor),
                  ),
                  IconButton(
                    tooltip: replay.isPlaying ? 'Pause' : 'Play',
                    visualDensity: VisualDensity.compact,
                    onPressed: replay.togglePlayPause,
                    icon: Icon(
                      replay.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                      size: 28,
                      color: iconColor,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Skip to end',
                    visualDensity: VisualDensity.compact,
                    onPressed: replay.skipToEnd,
                    icon: Icon(Icons.skip_next_rounded, size: 22, color: iconColor),
                  ),
                  IconButton(
                    tooltip: 'Previous event',
                    visualDensity: VisualDensity.compact,
                    onPressed: replay.stepBackward,
                    icon: Icon(Icons.fast_rewind_rounded, size: 20, color: iconColor),
                  ),
                  IconButton(
                    tooltip: 'Next event',
                    visualDensity: VisualDensity.compact,
                    onPressed: replay.stepForward,
                    icon: Icon(Icons.fast_forward_rounded, size: 20, color: iconColor),
                  ),
                  const SizedBox(width: 4),
                  _SpeedDropdown(replay: replay),
                ],
              ),
              Row(
                children: [
                  Text(
                    start != null ? DateFormat.Hm().format(start) : '--:--',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: colors.textSecondary,
                      shadows: const [
                        Shadow(color: Color(0x33000000), blurRadius: 2),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SizedBox(
                      height: 36,
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          return Stack(
                            alignment: Alignment.center,
                            children: [
                              SliderTheme(
                                data: SliderTheme.of(context).copyWith(
                                  trackHeight: 3,
                                  thumbShape: const RoundSliderThumbShape(
                                    enabledThumbRadius: 6,
                                  ),
                                ),
                                child: Slider(
                                  value: replay.progress,
                                  onChanged: (value) {
                                    replay.seek(value);
                                    if (replay.isPlaying) replay.pause();
                                  },
                                ),
                              ),
                              ...scrubberEvents.map((event) {
                                final left = eventProgress(
                                      event,
                                      replay.rawPoints.length,
                                    ) *
                                    constraints.maxWidth;
                                return Positioned(
                                  left: left.clamp(0, constraints.maxWidth - 12),
                                  child: GestureDetector(
                                    onTap: () => replay.seekToEvent(event),
                                    child: Container(
                                      width: 10,
                                      height: 10,
                                      decoration: BoxDecoration(
                                        color: colors.accent,
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: colors.surface,
                                          width: 1.5,
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              }),
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                  Text(
                    end != null ? DateFormat.Hm().format(end) : '--:--',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: colors.textSecondary,
                      shadows: const [
                        Shadow(color: Color(0x33000000), blurRadius: 2),
                      ],
                    ),
                  ),
                ],
              ),
              if (currentTime != null)
                Text(
                  DateFormat.Hm().format(currentTime),
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: colors.accent,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                'Home · Vehicle · Stop · Arrival',
                style: TextStyle(
                  fontSize: 9,
                  fontWeight: FontWeight.w600,
                  color: colors.textSecondary,
                  shadows: const [
                    Shadow(color: Color(0x26000000), blurRadius: 2),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SpeedDropdown extends StatelessWidget {
  const _SpeedDropdown({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: colors.border),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<double>(
          value: JourneyReplayController.playbackSpeedOptions.contains(replay.playbackSpeed)
              ? replay.playbackSpeed
              : 1.0,
          isDense: true,
          style: TextStyle(fontSize: 12, color: colors.textPrimary),
          items: JourneyReplayController.playbackSpeedOptions
              .map(
                (speed) => DropdownMenuItem(
                  value: speed,
                  child: Text('${speed.toStringAsFixed(speed == speed.roundToDouble() ? 0 : 1)}×'),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) replay.setPlaybackSpeed(value);
          },
        ),
      ),
    );
  }
}

class _CompareModeBanner extends StatelessWidget {
  const _CompareModeBanner({
    required this.compareDay,
    required this.similarityPercent,
    required this.loading,
    required this.primaryStats,
    required this.comparePoints,
  });

  final DateTime? compareDay;
  final int? similarityPercent;
  final bool loading;
  final JourneyStats primaryStats;
  final List<LocationHistoryPoint>? comparePoints;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    if (loading) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(GuardianRadius.medium),
          border: Border.all(color: colors.border),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(strokeWidth: 2, color: colors.accent),
            ),
            const SizedBox(width: 10),
            Text('Loading comparison…', style: TextStyle(fontSize: 12, color: colors.textSecondary)),
          ],
        ),
      );
    }

    if (compareDay == null || similarityPercent == null) return const SizedBox.shrink();

    final compareStats = comparePoints != null && comparePoints!.isNotEmpty
        ? buildJourneyStats(comparePoints!)
        : null;
    final narration = compareSimilarityNarration(similarityPercent!, compareDay!);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(GuardianRadius.medium),
        border: Border.all(color: colors.accent.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const GuardianAiIcon(size: 28),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  narration,
                  style: TextStyle(fontSize: 12, height: 1.35, color: colors.textSecondary),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _CompareStatColumn(
                  label: 'Selected',
                  distance: primaryStats.distanceKm,
                  duration: primaryStats.duration,
                  color: colors.accent,
                ),
              ),
              Container(width: 1, height: 36, color: colors.border),
              Expanded(
                child: _CompareStatColumn(
                  label: DateFormat.MMMd().format(compareDay!),
                  distance: compareStats?.distanceKm ?? 0,
                  duration: compareStats?.duration ?? Duration.zero,
                  color: const Color(0xFFFF6B6B),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: colors.accentMuted,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$similarityPercent%',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: colors.accent,
                    fontSize: 14,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CompareStatColumn extends StatelessWidget {
  const _CompareStatColumn({
    required this.label,
    required this.distance,
    required this.duration,
    required this.color,
  });

  final String label;
  final double distance;
  final Duration duration;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(fontSize: 10, color: colors.textMuted)),
          const SizedBox(height: 2),
          Text(
            '${distance.toStringAsFixed(1)} km',
            style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: color),
          ),
          Text(
            formatJourneyDuration(duration),
            style: TextStyle(fontSize: 10, color: colors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _JourneyTimelinePanel extends StatelessWidget {
  const _JourneyTimelinePanel({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    return GuardianCard(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Journey events',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 170,
            child: _JourneyTimeline(replay: replay),
          ),
        ],
      ),
    );
  }
}

class _JourneyTimeline extends StatelessWidget {
  const _JourneyTimeline({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final active = replay.activeEvent;

    return ListView.builder(
      itemCount: replay.events.length,
      itemBuilder: (context, index) {
        final event = replay.events[index];
        final isActive = active != null &&
            active.startIndex == event.startIndex &&
            active.endIndex == event.endIndex;
        return InkWell(
          onTap: () {
            replay.enterReplayMode();
            replay.seekToEvent(event);
          },
          borderRadius: BorderRadius.circular(8),
          child: Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    Text(
                      emojiForEventType(event.type),
                      style: const TextStyle(fontSize: 16),
                    ),
                    if (index < replay.events.length - 1)
                      Container(
                        width: 2,
                        height: 22,
                        color: colors.border,
                      ),
                  ],
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        event.label,
                        style: TextStyle(
                          fontWeight: isActive ? FontWeight.w700 : FontWeight.w600,
                          color: isActive ? colors.accent : colors.textPrimary,
                          fontSize: 13,
                        ),
                      ),
                      if (event.at != null)
                        Text(
                          DateFormat.Hm().format(event.at!),
                          style: TextStyle(fontSize: 10, color: colors.textMuted),
                        ),
                    ],
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

class _JourneyScoreCard extends StatelessWidget {
  const _JourneyScoreCard({
    required this.score,
    required this.quality,
  });

  final JourneyScoreBreakdown score;
  final JourneyQuality quality;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final overall = score.overall;

    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Text(
                'Journey Score',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              Text(
                '$overall',
                style: TextStyle(
                  fontSize: 28,
                  fontWeight: FontWeight.w800,
                  color: colors.accent,
                ),
              ),
              Text(
                '/100',
                style: TextStyle(fontSize: 12, color: colors.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            '${quality.fixesLabel} · ${quality.label}',
            style: TextStyle(fontSize: 11, color: colors.textSecondary),
          ),
          const SizedBox(height: 12),
          _ScoreBar(label: 'GPS Accuracy', value: score.gpsAccuracy),
          _ScoreBar(label: 'Route Consistency', value: score.routeConsistency),
          _ScoreBar(label: 'Safety', value: score.safety),
          _ScoreBar(label: 'Battery', value: score.battery),
        ],
      ),
    );
  }
}

class _ScoreBar extends StatelessWidget {
  const _ScoreBar({required this.label, required this.value});

  final String label;
  final int value;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          SizedBox(
            width: 110,
            child: Text(
              label,
              style: TextStyle(fontSize: 11, color: colors.textMuted),
            ),
          ),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: LinearProgressIndicator(
                value: value / 100,
                minHeight: 6,
                backgroundColor: colors.surfaceMuted,
                color: colors.accent,
              ),
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '$value',
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _JourneyHighlightsCard extends StatelessWidget {
  const _JourneyHighlightsCard({required this.highlights});

  final JourneyHighlights highlights;

  @override
  Widget build(BuildContext context) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            "Today's Highlights",
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 10),
          _HighlightRow(
            icon: Icons.pause_circle_outline,
            label: 'Longest stop',
            value: highlights.longestStop > Duration.zero
                ? formatJourneyDuration(highlights.longestStop)
                : 'None',
          ),
          _HighlightRow(
            icon: Icons.speed_rounded,
            label: 'Highest speed',
            value: highlights.highestSpeedKmh != null
                ? '${highlights.highestSpeedKmh!.toStringAsFixed(0)} km/h'
                : 'N/A',
          ),
          _HighlightRow(
            icon: Icons.directions_run_rounded,
            label: 'Moving time',
            value: formatJourneyDuration(highlights.totalMovingTime),
          ),
          _HighlightRow(
            icon: Icons.directions_walk_rounded,
            label: 'Walking time',
            value: formatJourneyDuration(highlights.walkingTime),
          ),
          _HighlightRow(
            icon: Icons.shield_outlined,
            label: 'Safe zones visited',
            value: '${highlights.safeZonesVisited}',
          ),
        ],
      ),
    );
  }
}

class _HighlightRow extends StatelessWidget {
  const _HighlightRow({
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
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        children: [
          Icon(icon, size: 16, color: colors.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: colors.textSecondary),
            ),
          ),
          Text(
            value,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

class _JourneyInsightsCard extends StatelessWidget {
  const _JourneyInsightsCard({required this.insights});

  final JourneyInsights insights;

  @override
  Widget build(BuildContext context) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const GuardianAiIcon(size: 32),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Guardian AI',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              _AiConfidenceBadge(insights: insights),
            ],
          ),
          const SizedBox(height: 12),
          _InsightRow(label: 'Route', value: insights.routeSummary),
          _InsightRow(
            label: 'Avg speed',
            value: insights.avgSpeedKmh != null
                ? '${insights.avgSpeedKmh!.toStringAsFixed(1)} km/h'
                : 'Unavailable',
          ),
          _InsightRow(label: 'GPS quality', value: insights.gpsQualityLabel),
        ],
      ),
    );
  }
}

class _AiConfidenceBadge extends StatelessWidget {
  const _AiConfidenceBadge({required this.insights});

  final JourneyInsights insights;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: colors.accentMuted,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: colors.accent.withValues(alpha: 0.25)),
      ),
      child: Text(
        insights.verified
            ? 'Confidence ${insights.confidenceScore}% · Verified'
            : 'Confidence ${insights.confidenceScore}%',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: colors.accent,
        ),
      ),
    );
  }
}

class _InsightRow extends StatelessWidget {
  const _InsightRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 88,
            child: Text(
              label,
              style: TextStyle(fontSize: 12, color: colors.textMuted),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _JourneyHealthFooter extends StatelessWidget {
  const _JourneyHealthFooter({required this.health});

  final JourneyHealth health;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(GuardianRadius.medium),
        border: Border.all(color: colors.border),
      ),
      child: Text(
        '${'★' * health.stars}${'☆' * (5 - health.stars)} ${health.summary}',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: colors.textSecondary,
        ),
        textAlign: TextAlign.center,
      ),
    );
  }
}

/// Back-compat export — dashboard imports may still reference the old name.
typedef RouteHistoryPage = JourneyPage;
