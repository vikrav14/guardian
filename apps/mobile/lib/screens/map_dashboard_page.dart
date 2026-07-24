import 'dart:async';
import 'dart:math' as math;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../dashboard/device_connectivity.dart';
import '../dashboard/dashboard_status_colors.dart';
import '../dashboard/dashboard_controller.dart';
import '../dashboard/dashboard_insight.dart';
import '../dashboard/linking_story.dart';
import '../dashboard/device_formatters.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/dashboard/reconnecting_pulse.dart';
import '../widgets/guardian_widgets.dart';
import '../widgets/map/map_avatar_overlay.dart';
import '../widgets/map/map_my_location_avatar_button.dart';
import '../widgets/map/person_map_marker.dart';
import 'journey_page.dart';

class MapDashboardPage extends StatefulWidget {
  const MapDashboardPage({super.key});

  @override
  State<MapDashboardPage> createState() => _MapDashboardPageState();
}

class _MapDashboardPageState extends State<MapDashboardPage> {
  GoogleMapController? _mapController;
  late final DashboardController _dashboard;
  bool _didFit = false;
  bool _sendingHelp = false;
  bool _myLocationEnabled = false;
  double _zoom = 13;
  Timer? _emergencyHoldTimer;
  Timer? _linkingTimer;
  int _linkingTick = 0;
  int _emergencyHoldTenths = 0;
  Map<String, BitmapDescriptor> _markerIcons = const {};
  String _markerFingerprint = '';
  int _markerGeneration = 0;
  Set<Circle> _cachedCircles = const {};
  String _cachedCirclesKey = '';
  String _geofenceFingerprint = '';
  int _lastGeofenceCount = 0;
  final ValueNotifier<int> _mapCameraGeneration = ValueNotifier(0);

  static const _mauritius = LatLng(-20.2642, 57.4791);

  List<Device> get _devices => _dashboard.devices;
  List<Geofence> get _geofences => _dashboard.geofences;
  String? get _selectedImei => _dashboard.selectedImei;
  String? get _error => _dashboard.error?.toString();
  bool get _loading => _dashboard.loading;

  bool _isReconnecting(Device device) => _dashboard.isReconnecting(device);
  bool _isLive(Device device) => _dashboard.isLive(device);

  String _mapStatusLabel(Device? device) {
    if (device == null) return 'Map';
    if (_isReconnecting(device)) return 'Linking up';
    if (!_isLive(device)) return 'Last known location';
    if (device.hasApproximateLocation) return 'Approximate location';
    if (device.hasFreshLocation) return '● Live location';
    return 'Connected • Locating';
  }

