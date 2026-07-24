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
import '../dashboard/device_card_visibility.dart';
import '../dashboard/device_formatters.dart';
import '../models/alert.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../navigation/home_shell_scope.dart';
import '../services/device_card_preferences.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/brand/dodo_ai_icon.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/dashboard/reconnecting_pulse.dart';
import '../widgets/dashboard/smart_device_map_card.dart';
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
  StreamSubscription<List<GuardianAlert>>? _alertsSubscription;
  List<GuardianAlert> _alerts = const [];
  bool _deviceCardMinimized = false;
  String? _loadedCardPrefsImei;
  final Map<String, bool> _attentionByImei = {};

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

  PillTone _mapStatusTone(Device? device) {
    if (device == null || !_isLive(device)) {
      return device != null && _isReconnecting(device)
          ? PillTone.warning
          : PillTone.neutral;
    }
    return device.hasFreshLocation && !device.hasApproximateLocation
        ? PillTone.safe
        : PillTone.warning;
  }

  @override
  void initState() {
    super.initState();
    _dashboard = DashboardController()
      ..addListener(_onDashboardChanged)
      ..start();
    _alertsSubscription = AlertService().watchLinkedAlerts().listen((alerts) {
      if (!mounted) return;
      setState(() => _alerts = alerts);
      _syncDeviceCardVisibility();
    });
    _requestLocationPermission();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _ensureDeviceCardPrefsLoaded();
      _syncDeviceCardVisibility();
      _syncLinkingAnimation();
    });
  }

  List<GuardianAlert> _alertsForDevice(String imei) {
    return _alerts
        .where((alert) => alert.imei == imei && !alert.resolved)
        .toList();
  }

  Future<void> _loadDeviceCardPrefs(String imei) async {
    final minimized = await DeviceCardPreferences.loadMinimized(imei);
    if (!mounted || _selectedImei != imei) return;
    setState(() => _deviceCardMinimized = minimized);
    _syncDeviceCardVisibility();
  }

  void _syncDeviceCardVisibility() {
    final device = _selected;
    if (device == null) return;
    final imei = device.imei;
    final needsAttention = deviceNeedsMapCardAttention(
      device,
      alerts: _alertsForDevice(imei),
    );
    final wasAttention = _attentionByImei[imei] ?? false;
    if (needsAttention && !wasAttention && _deviceCardMinimized) {
      setState(() => _deviceCardMinimized = false);
      unawaited(DeviceCardPreferences.saveMinimized(imei, false));
    }
    _attentionByImei[imei] = needsAttention;
  }

  void _setDeviceCardMinimized(bool minimized) {
    final imei = _selectedImei;
    if (imei == null) return;
    setState(() => _deviceCardMinimized = minimized);
    unawaited(DeviceCardPreferences.saveMinimized(imei, minimized));
  }

  void _ensureDeviceCardPrefsLoaded() {
    final imei = _selectedImei;
    if (imei == null || imei == _loadedCardPrefsImei) return;
    _loadedCardPrefsImei = imei;
    unawaited(_loadDeviceCardPrefs(imei));
  }

  Widget _selectedDeviceMapCard({
    required Device device,
    required VoidCallback onOpen,
  }) {
    return SmartDeviceMapCard(
      device: device,
      updated: deviceUpdatedLabel(device),
      onOpen: onOpen,
      minimized: _deviceCardMinimized,
      onMinimize: () => _setDeviceCardMinimized(true),
      onExpand: () => _setDeviceCardMinimized(false),
      alerts: _alertsForDevice(device.imei),
    );
  }

  void _onDashboardChanged() {
    if (!mounted) return;
    setState(() {});
    _syncLinkingAnimation();
    _ensureDeviceCardPrefsLoaded();
    _syncDeviceCardVisibility();
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
    _alertsSubscription?.cancel();
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

  Future<void> _unlink(Device device) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Unlink pendant?'),
        content: Text(
          '${device.displayName} will disappear from your account. '
          'The pendant itself is not reset — you can link it again with the IMEI.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: GuardianColors.danger,
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Unlink'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    try {
      await DeviceService().unlinkPendant(device.imei);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${device.displayName} unlinked')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not unlink pendant: $e')),
        );
      }
    }
  }

  Future<void> _rename(Device device) async {
    final nicknameCtrl = TextEditingController(text: device.nickname ?? '');
    final relationshipCtrl = TextEditingController(
      text: device.relationship ?? device.relationshipLabel,
    );
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Who is wearing Guardian?'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nicknameCtrl,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Nickname (optional)',
                hintText: 'e.g. Mimi',
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: relationshipCtrl,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(
                labelText: 'Relationship',
                hintText: 'e.g. Mum, Dad, Grandad',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (ok == true && mounted) {
      await DeviceService().updatePersonIdentity(
        device.imei,
        nickname: nicknameCtrl.text,
        relationship: relationshipCtrl.text,
      );
    }
    nicknameCtrl.dispose();
    relationshipCtrl.dispose();
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

  void _openSafeZones() {
    HomeShellScope.maybeOf(context)?.goToTab(1);
  }

  void _showUnavailable(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final selected = _selected;
    final user = FirebaseAuth.instance.currentUser;
    final userInitials = initialsFor(
      user?.displayName?.trim().isNotEmpty == true
          ? user!.displayName!
          : (user?.email ?? 'G'),
    );
    final center = selected?.hasFreshLocation == true
        ? LatLng(selected!.location!.lat, selected.location!.lng)
        : _mauritius;

    final insight = buildDashboardInsightForDevice(
      selected,
      linkingTick: _linkingTick,
    );
    final mood = dashboardSafetyMood(_devices);
    final onlineCount = _devices
        .where((d) => d.connectivityPhase() == DeviceConnectivityPhase.live)
        .length;

    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: SafeArea(
        child: Stack(
          children: [
            const Positioned(
              top: -90,
              right: -70,
              child: _AmbientGlow(size: 250, color: Color(0x2E4AC99B)),
            ),
            const Positioned(
              top: 310,
              left: -100,
              child: _AmbientGlow(size: 230, color: Color(0x1FE8B765)),
            ),
            Center(
              child: ConstrainedBox(
            // Home is intentionally a calm, mobile-first care experience on
            // every platform. Desktop gets breathing room around the same
            // composition instead of an unrelated command-centre UI.
            constraints: const BoxConstraints(maxWidth: 520),
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(18, 14, 18, 10),
                    child: Row(
                      children: [
                        const GuardianBrandMark(
                          size: 42,
                          borderRadius: 14,
                          iconScale: 0.58,
                        ),
                        const SizedBox(width: 12),
                        const Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Guardian',
                              style: _dashboardHeaderTitleStyle,
                            ),
                            _GuardianSloganText(),
                          ],
                        ),
                        const Spacer(),
                        IconButton(
                          onPressed: () =>
                              HomeShellScope.maybeOf(context)?.goToTab(2),
                          icon: const Icon(Icons.notifications_none_rounded),
                          tooltip: 'Open alerts',
                        ),
                        const SizedBox(width: 8),
                        GuardianHeaderAvatar(
                          initials: userInitials,
                          color: context.guardianColors.accent,
                          size: 36,
                        ),
                      ],
                    ),
                  ),
                ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(14, 5, 14, 30),
                  sliver: SliverList.list(
                    children: [
                      _SafetyHero(
                        safe: mood == DashboardSafetyMood.allClear,
                        onlineCount: onlineCount,
                        totalCount: _devices.length,
                        updated: selected == null
                            ? 'Waiting for a linked device'
                            : deviceUpdatedLabel(selected),
                        titleOverride: dashboardSafetyTitle(_devices),
                        subtitleOverride: dashboardSafetySubtitle(_devices),
                      ),
                      const SizedBox(height: 14),
                      _LiveStatusBar(device: selected, linkingTick: _linkingTick),
                      const SizedBox(height: 16),
                      SizedBox(
                        height: 272,
                        child: Container(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(30),
                            border: Border.all(
                              color: Colors.white.withValues(alpha: 0.8),
                              width: 1.5,
                            ),
                            boxShadow: [
                              BoxShadow(
                                color: context.guardianColors.textPrimary
                                    .withValues(alpha: 0.11),
                                blurRadius: 34,
                                offset: const Offset(0, 14),
                              ),
                            ],
                          ),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(29),
                            child: Stack(
                            fit: StackFit.expand,
                            children: [
                              Positioned.fill(
                                child: _StableGoogleMap(
                                  initialCameraPosition: CameraPosition(
                                    target: center,
                                    zoom: _zoom,
                                  ),
                                  markers: _markers(),
                                  circles: _circles(),
                                  myLocationEnabled: _myLocationEnabled,
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
                                  child: CircularProgressIndicator(),
                                ),
                              if (_error != null)
                                Center(child: _MapMessage(message: _error!)),
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
                                top: 14,
                                left: 14,
                                child: StatusPill(
                                  label: _mapStatusLabel(selected),
                                  tone: _mapStatusTone(selected),
                                ),
                              ),
                              _mapMeButton(
                                bottom: selected != null && !_deviceCardMinimized
                                    ? 118
                                    : 14,
                              ),
                              if (selected != null)
                                Positioned(
                                  left: 14,
                                  right: _deviceCardMinimized ? null : 14,
                                  bottom: 14,
                                  child: _selectedDeviceMapCard(
                                    device: selected,
                                    onOpen: () => _openHistory(selected),
                                  ),
                                ),
                            ],
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      _GuardianAiCard(insight: insight),
                      if (selected != null) ...[
                        const SizedBox(height: 18),
                        const _SectionTitle(title: 'Quick actions'),
                        const SizedBox(height: 10),
                        _QuickActions(
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
                          onSiren: () => _showUnavailable(
                            'Remote siren has no vendor-confirmed command for this device.',
                          ),
                          onHistory: () => _openHistory(selected),
                          onSafeZone: _openSafeZones,
                        ),
                        const SizedBox(height: 18),
                        _TimelineCard(
                          device: selected,
                          updated: deviceUpdatedLabel(selected),
                          onOpen: () => _openHistory(selected),
                        ),
                        if (_devices.isNotEmpty) ...[
                          const SizedBox(height: 18),
                          const _SectionTitle(title: 'People you care for'),
                          const SizedBox(height: 10),
                          SizedBox(
                            height: 164,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _devices.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(width: 10),
                              itemBuilder: (context, index) {
                                final device = _devices[index];
                                return _PremiumDeviceCard(
                                  device: device,
                                  selected: device.imei == _selectedImei,
                                  updated: deviceUpdatedLabel(device),
                                  onTap: () {
                                    _dashboard.select(device.imei);
                                    if (device.hasFreshLocation) {
                                      _animateTo(
                                        LatLng(
                                          device.location!.lat,
                                          device.location!.lng,
                                        ),
                                        zoom: 15,
                                      );
                                    }
                                  },
                                  onRename: () => _rename(device),
                                  onUnlink: () => _unlink(device),
                                );
                              },
                            ),
                          ),
                        ],
                        if (_geofences.isNotEmpty) ...[
                          const SizedBox(height: 18),
                          const _SectionTitle(title: 'Safe zones'),
                          const SizedBox(height: 10),
                          SizedBox(
                            height: 96,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: _geofences.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(width: 10),
                              itemBuilder: (_, index) =>
                                  _SafeZoneCard(zone: _geofences[index]),
                            ),
                          ),
                        ],
                        const SizedBox(height: 18),
                        const _SectionTitle(title: 'Health & activity'),
                        const SizedBox(height: 10),
                        const Row(
                          children: [
                            Expanded(
                              child: _UnavailableSignalCard(
                                icon: Icons.favorite_rounded,
                                title: 'Heart rate',
                              ),
                            ),
                            SizedBox(width: 10),
                            Expanded(
                              child: _UnavailableSignalCard(
                                icon: Icons.directions_walk_rounded,
                                title: 'Activity',
                              ),
                            ),
                          ],
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
                  ),
                ),
              ],
            ),
          ),
            ),
          ],
        ),
      ),
    );
  }
}

