import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../dashboard/device_connectivity.dart';
import '../dashboard/dashboard_status_colors.dart';
import '../dashboard/dashboard_controller.dart';
import '../dashboard/dashboard_insight.dart';
import '../dashboard/dashboard_ai_interpretation.dart';
import '../dashboard/linking_story.dart';
import '../dashboard/device_formatters.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/dashboard/dodo_stage.dart';
import '../widgets/dashboard/family_device_strip.dart';
import '../widgets/dashboard/guardian_now_hero.dart';
import '../widgets/dashboard/around_them_panel.dart';
import '../widgets/dashboard/today_summary_panel.dart';
import '../widgets/dashboard/guardian_intelligence_panel.dart';
import '../widgets/dashboard/reconnecting_pulse.dart';
import '../widgets/guardian_widgets.dart';
import '../widgets/map/guardian_map_presentation.dart';
import '../widgets/map/person_map_marker.dart';
import 'journey_page.dart';

class MapDashboardPage extends StatefulWidget {
  const MapDashboardPage({super.key});

  @override
  State<MapDashboardPage> createState() => MapDashboardPageState();
}

class MapDashboardPageState extends State<MapDashboardPage> {
  GoogleMapController? _mapController;
  late final DashboardController _dashboard;
  bool _didFit = false;
  bool _sendingHelp = false;
  double _zoom = 13;
  Timer? _linkingTimer;
  int _linkingTick = 0;
  String? _linkingStoryImei;
  bool _linkingStoryFullyShown = false;
  bool _wasSelectedReconnecting = false;
  // ignore: unused_field
  Map<String, BitmapDescriptor> _markerIcons = const {};
  String _markerFingerprint = '';
  int _markerGeneration = 0;
  // ignore: unused_field
  String _cachedCirclesKey = '';
  String _geofenceFingerprint = '';
  int _lastGeofenceCount = 0;
  final ValueNotifier<int> _mapCameraGeneration = ValueNotifier(0);

  List<Device> get _devices => _dashboard.devices;
  List<Geofence> get _geofences => _dashboard.geofences;
  String? get _selectedImei => _dashboard.selectedImei;

  bool _isLive(Device device) => _dashboard.isLive(device);