  @override
  void initState() {
    super.initState();
    _dashboard = DashboardController()
      ..addListener(_onDashboardChanged)
      ..start();
    _requestLocationPermission();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _syncLinkingAnimation();
    });
  }

  void _onDashboardChanged() {
    if (!mounted) return;
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
          final lngPad = zone.radiusMeters / (111000 * math.cos(zone.lat * math.pi / 180));
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
        await _mapController!.animateCamera(
          CameraUpdate.newLatLngBounds(
            LatLngBounds(
              southwest: LatLng(minLat, minLng),
              northeast: LatLng(maxLat, maxLng),
            ),
            56,
          ),
        );
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

  Future<void> _requestLocationPermission() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      final granted =
          permission == LocationPermission.always ||
          permission == LocationPermission.whileInUse;
      if (mounted) setState(() => _myLocationEnabled = granted);
    } catch (_) {
      // Own-location is a nice-to-have overlay; ignore failures.
    }
  }

  Future<void> _recenterOnMyLocation() async {
    try {
      if (!_myLocationEnabled) {
        await _requestLocationPermission();
        if (!_myLocationEnabled) return;
      }
      final position = await Geolocator.getCurrentPosition();
      if (!mounted) return;
      await _animateTo(LatLng(position.latitude, position.longitude), zoom: 16);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not read your location')),
        );
      }
    }
  }

  String _guardianInitials() {
    final user = FirebaseAuth.instance.currentUser;
    return initialsFor(
      user?.displayName?.trim().isNotEmpty == true
          ? user!.displayName!
          : (user?.email ?? 'G'),
    );
  }

  Widget _mapMeButton({required double bottom}) {
    return Positioned(
      right: 14,
      bottom: bottom,
      child: MapMyLocationAvatarButton(
        initials: _guardianInitials(),
        tooltip: 'My location',
        onPressed: () => unawaited(_recenterOnMyLocation()),
      ),
    );
  }

  Future<void> _animateTo(LatLng target, {double? zoom}) async {
    final controller = _mapController;
    if (controller == null) return;
    final z = zoom ?? _zoom;
    await controller.animateCamera(CameraUpdate.newLatLngZoom(target, z));
    _zoom = z;
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
          await _mapController!.animateCamera(
            CameraUpdate.newLatLngBounds(
              LatLngBounds(
                southwest: LatLng(minLat, minLng),
                northeast: LatLng(maxLat, maxLng),
              ),
              48,
            ),
          );
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
    _emergencyHoldTimer?.cancel();
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

  void _onMapCameraMove(CameraPosition position) {
    _zoom = position.zoom;
    _mapCameraGeneration.value++;
  }

  Widget _webMapAvatarOverlay() {
    if (!kIsWeb) return const SizedBox.shrink();
    return ValueListenableBuilder<int>(
      valueListenable: _mapCameraGeneration,
      builder: (context, generation, _) {
        return MapAvatarOverlay(
          controller: _mapController,
          devices: _devices,
          selectedImei: _selectedImei,
          cameraGeneration: generation,
          onSelect: _dashboard.select,
        );
      },
    );
  }

  void _startEmergencyHold(Device device) {
    if (_sendingHelp) return;
    _emergencyHoldTimer?.cancel();
    setState(() => _emergencyHoldTenths = 0);
    _emergencyHoldTimer = Timer.periodic(const Duration(milliseconds: 100), (
      timer,
    ) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      setState(() => _emergencyHoldTenths++);
      if (_emergencyHoldTenths >= 30) {
        timer.cancel();
        _sendHelp(device);
      }
    });
  }

  void _cancelEmergencyHold() {
    if (_emergencyHoldTenths >= 30) return;
    _emergencyHoldTimer?.cancel();
    _emergencyHoldTimer = null;
    if (mounted) setState(() => _emergencyHoldTenths = 0);
  }

  Device? get _selected {
    return _dashboard.selected;
  }

  Set<Marker> _markers() {
    if (kIsWeb) return const {};
    return {
      for (final device in _devices)
        if (device.hasFreshLocation &&
            _markerIcons.containsKey(device.imei))
          Marker(
            markerId: MarkerId(device.imei),
            position: LatLng(device.location!.lat, device.location!.lng),
            icon: _markerIcons[device.imei]!,
            zIndexInt: device.imei == _selectedImei ? 2 : 1,
            onTap: () => _dashboard.select(device.imei),
          ),
    };
  }

  Set<Circle> _circles() {
    final zones = _mapGeofences;
    final key =
        '${_selectedImei ?? 'all'}|${_geofencesFingerprint(zones)}';
    if (key == _cachedCirclesKey) return _cachedCircles;
    _cachedCirclesKey = key;
    _cachedCircles = {
      for (final zone in zones)
        Circle(
          circleId: CircleId(zone.id),
          center: LatLng(zone.lat, zone.lng),
          radius: zone.radiusMeters,
          fillColor: GuardianColors.safe.withValues(alpha: 0.22),
          strokeColor: GuardianColors.safe,
          strokeWidth: 3,
          zIndex: 1,
        ),
    };
    return _cachedCircles;
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
        setState(() {
          _sendingHelp = false;
          _emergencyHoldTenths = 0;
        });
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
        builder: (_) =>
            JourneyPage(
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

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    final center = selected?.hasFreshLocation == true
        ? LatLng(selected!.location!.lat, selected.location!.lng)
        : _mauritius;

    final insight = buildDashboardInsightForDevice(
      selected,
      linkingTick: _linkingTick,
    );

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
                        if (selected?.isReconnecting == true)
                          _LinkingPrototype(
                            device: selected!,
                            insight: insight,
                            tick: _linkingTick,
                          )
                        else ...[
                          _PrototypeCareCard(
                            device: selected,
                            insight: insight,
                            linkingTick: _linkingTick,
                          ),
                          const SizedBox(height: 18),
                          LayoutBuilder(
                            builder: (context, constraints) {
                              final compact = constraints.maxWidth < 640;
                              return SizedBox(
                                height: compact ? 230 : 300,
                                child: Container(
                                  decoration: BoxDecoration(
                                    borderRadius: BorderRadius.circular(28),
                                    border: Border.all(
                                      color: Colors.white,
                                      width: 1.5,
                                    ),
                                    boxShadow: [
                                      BoxShadow(
                                        color: GuardianColors.forest
                                            .withValues(alpha: 0.11),
                                        blurRadius: 38,
                                        offset: const Offset(0, 15),
                                      ),
                                    ],
                                  ),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(27),
                                    child: Stack(
                                      fit: StackFit.expand,
                                      children: [
                                        Positioned.fill(
                                          child: _StableGoogleMap(
                                            initialCameraPosition:
                                                CameraPosition(
                                              target: center,
                                              zoom: _zoom,
                                            ),
                                            markers: _markers(),
                                            circles: _circles(),
                                            myLocationEnabled:
                                                _myLocationEnabled,
                                            zoomControlsEnabled: false,
                                            onMapCreated: (controller) {
                                              _mapController = controller;
                                              _mapCameraGeneration.value++;
                                              _fitIfNeeded(_devices);
                                            },
                                            onCameraMove: _onMapCameraMove,
                                            onCameraIdle: () =>
                                                _mapCameraGeneration.value++,
                                          ),
                                        ),
                                        _webMapAvatarOverlay(),
                                        if (_loading)
                                          const Center(
                                            child:
                                                CircularProgressIndicator(),
                                          ),
                                        if (_error != null)
                                          Center(
                                            child:
                                                _MapMessage(message: _error!),
                                          ),
                                        if (!_loading &&
                                            _error == null &&
                                            _devices.isEmpty)
                                          const Center(
                                            child: _MapMessage(
                                              message:
                                                  'No linked device is reporting yet.',
                                            ),
                                          ),
                                        Positioned(
                                          top: 18,
                                          left: 18,
                                          child: _PrototypeMapLabel(
                                            device: selected,
                                            status:
                                                _mapStatusLabel(selected),
                                          ),
                                        ),
                                        _mapMeButton(
                                          bottom: selected == null ? 18 : 76,
                                        ),
                                        if (selected != null)
                                          Positioned(
                                            right: 18,
                                            bottom: 18,
                                            child: Material(
                                              color: GuardianColors.forest,
                                              borderRadius:
                                                  BorderRadius.circular(14),
                                              child: InkWell(
                                                onTap: () =>
                                                    _openHistory(selected),
                                                borderRadius:
                                                    BorderRadius.circular(14),
                                                child: const SizedBox(
                                                  width: 44,
                                                  height: 44,
                                                  child: Icon(
                                                    Icons
                                                        .arrow_forward_ios_rounded,
                                                    size: 17,
                                                    color: Colors.white,
                                                  ),
                                                ),
                                              ),
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                          if (selected != null) ...[
                            const SizedBox(height: 18),
                            _PrototypeHomePanels(
                              device: selected,
                              insight: insight,
                              onCall: () => _callDevice(selected),
                              onLocate: () {
                                if (selected.hasFreshLocation) {
                                  final location = selected.location!;
                                  _animateTo(
                                    LatLng(location.lat, location.lng),
                                    zoom: 16,
                                  );
                                }
                              },
                              onMessage: () => _showUnavailable(
                                'Messaging is not connected for this pendant yet.',
                              ),
                              onHistory: () => _openHistory(selected),
                            ),
                            const SizedBox(height: 18),
                            _EmergencyHoldCard(
                              progress: _emergencyHoldTenths / 30,
                              sending: _sendingHelp,
                              onStart: () => _startEmergencyHold(selected),
                              onCancel: _cancelEmergencyHold,
                            ),
                          ],
                        ],
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
            gradient: RadialGradient(
              colors: [color, color.withValues(alpha: 0)],
            ),
          ),
        ),
      );
}

class _PrototypeCareCard extends StatelessWidget {
  const _PrototypeCareCard({
    required this.device,
    required this.insight,
    required this.linkingTick,
  });

  final Device? device;
  final DashboardInsight insight;
  final int linkingTick;

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
          final wide = constraints.maxWidth >= 850;
          final summary = _CarePersonSummary(device: device);
          final comms = _DodoStagePlaceholder(
            device: device,
            insight: insight,
          );
          final metrics = _LiveStatusBar(
            device: device,
            linkingTick: linkingTick,
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
            height: 238,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(flex: 18, child: summary),
                const SizedBox(width: 22),
                Expanded(flex: 49, child: comms),
                const SizedBox(width: 22),
                Expanded(flex: 25, child: metrics),
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
    final relationship = device?.relationshipLabel ?? 'No pendant linked';
    final live =
        device?.connectivityPhase() == DeviceConnectivityPhase.live;
    final status = device == null
        ? 'Waiting'
        : device!.isReconnecting
            ? 'Linking'
            : live
                ? 'Live'
                : 'Offline';
    final statusColor = live ? GuardianColors.safe : GuardianColors.warning;
    final statusBackground =
        live ? GuardianColors.safeBg : GuardianColors.warningBg;

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
          crossAxisAlignment:
              horizontal ? CrossAxisAlignment.start : CrossAxisAlignment.center,
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
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 9),
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 11, vertical: 5),
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
                  ? 'Connect a pendant to begin'
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
  });

  final Device? device;
  final DashboardInsight insight;
  final bool linking;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final offline = device != null &&
        device!.connectivityPhase() == DeviceConnectivityPhase.offline;
    final rightNow = linking
        ? 'Scanning for the pendant'
        : offline
            ? 'Listening for the pendant'
            : device?.hasApproximateLocation == true
                ? 'Checking the latest location'
                : 'Listening to the pendant';
    final detail = linking
        ? 'Secure connection in progress'
        : offline
            ? 'Pendant → Claude-backed AI → family reconnection update'
            : 'Pendant → Claude-backed AI → WhatsApp → family';

    return Container(
      key: const ValueKey('guardian-dodo-3d-slot'),
      constraints: const BoxConstraints(minHeight: 238),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFFEAF9F1), Color(0xFFF8FBF2), Color(0xFFFFF5DB)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFD5EADF)),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final split = constraints.maxWidth >= 430;
          final stage = _DodoVisualStage(
            title: rightNow,
            detail: detail,
            linking: linking,
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
                    fontSize: 21,
                    height: 1.1,
                    fontWeight: FontWeight.w500,
                    letterSpacing: -0.6,
                  ),
                ),
                const SizedBox(height: 9),
                Text(
                  linking
                      ? insight.detail
                      : 'Pendant updates, Claude-backed AI checks, WhatsApp, and your family circle stay in one calm flow.',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 11,
                    height: 1.55,
                  ),
                ),
              ],
            ),
          );

          if (split) {
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(flex: 11, child: stage),
                Expanded(flex: 10, child: copy),
              ],
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SizedBox(height: 250, child: stage),
              copy,
            ],
          );
        },
      ),
    );
  }
}