const _dashboardHeaderTitleStyle = TextStyle(
  fontSize: 23,
  fontWeight: FontWeight.w800,
  letterSpacing: -0.65,
  height: 1.0,
);

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

class _GuardianSloganText extends StatelessWidget {
  const _GuardianSloganText();

  @override
  Widget build(BuildContext context) => Text(
        'Always close. Always caring.',
        style: TextStyle(
          color: context.guardianColors.textMuted,
          fontSize: 9,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.15,
        ),
      );
}

class _SafetyHero extends StatelessWidget {
  const _SafetyHero({
    required this.safe,
    required this.onlineCount,
    required this.totalCount,
    required this.updated,
    this.titleOverride,
    this.subtitleOverride,
  });

  final bool safe;
  final int onlineCount;
  final int totalCount;
  final String updated;
  final String? titleOverride;
  final String? subtitleOverride;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final title = titleOverride ??
        (totalCount == 0
            ? "Let's connect someone you care about"
            : safe
                ? 'Everyone you care about is safe'
                : 'A device needs your attention');
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 17, 16, 17),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            colors.surface,
            colors.accentMuted.withValues(alpha: 0.55),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.8)),
        boxShadow: [
          BoxShadow(
            color: colors.textPrimary.withValues(alpha: 0.08),
            blurRadius: 30,
            offset: const Offset(0, 12),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          GuardianAiIcon(
            size: 66,
            backgroundColor:
                safe ? GuardianColors.safeBg : GuardianColors.warningBg,
            accentColor:
                safe ? GuardianColors.safe : GuardianColors.warning,
            warning: totalCount > 0 && !safe,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 17,
                    height: 1.18,
                    fontWeight: FontWeight.w800,
                    letterSpacing: -0.3,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitleOverride ??
                      (totalCount == 0
                          ? 'No linked devices'
                          : '$onlineCount online  ·  ${totalCount - onlineCount} offline'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.2,
                    color: colors.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  updated,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.2,
                    color: colors.textMuted,
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
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
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
            ],
          ),
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
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
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
          ],
        ),
      ),
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

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
    );
  }
}