  @override
  void initState() {
    super.initState();
    _dashboard = DashboardController()
      ..addListener(_onDashboardChanged)
      ..start();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _syncLinkingAnimation();
    });
  }

  void _onDashboardChanged() {
    if (!mounted) return;
    final selected = _selected;
    final reconnecting = selected?.isReconnecting ?? false;
    if (reconnecting &&
        (!_wasSelectedReconnecting || _linkingStoryImei != selected?.imei)) {
      _linkingStoryImei = selected?.imei;
      _linkingStoryFullyShown = false;
    }
    _wasSelectedReconnecting = reconnecting;
    setState(() {});
    _syncLinkingAnimation();
    unawaited(_refreshMarkerIcons());
    _fitIfNeeded(_devices);
    _fitGeofencesIfNeeded();
    _followSelected(_devices);
  }

  void _syncLinkingAnimation() {
    final linking = _selected?.isReconnecting ?? false;
    if (linking && _linkingTimer == null) {
      _linkingTimer = Timer.periodic(linkingMessageHold, (_) {
        if (!mounted) return;
        setState(() => _linkingTick++);
      });
    } else if (!linking) {
      _linkingTimer?.cancel();
      _linkingTimer = null;
      if (_linkingTick != 0) {
        _linkingTick = 0;
      }
    }
  }

  List<Geofence> get _mapGeofences {
    final imei = _selectedImei;
    final active = _geofences.where((zone) {
      if (!zone.active) return false;
      if (zone.lat == 0 && zone.lng == 0) return false;
      if (imei == null) return true;
      return zone.imei == imei;
    });
    return active.toList();
  }

  String _geofencesFingerprint(List<Geofence> zones) {
    return zones
        .map(
          (zone) =>
              '${zone.id}|${zone.imei}|${zone.lat}|${zone.lng}|${zone.radiusMeters}',
        )
        .join('||');
  }

  double _zoomForGeofenceRadius(double radiusMeters, double lat) {
    final cosLat = math.cos(lat * math.pi / 180).abs().clamp(0.01, 1.0);
    final metersPerPixelTarget = radiusMeters / 55;
    final zoom = math.log(156543 * cosLat / metersPerPixelTarget) / math.ln2;
    return zoom.clamp(13.0, 18.0);
  }

  void _fitGeofencesIfNeeded() {
    final zones = _mapGeofences;
    final fingerprint = _geofencesFingerprint(zones);
    if (fingerprint == _geofenceFingerprint) return;

    final isNewZone = zones.length > _lastGeofenceCount;
    _geofenceFingerprint = fingerprint;
    _lastGeofenceCount = zones.length;
    _cachedCirclesKey = '';

    if (zones.isEmpty || _mapController == null) return;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || _mapController == null) return;
      try {
        if (zones.length == 1 && isNewZone) {
          final zone = zones.first;
          final zoom = _zoomForGeofenceRadius(zone.radiusMeters, zone.lat);
          await _animateTo(LatLng(zone.lat, zone.lng), zoom: zoom);
          return;
        }

        var minLat = zones.first.lat;
        var maxLat = zones.first.lat;
        var minLng = zones.first.lng;
        var maxLng = zones.first.lng;
        for (final zone in zones) {
          final latPad = zone.radiusMeters / 111000;
          final lngPad =
              zone.radiusMeters / (111000 * math.cos(zone.lat * math.pi / 180));
          minLat = math.min(minLat, zone.lat - latPad);
          maxLat = math.max(maxLat, zone.lat + latPad);
          minLng = math.min(minLng, zone.lng - lngPad);
          maxLng = math.max(maxLng, zone.lng + lngPad);
        }
        for (final device in _devices) {
          if (!device.hasFreshLocation) continue;
          final loc = device.location!;
          minLat = math.min(minLat, loc.lat);
          maxLat = math.max(maxLat, loc.lat);
          minLng = math.min(minLng, loc.lng);
          maxLng = math.max(maxLng, loc.lng);
        }
        _mapCameraGeneration.value++;
        await _mapController!.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(
              southwest: LatLng(minLat, minLng),
              northeast: LatLng(maxLat, maxLng),
            ),
            56,
          ),
        );
        _mapCameraGeneration.value++;
      } catch (_) {}
    });
  }

  Future<void> _refreshMarkerIcons() async {
    final fingerprint = _devices
        .map(
          (device) =>
              '${device.imei}|${device.displayName}|${device.avatarUrl ?? ''}'
              '|${device.imei == _selectedImei}',
        )
        .join('||');
    if (fingerprint == _markerFingerprint) return;
    _markerFingerprint = fingerprint;

    if (kIsWeb) {
      if (mounted) setState(() => _markerIcons = const {});
      return;
    }

    final generation = ++_markerGeneration;
    final surfaceColor = context.guardianColors.surface;

    late final List<MapEntry<String, BitmapDescriptor>> entries;
    try {
      entries = await Future.wait(
        _devices.map((device) async {
          final icon = await PersonMapMarker.create(
            initials: initialsFor(device.displayName),
            color: avatarColorForKey(device.imei),
            selected: device.imei == _selectedImei,
            surfaceColor: surfaceColor,
            imageUrl: device.avatarUrl,
          );
          return MapEntry(device.imei, icon);
        }),
      );
    } catch (_) {
      return;
    }
    if (!mounted || generation != _markerGeneration) return;
    setState(() => _markerIcons = Map.fromEntries(entries));
  }

  Future<void> _animateTo(LatLng target, {double? zoom}) async {
    final controller = _mapController;
    if (controller == null) return;
    final z = zoom ?? _zoom;
    // google_maps_flutter_web doesn't reliably fire onCameraMove/onCameraIdle
    // for a programmatic animateCamera the way it does for user gestures, so
    // the avatar overlay's other markers were left stuck at their pre-move
    // screen position for the whole animation -- looking like they'd
    // vanished until the map's own idle callback eventually caught up.
    // Bumping the generation directly around the animation keeps the
    // overlay in sync without waiting on that callback.
    _mapCameraGeneration.value++;
    await controller.animateCamera(CameraUpdate.newLatLngZoom(target, z));
    _zoom = z;
    _mapCameraGeneration.value++;
  }

  void _fitIfNeeded(List<Device> devices) {
    if (_didFit) return;
    final points = devices
        .where((d) => d.hasFreshLocation)
        .map((d) => LatLng(d.location!.lat, d.location!.lng))
        .toList();
    if (points.isEmpty) return;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted || _didFit || _mapController == null) return;
      try {
        if (points.length == 1) {
          await _animateTo(points.first, zoom: 14);
        } else {
          double minLat = points.first.latitude;
          double maxLat = points.first.latitude;
          double minLng = points.first.longitude;
          double maxLng = points.first.longitude;
          for (final p in points) {
            minLat = minLat < p.latitude ? minLat : p.latitude;
            maxLat = maxLat > p.latitude ? maxLat : p.latitude;
            minLng = minLng < p.longitude ? minLng : p.longitude;
            maxLng = maxLng > p.longitude ? maxLng : p.longitude;
          }
          _mapCameraGeneration.value++;
          await _mapController!.animateCamera(
            CameraUpdate.newLatLngBounds(
              LatLngBounds(
                southwest: LatLng(minLat, minLng),
                northeast: LatLng(maxLat, maxLng),
              ),
              48,
            ),
          );
          _mapCameraGeneration.value++;
        }
        _didFit = true;
      } catch (_) {}
    });
  }

  void _followSelected(List<Device> devices) {
    if (!_didFit || _selectedImei == null) return;
    Device? selected;
    for (final d in devices) {
      if (d.imei == _selectedImei) {
        selected = d;
        break;
      }
    }
    if (selected == null || !selected.hasFreshLocation) return;
    final loc = selected.location!;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _animateTo(LatLng(loc.lat, loc.lng));
    });
  }

  @override
  void dispose() {
    _linkingTimer?.cancel();
    _mapCameraGeneration.dispose();
    _dashboard
      ..removeListener(_onDashboardChanged)
      ..dispose();
    // google_maps_flutter_web manages controller lifetime; manual dispose
    // during rebuild races with in-flight marker/circle updates on web.
    if (!kIsWeb) {
      _mapController?.dispose();
    }
    super.dispose();
  }

  void sendHelpFromNavigation() {
    final device = _selected;
    if (device == null) {
      _showUnavailable('No watch is available for an SOS alert.');
      return;
    }
    if (_sendingHelp) return;
    unawaited(_sendHelp(device));
  }

  Device? get _selected {
    return _dashboard.selected;
  }

  Future<void> _sendHelp(Device device) async {
    setState(() => _sendingHelp = true);
    try {
      await AlertService().sendHelpAlert(
        imei: device.imei,
        deviceName: device.displayName,
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Help alert sent')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not send alert: $e')));
      }
    } finally {
      if (mounted) {
        setState(() => _sendingHelp = false);
      }
    }
  }

  Future<void> _callDevice(Device device) async {
    final sim = device.simNumber?.trim();
    if (sim == null || sim.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            "No SIM number on file — add it in the pendant's settings first.",
          ),
        ),
      );
      return;
    }
    final uri = Uri(scheme: 'tel', path: sim);
    if (!await launchUrl(uri)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not start a call to $sim')),
        );
      }
    }
  }

  void _openHistory(Device device) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => JourneyPage(
          imei: device.imei,
          deviceName: device.displayName,
          avatarUrl: device.avatarUrl,
        ),
      ),
    );
  }

  void _showUnavailable(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _markLinkingStoryFullyShown() {
    if (!mounted || _linkingStoryFullyShown) return;
    setState(() => _linkingStoryFullyShown = true);
  }

  Widget _buildDashboardContent(Device? selected) {
    final aiInterpretation = buildGuardianAiInterpretation(selected);
    final todayText = buildTodaySummary(selected);
    final activityStatus = buildTodayActivityStatus(selected);
    final weatherStatus = buildWeatherStatus(selected);
    final localContext = buildLocalContextStatus(selected);
    final activities = buildGuardianActivities(selected);

    return Column(
      children: [
        GuardianNowHero(
          device: selected,
          aiInterpretation: aiInterpretation,
          onCall: selected != null ? () => _callDevice(selected) : null,
          onViewLocation: selected != null ? () => {} : null,
          onAskGuardian: selected != null ? () => {} : null,
        ),
        if (_devices.length > 1) ...[
          const SizedBox(height: 18),
          FamilyDeviceStrip(
            devices: _devices,
            selectedImei: _selectedImei,
            onSelect: (imei) => setState(() => _dashboard.select(imei)),
          ),
        ],
        const SizedBox(height: 18),
        // Large prominent map card
        if (selected != null)
          Container(
            height: 320,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.2),
                width: 1,
              ),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(16),
              child: Stack(
                children: [
                  _StableGoogleMap(
                    initialCameraPosition: const CameraPosition(
                      target: LatLng(-20.2642, 57.4791),
                      zoom: 13,
                    ),
                    markers: const {},
                    circles: const {},
                    mapType: MapType.normal,
                    zoomControlsEnabled: true,
                    onMapCreated: (controller) {
                      _mapController = controller;
                    },
                    onCameraMove: (position) {},
                    onCameraIdle: () {},
                  ),
                  Positioned(
                    bottom: 16,
                    left: 16,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        color: Colors.white,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.1),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.location_on,
                            size: 16,
                            color: GuardianColors.accent,
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Live',
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          Container(
            height: 320,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              color: context.guardianColors.surface,
              border: Border.all(
                color: Colors.white.withValues(alpha: 0.2),
                width: 1,
              ),
            ),
            child: Center(
              child: Text(
                'Link a watch to see the map',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
          ),
        const SizedBox(height: 18),
        AroundThemPanel(
          device: selected,
          geofences: _geofences,
          weatherStatus: weatherStatus,
          localContext: localContext,
          guardianIntelligence: aiInterpretation,
        ),
        const SizedBox(height: 18),
        TodaySummaryPanel(
          device: selected,
          dailySummary: todayText,
          activityStatus: activityStatus,
          onViewJourney: selected != null ? () => _openHistory(selected) : null,
        ),
        const SizedBox(height: 18),
        GuardianIntelligencePanel(device: selected, activities: activities),
        const SizedBox(height: 24),
      ],
    );
  }


  @override
  Widget build(BuildContext context) {
    final selected = _selected;

    final insight = buildDashboardInsightForDevice(
      selected,
      linkingTick: _linkingTick,
    );
    final showLinkingStory =
        selected != null &&
        (selected.isReconnecting ||
            (_isLive(selected) &&
                _linkingStoryImei == selected.imei &&
                !_linkingStoryFullyShown));
    final visibleLinkingStep = selected?.isReconnecting == true
        ? linkingStoryStep(selected!)
        : linkingDodoStageScenes.length - 1;

    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: Stack(
        children: [
          const Positioned(
            top: -90,
            right: -70,
            child: _AmbientGlow(size: 300, color: Color(0x2E4AC99B)),
          ),
          const Positioned(
            top: 310,
            left: -100,
            child: _AmbientGlow(size: 260, color: Color(0x1FE8B765)),
          ),
          Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1180),
              child: CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(18, 24, 18, 118),
                    sliver: SliverList.list(
                      children: [
                        if (showLinkingStory)
                          _LinkingPrototype(
                            // ignore: unnecessary_non_null_assertion
                            device: selected!,
                            insight: insight,
                            tick: _linkingTick,
                            linkingStep: visibleLinkingStep,
                            onSequenceShown: _markLinkingStoryFullyShown,
                          )
                        else
                          _buildDashboardContent(selected),
                        // REMOVED: Old map + _PrototypeHomePanels duplicate widgets
                      ],
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

class _AmbientGlow extends StatelessWidget {
  const _AmbientGlow({required this.size, required this.color});

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context) => IgnorePointer(
    child: Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [color, color.withValues(alpha: 0)]),
      ),
    ),
  );
}

class _PrototypeCareCard extends StatelessWidget {
  const _PrototypeCareCard({
    required this.device,
    required this.insight,
    required this.linkingTick,
    this.linkingStep,
  });

  final Device? device;
  final DashboardInsight insight;
  final int linkingTick;

  /// Non-null while the watch is still linking up -- keeps this same
  /// compact card in place and just cycles the Dodo stage through its
  /// connection-process poses instead of swapping to a separate,
  /// bigger "Linking up…" layout.
  final int? linkingStep;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: colors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.09),
            blurRadius: 42,
            offset: const Offset(0, 16),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wide = useDodoDesktopHeroLayout(constraints.maxWidth);
          final summary = _CarePersonSummary(device: device);
          final comms = _DodoStagePlaceholder(
            device: device,
            insight: insight,
            linking: linkingStep != null,
            linkingStep: linkingStep,
          );
          final metrics = _LiveStatusBar(
            device: device,
            linkingTick: linkingTick,
            linkingStep: linkingStep,
          );

          if (!wide) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                summary,
                const SizedBox(height: 18),
                comms,
                const SizedBox(height: 14),
                metrics,
              ],
            );
          }

          return SizedBox(
            height: dodoDesktopHeroHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(flex: dodoDesktopStageFlex, child: comms),
                const SizedBox(width: 18),
                Expanded(
                  flex: dodoDesktopStatusFlex,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.all(18),
                          decoration: BoxDecoration(
                            color: colors.glass,
                            borderRadius: BorderRadius.circular(22),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.8),
                            ),
                          ),
                          child: summary,
                        ),
                      ),
                      const SizedBox(height: 14),
                      SizedBox(height: 108, child: metrics),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _CarePersonSummary extends StatelessWidget {
  const _CarePersonSummary({required this.device});

  final Device? device;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final name = device?.displayName ?? 'Someone you care for';
    final relationship = device?.relationshipLabel ?? 'No watch linked';
    final live = device?.connectivityPhase() == DeviceConnectivityPhase.live;
    final status = device == null
        ? 'Waiting'
        : device!.isReconnecting
        ? 'Linking'
        : live
        ? 'Live'
        : 'Offline';
    final statusColor = live ? GuardianColors.safe : GuardianColors.warning;
    final statusBackground = live
        ? GuardianColors.safeBg
        : GuardianColors.warningBg;

    return LayoutBuilder(
      builder: (context, constraints) {
        final horizontal = constraints.maxWidth >= 320;
        final avatar = AvatarBubble(
          initials: initialsFor(name),
          color: GuardianColors.safe,
          size: 76,
          imageUrl: device?.avatarUrl,
        );
        final copy = Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: horizontal
              ? CrossAxisAlignment.start
              : CrossAxisAlignment.center,
          children: [
            Text(
              'YOU’RE CARING FOR',
              style: TextStyle(
                color: colors.textMuted,
                fontSize: 9,
                fontWeight: FontWeight.w900,
                letterSpacing: 1.25,
              ),
            ),
            const SizedBox(height: 7),
            Text(
              name,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: horizontal ? TextAlign.left : TextAlign.center,
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 25,
                height: 1.08,
                fontWeight: FontWeight.w500,
                letterSpacing: -0.8,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              relationship,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 9),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
              decoration: BoxDecoration(
                color: statusBackground,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                status,
                style: TextStyle(
                  color: statusColor,
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              device == null
                  ? 'Connect a watch to begin'
                  : deviceUpdatedLabel(device!),
              style: TextStyle(color: colors.textMuted, fontSize: 10),
            ),
          ],
        );

        if (horizontal) {
          return Row(
            children: [
              avatar,
              const SizedBox(width: 15),
              Expanded(child: copy),
            ],
          );
        }
        return Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [avatar, const SizedBox(height: 14), copy],
        );
      },
    );
  }
}