class _DodoVisualStage extends StatelessWidget {
  const _DodoVisualStage({
    required this.title,
    required this.detail,
    required this.linking,
  });

  final String title;
  final String detail;
  final bool linking;

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              colors: [
                Color(0xFFFFFFFF),
                Color(0xFFDFF3E8),
                Color(0xFFCFE4DA),
              ],
              stops: [0.08, 0.48, 1],
            ),
          ),
        ),
        Center(
          child: Stack(
            alignment: Alignment.center,
            children: [
              Container(
                width: 148,
                height: 148,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: GuardianColors.safe.withValues(alpha: 0.13),
                    width: 2,
                  ),
                ),
              ),
              Container(
                width: 88,
                height: 88,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: Colors.white.withValues(alpha: 0.72),
                  boxShadow: [
                    BoxShadow(
                      color: GuardianColors.safe.withValues(alpha: 0.12),
                      blurRadius: 32,
                    ),
                  ],
                ),
                child: Icon(
                  linking
                      ? Icons.radar_rounded
                      : Icons.view_in_ar_outlined,
                  color: GuardianColors.safe.withValues(alpha: 0.55),
                  size: 34,
                ),
              ),
            ],
          ),
        ),
        Positioned(
          left: 15,
          top: 14,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: GuardianColors.forest,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 6,
                  height: 6,
                  decoration: const BoxDecoration(
                    color: Color(0xFF4CDD91),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                const Text(
                  '3D DODO STAGE',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1,
                  ),
                ),
              ],
            ),
          ),
        ),
        Positioned(
          left: 16,
          right: 16,
          bottom: 12,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: GuardianColors.forest.withValues(alpha: 0.94),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Row(
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: const BoxDecoration(
                    color: Color(0xFF57E69A),
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'RIGHT NOW',
                        style: TextStyle(
                          color: Color(0xFFA8C8B9),
                          fontSize: 7,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        detail,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Color(0xFFB8D3C6),
                          fontSize: 7,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _PrototypeMapLabel extends StatelessWidget {
  const _PrototypeMapLabel({
    required this.device,
    required this.status,
  });

  final Device? device;
  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final live =
        device?.connectivityPhase() == DeviceConnectivityPhase.live;
    return Container(
      constraints: const BoxConstraints(maxWidth: 280),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: live ? GuardianColors.safe : GuardianColors.warning,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  device == null
                      ? status
                      : '${device!.displayName} • $status',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                if (device != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    deviceUpdatedLabel(device!),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: colors.textSecondary, fontSize: 9),
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

class _PrototypeHomePanels extends StatelessWidget {
  const _PrototypeHomePanels({
    required this.device,
    required this.insight,
    required this.onCall,
    required this.onLocate,
    required this.onMessage,
    required this.onHistory,
  });

  final Device device;
  final DashboardInsight insight;
  final VoidCallback onCall;
  final VoidCallback onLocate;
  final VoidCallback onMessage;
  final VoidCallback onHistory;

  @override
  Widget build(BuildContext context) {
    final quick = _PrototypeQuickActions(
      onCall: onCall,
      onLocate: onLocate,
      onMessage: onMessage,
    );
    final activity = _CommunicationActivityCard(insight: insight);
    final today = _PrototypeTodayCard(
      device: device,
      onHistory: onHistory,
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 850) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              quick,
              const SizedBox(height: 14),
              activity,
              const SizedBox(height: 14),
              today,
            ],
          );
        }
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(flex: 14, child: quick),
              const SizedBox(width: 18),
              Expanded(flex: 10, child: activity),
              const SizedBox(width: 18),
              Expanded(flex: 10, child: today),
            ],
          ),
        );
      },
    );
  }
}