class _PremiumDeviceCard extends StatelessWidget {
  const _PremiumDeviceCard({
    required this.device,
    required this.selected,
    required this.updated,
    required this.onTap,
    required this.onRename,
    required this.onUnlink,
  });

  final Device device;
  final bool selected;
  final String updated;
  final VoidCallback onTap;
  final VoidCallback onRename;
  final VoidCallback onUnlink;

  bool get _isReconnecting => device.isReconnecting;

  bool get _isLive =>
      device.connectivityPhase() == DeviceConnectivityPhase.live;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final color = avatarColorForKey(device.imei);
    final battery = (device.batteryPercent ?? 0).clamp(0, 100) / 100;
    final batteryColors = flagMetricColors(
      DashboardFlagMetric.battery,
      dashboardBatteryHealthy(device.batteryPercent),
    );
    return SizedBox(
      width: 220,
      child: Material(
        color: colors.surface,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: onTap,
          onLongPress: onRename,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: selected ? colors.accent : colors.border,
                width: selected ? 1.5 : 1,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    AvatarBubble(
                      initials: initialsFor(device.displayName),
                      color: color,
                      size: 42,
                      imageUrl: device.avatarUrl,
                    ),
                    const Spacer(),
                    PopupMenuButton<String>(
                      icon: Icon(Icons.more_horiz, size: 18, color: colors.textMuted),
                      padding: EdgeInsets.zero,
                      tooltip: 'Pendant options',
                      onSelected: (value) {
                        if (value == 'rename') onRename();
                        if (value == 'unlink') onUnlink();
                      },
                      itemBuilder: (ctx) => const [
                        PopupMenuItem(
                          value: 'rename',
                          child: Text('Edit name'),
                        ),
                        PopupMenuItem(
                          value: 'unlink',
                          child: Text('Unlink pendant'),
                        ),
                      ],
                    ),
                    SizedBox(
                      width: 40,
                      height: 40,
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          CircularProgressIndicator(
                            value: device.batteryPercent == null ? 0 : battery,
                            strokeWidth: 3,
                            backgroundColor: batteryColors.background,
                            color: batteryColors.foreground,
                          ),
                          Text(
                            device.batteryPercent == null
                                ? '—'
                                : '${device.batteryPercent}%',
                            style: const TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  device.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 4),
                Text(
                  _isReconnecting
                      ? '● Linking up'
                      : _isLive
                          ? '● Online'
                          : '○ Offline'
                              '${device.displayName != device.relationshipLabel ? '  •  ${device.relationshipLabel}' : ''}',
                  style: TextStyle(
                    fontSize: 11,
                    color: _isReconnecting || _isLive
                        ? GuardianColors.accent
                        : colors.textMuted,
                  ),
                ),
                const Spacer(),
                Text(
                  '${deviceLocationStatusLabel(device)}  •  $updated',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 9,
                    color: colors.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _GuardianAiCard extends StatelessWidget {
  const _GuardianAiCard({required this.insight});

  final DashboardInsight insight;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final warning =
        insight.tone == DashboardInsightTone.warning ||
        insight.tone == DashboardInsightTone.danger;
    final color = warning ? GuardianColors.warning : colors.accent;
    final background = warning
        ? GuardianColors.warningBg
        : colors.accentMuted;
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [colors.surface, background.withValues(alpha: 0.55)],
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: color.withValues(alpha: 0.18)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GuardianAiIcon(
            size: 40,
            backgroundColor: background,
            accentColor: color,
            warning: warning,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Guardian AI',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                    color: colors.textSecondary,
                  ),
                ),
                const SizedBox(height: 6),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 450),
                  switchInCurve: Curves.easeOut,
                  switchOutCurve: Curves.easeIn,
                  child: Text(
                    insight.title,
                    key: ValueKey('title-${insight.title}'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      height: 1.25,
                      color: colors.textPrimary,
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                AnimatedSwitcher(
                  duration: const Duration(milliseconds: 450),
                  switchInCurve: Curves.easeOut,
                  switchOutCurve: Curves.easeIn,
                  child: Text(
                    insight.detail,
                    key: ValueKey('detail-${insight.detail}'),
                    maxLines: 4,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.4,
                      color: colors.textSecondary,
                    ),
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

class _QuickActions extends StatelessWidget {
  const _QuickActions({
    required this.onCall,
    required this.onLocate,
    required this.onMessage,
    required this.onSiren,
    required this.onHistory,
    required this.onSafeZone,
  });

  final VoidCallback onCall;
  final VoidCallback onLocate;
  final VoidCallback onMessage;
  final VoidCallback onSiren;
  final VoidCallback onHistory;
  final VoidCallback onSafeZone;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final actions = [
      (Icons.call_rounded, 'Call', onCall),
      (Icons.my_location_rounded, 'Locate', onLocate),
      (Icons.chat_bubble_outline_rounded, 'Message', onMessage),
      (Icons.volume_up_rounded, 'Siren', onSiren),
      (Icons.route_rounded, 'Journey', onHistory),
      (Icons.location_on_outlined, 'Safe zone', onSafeZone),
    ];
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Wrap(
        alignment: WrapAlignment.spaceEvenly,
        runSpacing: 14,
        children: [
          for (final action in actions)
            SizedBox(
              width: 76,
              child: InkWell(
                onTap: action.$3,
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: colors.accentMuted,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          action.$1,
                          size: 20,
                          color: colors.accent,
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(action.$2, style: const TextStyle(fontSize: 10)),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TimelineCard extends StatelessWidget {
  const _TimelineCard({
    required this.device,
    required this.updated,
    required this.onOpen,
  });

  final Device device;
  final String updated;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Today',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              TextButton(onPressed: onOpen, child: const Text('View journey')),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: colors.accentMuted,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.location_on_rounded,
                  size: 17,
                  color: colors.accent,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      device.hasApproximateLocation
                          ? 'Approximate location'
                          : (device.hasFreshLocation
                              ? 'Latest position received'
                              : 'Waiting for a position'),
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (device.hasApproximateLocation) ...[
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: colors.accentMuted,
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: Text(
                          'Approximate location',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                            color: colors.accent,
                          ),
                        ),
                      ),
                    ],
                    Text(
                      updated,
                      style: TextStyle(
                        fontSize: 10,
                        color: colors.textMuted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            'Journey events appear when location history is enabled on the gateway.',
            style: TextStyle(fontSize: 10, color: colors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _SafeZoneCard extends StatelessWidget {
  const _SafeZoneCard({required this.zone});

  final Geofence zone;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      width: 180,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(Icons.home_rounded, color: colors.accent),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  zone.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  zone.active
                      ? 'Active • ${zone.radiusMeters.round()} m'
                      : 'Paused',
                  style: TextStyle(
                    fontSize: 10,
                    color: colors.textSecondary,
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

class _UnavailableSignalCard extends StatelessWidget {
  const _UnavailableSignalCard({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(icon, color: colors.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                Text(
                  'Sensor not connected',
                  style: TextStyle(
                    fontSize: 9,
                    color: colors.textMuted,
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