class _DodoStagePlaceholder extends StatelessWidget {
  const _DodoStagePlaceholder({
    required this.device,
    required this.insight,
    this.linking = false,
    this.linkingStep,
  });

  final Device? device;
  final DashboardInsight insight;
  final bool linking;
  final int? linkingStep;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final offline =
        device != null &&
        device!.connectivityPhase() == DeviceConnectivityPhase.offline;
    final stageMode = linking
        ? DodoStageMode.linking
        : offline
        ? DodoStageMode.offline
        : DodoStageMode.active;

    return Container(
      key: const ValueKey('guardian-dodo-stage'),
      constraints: const BoxConstraints(minHeight: dodoCompactStageHeight),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: GuardianColors.ivory,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: GuardianColors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.04),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final wideScene = useDodoWideSceneLayout(constraints.maxWidth);
          final split = constraints.maxWidth >= 430;
          final stage = _DodoVisualStage(
            mode: stageMode,
            linkingStep: linking && device != null
                ? (linkingStep ?? linkingStoryStep(device!)).clamp(
                    0,
                    linkingDodoStageScenes.length - 1,
                  )
                : null,
          );
          final copy = Padding(
            padding: const EdgeInsets.fromLTRB(20, 22, 20, 20),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Row(
                  children: [
                    Icon(
                      Icons.auto_awesome_rounded,
                      size: 14,
                      color: GuardianColors.safe,
                    ),
                    SizedBox(width: 6),
                    Text(
                      'GUARDIAN COMMS',
                      style: TextStyle(
                        color: GuardianColors.safe,
                        fontSize: 8,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 1.1,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  linking
                      ? 'I’m making secure contact.'
                      : offline
                      ? 'I’m keeping every channel open.'
                      : 'I’ve got every channel covered.',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 18,
                    height: 1.15,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.4,
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  linking
                      ? insight.detail
                      : 'Watch updates, Claude-backed AI checks, WhatsApp, and your family circle stay in one calm flow.',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 11,
                    height: 1.55,
                  ),
                ),
              ],
            ),
          );