class _PrototypePanel extends StatelessWidget {
  const _PrototypePanel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colors.border),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.06),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _PrototypeQuickActions extends StatelessWidget {
  const _PrototypeQuickActions({
    required this.onCall,
    required this.onLocate,
    required this.onMessage,
  });

  final VoidCallback onCall;
  final VoidCallback onLocate;
  final VoidCallback onMessage;

  @override
  Widget build(BuildContext context) {
    return _PrototypePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _PrototypePanelHeading(
            eyebrow: 'QUICK ACTIONS',
            title: 'What do you need?',
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _PrototypeAction(
                  icon: Icons.call_rounded,
                  title: 'Call pendant',
                  subtitle: 'Speak instantly',
                  color: GuardianColors.safe,
                  background: GuardianColors.safeBg,
                  onTap: onCall,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: _PrototypeAction(
                  icon: Icons.location_on_outlined,
                  title: 'View location',
                  subtitle: 'Open live map',
                  color: GuardianColors.accent,
                  background: GuardianColors.accentBg,
                  onTap: onLocate,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: _PrototypeAction(
                  icon: Icons.chat_bubble_outline_rounded,
                  title: 'Ask Guardian',
                  subtitle: 'On WhatsApp',
                  color: GuardianColors.whatsapp,
                  background: GuardianColors.safeBg,
                  onTap: onMessage,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _PrototypeAction extends StatelessWidget {
  const _PrototypeAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.color,
    required this.background,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color color;
  final Color background;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Material(
      color: const Color(0xFFFBFCFB),
      borderRadius: BorderRadius.circular(17),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(17),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 14),
          decoration: BoxDecoration(
            border: Border.all(color: colors.border),
            borderRadius: BorderRadius.circular(17),
          ),
          child: Column(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  color: background,
                  borderRadius: BorderRadius.circular(13),
                ),
                child: Icon(icon, size: 19, color: color),
              ),
              const SizedBox(height: 8),
              Text(
                title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style:
                    const TextStyle(fontSize: 10, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 3),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(color: colors.textMuted, fontSize: 8),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _CommunicationActivityCard extends StatelessWidget {
  const _CommunicationActivityCard({required this.insight});

  final DashboardInsight insight;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return _PrototypePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 42,
                height: 42,
                decoration: BoxDecoration(
                  color: const Color(0xFFF2ECFB),
                  borderRadius: BorderRadius.circular(13),
                ),
                child: const Icon(
                  Icons.auto_awesome_rounded,
                  size: 19,
                  color: Color(0xFF8058BE),
                ),
              ),
              const SizedBox(width: 10),
              const Expanded(
                child: _PrototypePanelHeading(
                  eyebrow: 'COMMUNICATION ACTIVITY',
                  title: 'Everything is flowing',
                  compact: true,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                decoration: BoxDecoration(
                  color: GuardianColors.safeBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Text(
                  '●  Live',
                  style: TextStyle(
                    color: GuardianColors.safe,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          _ActivityRow(
            icon: Icons.sensors_rounded,
            color: GuardianColors.accent,
            background: GuardianColors.accentBg,
            title: 'Pendant signal received',
            note: 'Location and battery checked',
            trailing: 'now',
          ),
          _ActivityRow(
            icon: Icons.auto_awesome_rounded,
            color: const Color(0xFF8058BE),
            background: const Color(0xFFF2ECFB),
            title: insight.title,
            note: 'Guardian AI • Backed by Claude',
            trailing: 'now',
          ),
          _ActivityRow(
            icon: Icons.chat_bubble_outline_rounded,
            color: GuardianColors.whatsapp,
            background: GuardianColors.safeBg,
            title: 'WhatsApp is ready',
            note: 'Ask for an update anytime',
            trailing: '24/7',
            divider: false,
          ),
          const SizedBox(height: 1),
          Text(
            insight.detail,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 8,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActivityRow extends StatelessWidget {
  const _ActivityRow({
    required this.icon,
    required this.color,
    required this.background,
    required this.title,
    required this.note,
    required this.trailing,
    this.divider = true,
  });

  final IconData icon;
  final Color color;
  final Color background;
  final String title;
  final String note;
  final String trailing;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: BoxDecoration(
        border:
            divider ? Border(bottom: BorderSide(color: colors.border)) : null,
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(9),
            ),
            child: Icon(icon, size: 15, color: color),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  note,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: colors.textMuted, fontSize: 7),
                ),
              ],
            ),
          ),
          Text(
            trailing,
            style: TextStyle(color: colors.textMuted, fontSize: 7),
          ),
        ],
      ),
    );
  }
}

class _PrototypeTodayCard extends StatelessWidget {
  const _PrototypeTodayCard({
    required this.device,
    required this.onHistory,
  });

  final Device device;
  final VoidCallback onHistory;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final locationLabel = device.hasApproximateLocation
        ? 'Approximate location'
        : device.hasFreshLocation
            ? 'Latest position received'
            : 'Waiting for a position';
    return _PrototypePanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Expanded(
                child: _PrototypePanelHeading(
                  eyebrow: 'TODAY',
                  title: 'A calm day so far',
                  compact: true,
                ),
              ),
              TextButton(
                onPressed: onHistory,
                child: const Text(
                  'View journey',
                  style: TextStyle(fontSize: 10),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: GuardianColors.safeBg,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.location_on_rounded,
                  size: 18,
                  color: GuardianColors.safe,
                ),
              ),
              const SizedBox(width: 11),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      locationLabel,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      deviceUpdatedLabel(device),
                      style: TextStyle(color: colors.textMuted, fontSize: 9),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.surfaceMuted,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Text(
              'Journey details stay together on the Journey screen.',
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 9,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PrototypePanelHeading extends StatelessWidget {
  const _PrototypePanelHeading({
    required this.eyebrow,
    required this.title,
    this.compact = false,
  });

  final String eyebrow;
  final String title;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: colors.textMuted,
            fontSize: compact ? 8 : 9,
            fontWeight: FontWeight.w900,
            letterSpacing: 1.1,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          title,
          maxLines: compact ? 2 : 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: compact ? 13 : 18,
            height: 1.18,
            fontWeight: FontWeight.w800,
            letterSpacing: -0.3,
          ),
        ),
      ],
    );
  }
}

class _LinkingPrototype extends StatelessWidget {
  const _LinkingPrototype({
    required this.device,
    required this.insight,
    required this.tick,
  });

  final Device device;
  final DashboardInsight insight;
  final int tick;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final metrics = linkingStoryMetrics(device, tick: tick);
    final activeStep =
        linkingStoryStep(device).clamp(0, metrics.length - 1);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            AvatarBubble(
              initials: initialsFor(device.displayName),
              color: GuardianColors.safe,
              size: 70,
              imageUrl: device.avatarUrl,
            ),
            const SizedBox(width: 17),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${device.displayName.toUpperCase()}’S PENDANT',
                    style: TextStyle(
                      color: colors.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w900,
                      letterSpacing: 1.2,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    'Linking up…',
                    style: TextStyle(
                      color: colors.textPrimary,
                      fontSize: 34,
                      height: 1,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -1,
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    'This normally takes less than a minute.',
                    style:
                        TextStyle(color: colors.textSecondary, fontSize: 12),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 20),
        _DodoStagePlaceholder(
          device: device,
          insight: insight,
          linking: true,
        ),
        const SizedBox(height: 18),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth >= 800 ? 4 : 1;
            if (columns == 1) {
              return Column(
                children: [
                  for (var i = 0; i < metrics.length; i++) ...[
                    _LinkingStepCard(
                      index: i,
                      metric: metrics[i],
                      active: i == activeStep,
                    ),
                    if (i < metrics.length - 1)
                      const SizedBox(height: 10),
                  ],
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < metrics.length; i++) ...[
                  Expanded(
                    child: _LinkingStepCard(
                      index: i,
                      metric: metrics[i],
                      active: i == activeStep,
                    ),
                  ),
                  if (i < metrics.length - 1)
                    const SizedBox(width: 13),
                ],
              ],
            );
          },
        ),
        const SizedBox(height: 18),
        Align(
          alignment: Alignment.center,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
            decoration: BoxDecoration(
              color: GuardianColors.forest,
              borderRadius: BorderRadius.circular(16),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.shield_outlined, size: 20, color: Colors.white),
                SizedBox(width: 11),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Your connection is secure',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Guardian will switch to Live automatically.',
                      style: TextStyle(
                        color: Color(0xFFAEC1B8),
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _LinkingStepCard extends StatelessWidget {
  const _LinkingStepCard({
    required this.index,
    required this.metric,
    required this.active,
  });

  final int index;
  final LinkingStoryMetric metric;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final complete = metric.state == LinkingStoryMetricState.complete;
    final foreground = complete
        ? GuardianColors.safe
        : active
            ? GuardianColors.accent
            : colors.textMuted;
    final background = complete
        ? GuardianColors.safeBg
        : active
            ? GuardianColors.accentBg
            : colors.surfaceMuted;

    return Container(
      constraints: const BoxConstraints(minHeight: 132),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: complete
            ? const Color(0xFFF1FBF5)
            : colors.surface.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(21),
        border: Border.all(
          color: active ? GuardianColors.accent : colors.border,
        ),
        boxShadow: active
            ? [
                BoxShadow(
                  color: GuardianColors.accent.withValues(alpha: 0.12),
                  blurRadius: 28,
                  offset: const Offset(0, 10),
                ),
              ]
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(metric.icon, color: foreground, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'STEP ${index + 1}',
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: 1,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  metric.label,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  complete
                      ? 'Complete'
                      : active
                          ? 'Working on this now…'
                          : 'Waiting for the previous step',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 10,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
          Text(
            complete
                ? '✓'
                : active
                    ? '•••'
                    : '${index + 1}',
            style: TextStyle(
              color: foreground,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _LiveStatusBar extends StatelessWidget {
  const _LiveStatusBar({required this.device, this.linkingTick = 0});

  final Device? device;
  final int linkingTick;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final selected = device;
    final phase =
        selected?.connectivityPhase() ?? DeviceConnectivityPhase.offline;
    final reconnecting = phase == DeviceConnectivityPhase.reconnecting;

    if (reconnecting && selected != null) {
      final story = linkingStoryMetrics(selected, tick: linkingTick);
      final metricWidgets = [
        for (var i = 0; i < story.length; i++)
          _LiveMetric(
            metric: DashboardFlagMetric.values[i],
            icon: story[i].icon,
            title: const ['Pendant', 'Location', 'Battery', 'Network'][i],
            label: story[i].label,
            active: story[i].state == LinkingStoryMetricState.complete,
            colorsOverride: linkingStoryMetricColors(story[i].state),
            showPulse: story[i].state == LinkingStoryMetricState.active,
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
    final signalColors = flagMetricColors(DashboardFlagMetric.signal, connected);
    final metricWidgets = [
      _LiveMetric(
        metric: DashboardFlagMetric.connectivity,
        icon: Icons.sensors_rounded,
        title: 'Pendant',
        label: selected == null
            ? 'Offline'
            : deviceConnectivityLabel(selected),
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
            children: children,
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children.take(2).toList(),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: children.skip(2).toList(),
              ),
            ),
          ],
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
    return Expanded(
      child: Padding(
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
            border: Border.all(
              color: colors.foreground.withValues(alpha: 0.08),
            ),
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
      ),
    );
  }
}

class _MapMessage extends StatelessWidget {
  const _MapMessage({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      margin: const EdgeInsets.all(28),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface.withValues(alpha: 0.94),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: colors.border),
      ),
      child: Text(message, textAlign: TextAlign.center),
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
    required this.myLocationEnabled,
    required this.zoomControlsEnabled,
    required this.onMapCreated,
    required this.onCameraMove,
    required this.onCameraIdle,
  });

  final CameraPosition initialCameraPosition;
  final Set<Marker> markers;
  final Set<Circle> circles;
  final bool myLocationEnabled;
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
      config.myLocationEnabled,
      config.zoomControlsEnabled,
    );
  }

  Widget _buildMap(_StableGoogleMap config) {
    final circleKey = config.circles.map((c) => c.circleId.value).join('-');
    return GoogleMap(
      key: ValueKey(
        'dashboard-map-$circleKey-${config.markers.length}',
      ),
      initialCameraPosition: config.initialCameraPosition,
      markers: config.markers,
      circles: config.circles,
      myLocationButtonEnabled: false,
      myLocationEnabled: config.myLocationEnabled,
      zoomControlsEnabled: config.zoomControlsEnabled,
      mapToolbarEnabled: false,
      compassEnabled: false,
      indoorViewEnabled: false,
      trafficEnabled: false,
      buildingsEnabled: true,
      onMapCreated: config.onMapCreated,
      onCameraMove: config.onCameraMove,
      onCameraIdle: config.onCameraIdle,
    );
  }

  @override
  Widget build(BuildContext context) => _map;
}

class _EmergencyHoldCard extends StatelessWidget {
  const _EmergencyHoldCard({
    required this.progress,
    required this.sending,
    required this.onStart,
    required this.onCancel,
  });

  final double progress;
  final bool sending;
  final VoidCallback onStart;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    final remaining = (3 - progress * 3).ceil().clamp(1, 3);
    final holding = progress > 0 && progress < 1;
    return GestureDetector(
      onTapDown: sending ? null : (_) => onStart(),
      onTapUp: sending ? null : (_) => onCancel(),
      onTapCancel: sending ? null : onCancel,
      child: Container(
        height: 88,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFFFFF6F4), GuardianColors.dangerBg],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(26),
          border: Border.all(
            color: GuardianColors.danger.withValues(alpha: 0.22),
          ),
          boxShadow: [
            BoxShadow(
              color: GuardianColors.danger.withValues(alpha: 0.10),
              blurRadius: 24,
              offset: const Offset(0, 9),
            ),
          ],
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Positioned.fill(
              child: FractionallySizedBox(
                alignment: Alignment.centerLeft,
                widthFactor: progress.clamp(0, 1),
                child: Container(
                  color: GuardianColors.danger.withValues(alpha: 0.14),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Row(
                children: [
                  Container(
                    width: 52,
                    height: 52,
                    decoration: const BoxDecoration(
                      color: GuardianColors.danger,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.sos_rounded,
                      color: Colors.white,
                      size: 25,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Emergency',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.25,
                            color: GuardianColors.dangerText,
                          ),
                        ),
                        Text(
                          sending
                              ? 'Sending alert…'
                              : holding
                              ? 'Keep holding • $remaining'
                              : 'Hold for 3 seconds',
                          style: const TextStyle(
                            fontSize: 11,
                            color: GuardianColors.dangerText,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.touch_app_rounded,
                    color: GuardianColors.danger,
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