          if (wideScene) {
            return SizedBox(height: dodoDesktopHeroHeight, child: stage);
          }

          if (split) {
            return SizedBox(
              height: dodoCompactStageHeight,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Expanded(flex: 11, child: stage),
                  Expanded(flex: 10, child: copy),
                ],
              ),
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(height: dodoCompactStageHeight, child: stage),
              copy,
            ],
          );
        },
      ),
    );
  }
}

class _DodoVisualStage extends StatelessWidget {
  const _DodoVisualStage({required this.mode, this.linkingStep});

  final DodoStageMode mode;
  final int? linkingStep;

  @override
  Widget build(BuildContext context) {
    final reduceMotion =
        MediaQuery.maybeOf(context)?.disableAnimations ?? false;
    final linking = mode == DodoStageMode.linking;
    final visibleLinkingStep = (linkingStep ?? 0).clamp(
      0,
      linkingDodoStageScenes.length - 1,
    );
    final scene = linking
        ? dodoStageSceneForLinkingStep(visibleLinkingStep)
        : dodoStageSceneForMode(mode);
    return Stack(
      fit: StackFit.expand,
      children: [
        Align(
          alignment: Alignment.bottomRight,
          child: FractionallySizedBox(
            widthFactor: 0.62,
            heightFactor: 0.95,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: Alignment.bottomRight,
                  colors: [
                    GuardianColors.flagGreenBg.withValues(alpha: 0.55),
                    GuardianColors.flagBlueBg.withValues(alpha: 0.22),
                    Colors.transparent,
                  ],
                  stops: const [0.0, 0.52, 1.0],
                ),
              ),
            ),
          ),
        ),
        Align(
          alignment: Alignment.bottomRight,
          child: FractionallySizedBox(
            widthFactor: 0.48,
            heightFactor: 0.92,
            child: AnimatedSwitcher(
              duration: reduceMotion
                  ? Duration.zero
                  : const Duration(milliseconds: 450),
              switchInCurve: Curves.easeOutCubic,
              switchOutCurve: Curves.easeInCubic,
              child: linking && visibleLinkingStep == 3
                  ? Image.asset(
                      'assets/images/dodo_ai_guardian.png',
                      key: const ValueKey('dodo-ai-guardian'),
                      fit: BoxFit.contain,
                    )
                  : GuardianDodoStageImage(
                      key: ValueKey(scene.action),
                      action: scene.action,
                    ),
            ),
          ),
        ),
        Positioned(
          left: 15,
          top: 14,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.92),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: GuardianColors.safe.withValues(alpha: 0.18),
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                    color: GuardianColors.safe,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  linking
                      ? 'STEP ${visibleLinkingStep + 1}  ·  ${scene.action.shortLabel}'
                      : mode == DodoStageMode.active
                      ? 'LIVE'
                      : 'LISTENING',
                  style: const TextStyle(
                    color: GuardianColors.forest,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (linking)
          Positioned(
            right: 16,
            top: 20,
            child: Row(
              children: [
                for (var i = 0; i < linkingDodoStageScenes.length; i++) ...[
                  AnimatedContainer(
                    duration: reduceMotion
                        ? Duration.zero
                        : const Duration(milliseconds: 300),
                    width: i == visibleLinkingStep ? 18 : 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: i <= visibleLinkingStep
                          ? GuardianColors.safe
                          : GuardianColors.safe.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(999),
                    ),
                  ),
                  if (i < linkingDodoStageScenes.length - 1)
                    const SizedBox(width: 5),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _LinkingPrototype extends StatefulWidget {
  const _LinkingPrototype({
    required this.device,
    required this.insight,
    required this.tick,
    required this.linkingStep,
    this.onSequenceShown,
  });

  final Device device;
  final DashboardInsight insight;
  final int tick;
  final int linkingStep;
  final VoidCallback? onSequenceShown;

  @override
  State<_LinkingPrototype> createState() => _LinkingPrototypeState();
}

class _LinkingPrototypeState extends State<_LinkingPrototype> {
  Timer? _stepTimer;
  int _visibleStep = 0;
  int _targetStep = 0;
  DateTime _visibleSince = DateTime.now();
  bool _didReportSequence = false;

  int get _clampedTarget =>
      widget.linkingStep.clamp(0, linkingDodoStageScenes.length - 1);

  @override
  void initState() {
    super.initState();
    _targetStep = _clampedTarget;
    _scheduleNext();
  }

  @override
  void didUpdateWidget(covariant _LinkingPrototype oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextTarget = _clampedTarget;
    if (nextTarget < _visibleStep) {
      _stepTimer?.cancel();
      _stepTimer = null;
      _visibleStep = 0;
      _visibleSince = DateTime.now();
      _didReportSequence = false;
    }
    _targetStep = nextTarget;
    _scheduleNext();
  }

  void _scheduleNext() {
    if (_stepTimer != null) return;

    final shownFor = DateTime.now().difference(_visibleSince);
    final remaining = shownFor >= dodoLinkingStepMinimumHold
        ? Duration.zero
        : dodoLinkingStepMinimumHold - shownFor;

    if (_visibleStep >= _targetStep) {
      final finalStep = linkingDodoStageScenes.length - 1;
      if (_targetStep != finalStep || _didReportSequence) return;
      _stepTimer = Timer(remaining, () {
        _stepTimer = null;
        if (!mounted || _didReportSequence) return;
        _didReportSequence = true;
        widget.onSequenceShown?.call();
      });
      return;
    }

    _stepTimer = Timer(remaining, () {
      _stepTimer = null;
      if (!mounted) return;
      if (_visibleStep < _targetStep) {
        setState(() {
          _visibleStep++;
          _visibleSince = DateTime.now();
        });
      }
      _scheduleNext();
    });
  }

  @override
  void dispose() {
    _stepTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Same compact card the live dashboard uses -- just with the Dodo
    // stage cycling through connection-process poses (pendant awake,
    // network, location, battery, then live) instead of a separate,
    // bigger "Linking up…" layout with its own header and step cards.
    return _PrototypeCareCard(
      device: widget.device,
      insight: widget.insight,
      linkingTick: widget.tick,
      linkingStep: _visibleStep,
    );
  }
}

class _LiveStatusBar extends StatelessWidget {
  const _LiveStatusBar({
    required this.device,
    this.linkingTick = 0,
    this.linkingStep,
  });

  final Device? device;
  final int linkingTick;

  /// The Dodo stage's current paced step (0-3). When set, each metric's
  /// complete/active/pending visual state follows this same narrative
  /// pace instead of the metric's own real-data readiness -- otherwise a
  /// fast network/location/battery reading can turn every card green
  /// while the Dodo is still only midway through telling the story.
  final int? linkingStep;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final selected = device;
    final phase =
        selected?.connectivityPhase() ?? DeviceConnectivityPhase.offline;
    final reconnecting = phase == DeviceConnectivityPhase.reconnecting;

    if (reconnecting && selected != null) {
      final story = linkingStoryMetrics(selected, tick: linkingTick);
      // linkingStoryMetrics returns steps in this exact order (pendant,
      // network, location, Guardian AI) -- matching titles, not the
      // unrelated Pendant/Location/Battery/Network column order the live
      // status bar uses once connected.
      const stepTitles = ['Watch', 'Network', 'Location', 'Guardian AI'];
      const stepMetrics = [
        DashboardFlagMetric.connectivity,
        DashboardFlagMetric.signal,
        DashboardFlagMetric.gps,
        DashboardFlagMetric.battery,
      ];
      final pacedStep = linkingStep;
      LinkingStoryMetricState stateFor(int i) {
        if (pacedStep == null) return story[i].state;
        if (i < pacedStep) return LinkingStoryMetricState.complete;
        if (i == pacedStep) return LinkingStoryMetricState.active;
        return LinkingStoryMetricState.pending;
      }

      final metricWidgets = [
        for (var i = 0; i < story.length; i++)
          _LiveMetric(
            metric: stepMetrics[i],
            icon: story[i].icon,
            title: stepTitles[i],
            label: story[i].label,
            active: stateFor(i) == LinkingStoryMetricState.complete,
            colorsOverride: linkingStoryMetricColors(stateFor(i)),
            showPulse: stateFor(i) == LinkingStoryMetricState.active,
          ),
      ];
      return AnimatedSwitcher(
        duration: const Duration(milliseconds: 350),
        child: Container(
          key: const ValueKey('linking-story-metrics'),
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: colors.glass,
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: Colors.white.withValues(alpha: 0.75)),
            boxShadow: [
              BoxShadow(
                color: colors.textPrimary.withValues(alpha: 0.055),
                blurRadius: 22,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: _MetricLayout(children: metricWidgets),
        ),
      );
    }

    final connected = phase == DeviceConnectivityPhase.live;
    final gps = selected?.hasFreshLocation == true;
    final approximate = selected?.hasApproximateLocation == true;
    final battery = selected?.batteryPercent;
    final batteryHealthy = dashboardBatteryHealthy(battery);
    final connectivityColors = selected == null
        ? flagMetricColors(DashboardFlagMetric.connectivity, false)
        : connectivityMetricColors(selected);
    final signalColors = flagMetricColors(
      DashboardFlagMetric.signal,
      connected,
    );
    final metricWidgets = [
      _LiveMetric(
        metric: DashboardFlagMetric.connectivity,
        icon: Icons.sensors_rounded,
        title: 'Watch',
        label: selected == null ? 'Offline' : deviceConnectivityLabel(selected),
        active: connected,
        colorsOverride: connectivityColors,
      ),
      _LiveMetric(
        metric: DashboardFlagMetric.gps,
        icon: Icons.gps_fixed_rounded,
        title: 'Location',
        label: approximate
            ? 'Approximate'
            : (gps ? 'GPS active' : 'GPS waiting'),
        active: gps,
      ),
      _LiveMetric(
        metric: DashboardFlagMetric.battery,
        icon: Icons.battery_5_bar_rounded,
        title: 'Battery',
        label: battery == null ? 'Battery —' : '$battery%',
        active: batteryHealthy,
      ),
      _LiveMetric(
        metric: DashboardFlagMetric.signal,
        icon: Icons.signal_cellular_alt_rounded,
        title: 'Network',
        label: selected == null ? 'No signal' : deviceSignalLabel(selected),
        active: connected,
        colorsOverride: signalColors,
      ),
    ];
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 350),
      child: Container(
        key: const ValueKey('live-metrics'),
        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 7),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: colors.glass,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: Colors.white.withValues(alpha: 0.75)),
          boxShadow: [
            BoxShadow(
              color: colors.textPrimary.withValues(alpha: 0.055),
              blurRadius: 22,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: _MetricLayout(children: metricWidgets),
      ),
    );
  }
}

class _MetricLayout extends StatelessWidget {
  const _MetricLayout({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= 320) {
          return Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [for (final child in children) Expanded(child: child)],
          );
        }
        return GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          primary: false,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 6,
          crossAxisSpacing: 2,
          childAspectRatio: 1.25,
          children: children,
        );
      },
    );
  }
}

class _LiveMetric extends StatelessWidget {
  const _LiveMetric({
    required this.metric,
    required this.icon,
    required this.title,
    required this.label,
    required this.active,
    this.colorsOverride,
    this.showPulse = false,
  });

  final DashboardFlagMetric metric;
  final IconData icon;
  final String title;
  final String label;
  final bool active;
  final FlagMetricColors? colorsOverride;
  final bool showPulse;

  @override
  Widget build(BuildContext context) {
    // Always prefer flag stripe colors for the metric; only linking story
    // may override (progress states), never connectivity red on signal green.
    final colors = colorsOverride ?? flagMetricColors(metric, active);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 3),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 9),
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [
              colors.background,
              colors.background.withValues(alpha: 0.68),
            ],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: colors.foreground.withValues(alpha: 0.08)),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (showPulse)
              ReconnectingPulse(size: 4, iconSize: 14, color: colors.foreground)
            else
              Icon(icon, size: 15, color: colors.foreground),
            const SizedBox(height: 5),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 8.5,
                fontWeight: FontWeight.w600,
                color: context.guardianColors.textMuted,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 9.2,
                fontWeight: FontWeight.w800,
                height: 1.1,
                color: colors.foreground,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Skips [GoogleMap] rebuilds when only unrelated ancestors (e.g. theme)
/// change. google_maps_flutter_web throws if marker/circle updates race with
/// controller teardown during rebuild.
class _StableGoogleMap extends StatefulWidget {
  const _StableGoogleMap({
    required this.initialCameraPosition,
    required this.markers,
    required this.circles,
    required this.mapType,
    required this.zoomControlsEnabled,
    required this.onMapCreated,
    required this.onCameraMove,
    required this.onCameraIdle,
  });

  final CameraPosition initialCameraPosition;
  final Set<Marker> markers;
  final Set<Circle> circles;
  final MapType mapType;
  final bool zoomControlsEnabled;
  final ValueChanged<GoogleMapController> onMapCreated;
  final ValueChanged<CameraPosition> onCameraMove;
  final VoidCallback onCameraIdle;

  @override
  State<_StableGoogleMap> createState() => _StableGoogleMapState();
}

class _StableGoogleMapState extends State<_StableGoogleMap> {
  late Widget _map;
  late Object _mapKey;

  @override
  void initState() {
    super.initState();
    _mapKey = _propsKey(widget);
    _map = _buildMap(widget);
  }

  @override
  void didUpdateWidget(covariant _StableGoogleMap oldWidget) {
    super.didUpdateWidget(oldWidget);
    final nextKey = _propsKey(widget);
    if (nextKey == _mapKey) return;
    _mapKey = nextKey;
    setState(() => _map = _buildMap(widget));
  }

  Object _propsKey(_StableGoogleMap config) {
    final circleKey = config.circles
        .map(
          (circle) =>
              '${circle.circleId.value}|${circle.center.latitude}|'
              '${circle.center.longitude}|${circle.radius}',
        )
        .join(';');
    final markerKey = config.markers.map((m) => m.markerId.value).join(';');
    return Object.hash(
      markerKey,
      circleKey,
      config.zoomControlsEnabled,
      config.mapType,
    );
  }

  Widget _buildMap(_StableGoogleMap config) {
    final circleKey = config.circles.map((c) => c.circleId.value).join('-');
    return GoogleMap(
      key: ValueKey('dashboard-map-$circleKey-${config.markers.length}'),
      initialCameraPosition: config.initialCameraPosition,
      markers: config.markers,
      circles: config.circles,
      mapType: config.mapType,
      // The custom style (roads/water recoloured for a calmer look) only
      // applies to the normal map type -- satellite/hybrid imagery ignores
      // it, so there is nothing to turn off when switching views.
      style: config.mapType == MapType.normal
          ? GuardianMapPresentation.style
          : null,
      myLocationButtonEnabled: false,
      // Home shows watch locations only. Guardian Eye will be introduced
      // later as a separate experience, not as a persistent guardian marker.
      myLocationEnabled: false,
      // Google enables a large arrow/zoom camera pad on web by default.
      // Guardian supplies a smaller pendant-focused control rail instead.
      webCameraControlEnabled: false,
      zoomControlsEnabled: config.zoomControlsEnabled,
      mapToolbarEnabled: false,
      compassEnabled: false,
      indoorViewEnabled: false,
      trafficEnabled: false,
      buildingsEnabled: false,
      onMapCreated: config.onMapCreated,
      onCameraMove: config.onCameraMove,
      onCameraIdle: config.onCameraIdle,
    );
  }

  @override
  Widget build(BuildContext context) => _map;
}
