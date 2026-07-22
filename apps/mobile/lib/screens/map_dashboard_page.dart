import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../dashboard/dashboard_status_colors.dart';
import '../dashboard/dashboard_controller.dart';
import '../dashboard/dashboard_insight.dart';
import '../dashboard/device_formatters.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../navigation/home_shell_scope.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/brand/dodo_ai_icon.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/dashboard/desktop_dashboard_layout.dart';
import '../widgets/guardian_widgets.dart';
import '../widgets/map/map_avatar_overlay.dart';
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
  int _emergencyHoldTenths = 0;
  Map<String, BitmapDescriptor> _markerIcons = const {};
  String _markerFingerprint = '';
  int _markerGeneration = 0;
  Set<Circle> _cachedCircles = const {};
  String _cachedCirclesKey = '';
  final ValueNotifier<int> _mapCameraGeneration = ValueNotifier(0);

  static const _mauritius = LatLng(-20.2642, 57.4791);

  List<Device> get _devices => _dashboard.devices;
  List<Geofence> get _geofences => _dashboard.geofences;
  String? get _selectedImei => _dashboard.selectedImei;
  String? get _error => _dashboard.error?.toString();
  bool get _loading => _dashboard.loading;

  @override
  void initState() {
    super.initState();
    _dashboard = DashboardController()
      ..addListener(_onDashboardChanged)
      ..start();
    _requestLocationPermission();
  }

  void _onDashboardChanged() {
    if (!mounted) return;
    setState(() {});
    unawaited(_refreshMarkerIcons());
    _fitIfNeeded(_devices);
    _followSelected(_devices);
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
    final key = _geofences
        .map(
          (zone) =>
              '${zone.id}|${zone.active}|${zone.lat}|${zone.lng}|${zone.radiusMeters}',
        )
        .join('||');
    if (key == _cachedCirclesKey) return _cachedCircles;
    _cachedCirclesKey = key;
    _cachedCircles = {
      for (final zone in _geofences)
        if (zone.active && (zone.lat != 0 || zone.lng != 0))
          Circle(
            circleId: CircleId(zone.id),
            center: LatLng(zone.lat, zone.lng),
            radius: zone.radiusMeters,
            fillColor: GuardianColors.safe.withValues(alpha: 0.12),
            strokeColor: GuardianColors.safe,
            strokeWidth: 2,
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

  Widget _desktopMapPanel({required LatLng center, required Device? selected}) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(GuardianRadius.hero),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: _StableGoogleMap(
              initialCameraPosition: CameraPosition(target: center, zoom: _zoom),
              markers: _markers(),
              circles: _circles(),
              myLocationEnabled: _myLocationEnabled,
              zoomControlsEnabled: true,
              onMapCreated: (controller) {
                _mapController = controller;
                _mapCameraGeneration.value++;
                _fitIfNeeded(_devices);
              },
              onCameraMove: _onMapCameraMove,
              onCameraIdle: () => _mapCameraGeneration.value++,
            ),
          ),
          _webMapAvatarOverlay(),
          if (_loading) const Center(child: CircularProgressIndicator()),
          if (_error != null) Center(child: _MapMessage(message: _error!)),
          if (!_loading && _error == null && _devices.isEmpty)
            const Center(
              child: _MapMessage(message: 'No linked device is reporting yet.'),
            ),
          Positioned(
            top: 16,
            left: 16,
            child: StatusPill(
              label: selected?.online == true ? '● Live' : 'Map',
              tone: selected?.online == true ? PillTone.safe : PillTone.neutral,
            ),
          ),
          if (selected != null)
            DesktopMapPersonCardPlacement(
              key: const ValueKey('desktop-selected-person-card'),
              child: _FloatingDeviceCard(
                device: selected,
                updated: deviceUpdatedLabel(selected),
                onOpen: () => _openHistory(selected),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDesktopDashboard({
    required Device? selected,
    required LatLng center,
    required String userInitials,
    required int onlineCount,
    required bool allSafe,
    required DashboardInsight insight,
  }) {
    final quickActions = selected == null
        ? null
        : _QuickActions(
            onCall: () => _callDevice(selected),
            onLocate: () {
              if (selected.hasFreshLocation) {
                final location = selected.location!;
                _animateTo(LatLng(location.lat, location.lng), zoom: 16);
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
          );
    final bottomStatus = selected == null
        ? null
        : Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                flex: 4,
                child: _EmergencyHoldCard(
                  progress: _emergencyHoldTenths / 30,
                  sending: _sendingHelp,
                  onStart: () => _startEmergencyHold(selected),
                  onCancel: _cancelEmergencyHold,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                flex: 3,
                child: _UnavailableSignalCard(
                  icon: Icons.favorite_rounded,
                  title: 'Health',
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                flex: 3,
                child: _UnavailableSignalCard(
                  icon: Icons.directions_walk_rounded,
                  title: 'Activity',
                ),
              ),
              if (_geofences.isNotEmpty) ...[
                const SizedBox(width: 12),
                Expanded(flex: 4, child: _SafeZoneCard(zone: _geofences.first)),
              ],
            ],
          );
    return Scaffold(
      body: DesktopDashboardLayout(
        topBar: _DesktopTopBar(
          userInitials: userInitials,
        ),
        safetySummary: _SafetyHero(
          safe: allSafe,
          onlineCount: onlineCount,
          totalCount: _devices.length,
          updated: selected == null
              ? 'Waiting for a linked device'
              : deviceUpdatedLabel(selected),
        ),
        liveStatus: _LiveStatusBar(device: selected),
        map: _desktopMapPanel(center: center, selected: selected),
        devices: _DesktopDevicesCard(
          devices: _devices,
          selectedImei: _selectedImei,
          onSelect: (device) {
            _dashboard.select(device.imei);
            if (device.hasFreshLocation) {
              final location = device.location!;
              _animateTo(LatLng(location.lat, location.lng), zoom: 15);
            }
          },
        ),
        aiInsight: _GuardianAiCard(insight: insight),
        timeline: selected == null
            ? null
            : _TimelineCard(
                device: selected,
                updated: deviceUpdatedLabel(selected),
                onOpen: () => _openHistory(selected),
              ),
        quickActions: quickActions,
        bottomStatus: bottomStatus,
      ),
    );
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

    final onlineCount = _devices.where((device) => device.online).length;
    final allSafe = _devices.isNotEmpty && onlineCount == _devices.length;
    final insight = buildDashboardInsight(selected);

    if (MediaQuery.sizeOf(context).width >= GuardianBreakpoints.expanded) {
      return _buildDesktopDashboard(
        selected: selected,
        center: center,
        userInitials: userInitials,
        onlineCount: onlineCount,
        allSafe: allSafe,
        insight: insight,
      );
    }

    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 820),
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Row(
                      children: [
                        const GuardianBrandMark(size: 36, iconScale: 0.58),
                        const SizedBox(width: 10),
                        const Text(
                          'Guardian',
                          style: _dashboardHeaderTitleStyle,
                        ),
                        const Spacer(),
                        IconButton(
                          onPressed: () {},
                          icon: const Icon(Icons.notifications_none_rounded),
                          tooltip: 'Notifications',
                        ),
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
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 24),
                  sliver: SliverList.list(
                    children: [
                      _SafetyHero(
                        safe: allSafe,
                        onlineCount: onlineCount,
                        totalCount: _devices.length,
                        updated: selected == null
                            ? 'Waiting for a linked device'
                            : deviceUpdatedLabel(selected),
                      ),
                      const SizedBox(height: 10),
                      _LiveStatusBar(device: selected),
                      const SizedBox(height: 12),
                      SizedBox(
                        height: 300,
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(24),
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
                                  label: selected?.online == true
                                      ? '● Live'
                                      : 'Map',
                                  tone: selected?.online == true
                                      ? PillTone.safe
                                      : PillTone.neutral,
                                ),
                              ),
                              if (selected != null)
                                Positioned(
                                  left: 14,
                                  right: 14,
                                  bottom: 14,
                                  child: _FloatingDeviceCard(
                                    device: selected,
                                    updated: deviceUpdatedLabel(selected),
                                    onOpen: () => _openHistory(selected),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ),
                      if (_devices.isNotEmpty) ...[
                        const SizedBox(height: 18),
                        const _SectionTitle(title: 'My devices'),
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
                              );
                            },
                          ),
                        ),
                      ],
                      const SizedBox(height: 18),
                      _GuardianAiCard(insight: insight),
                      if (selected != null) ...[
                        const SizedBox(height: 18),
                        const _SectionTitle(title: 'Device status'),
                        const SizedBox(height: 10),
                        Row(
                          children: [
                            Expanded(
                              child: _InfoTile(
                                icon: Icons.battery_5_bar_rounded,
                                value: selected.batteryPercent == null
                                    ? '—'
                                    : '${selected.batteryPercent}%',
                                label: 'Battery',
                                metric: DashboardFlagMetric.battery,
                                active: dashboardBatteryHealthy(
                                  selected.batteryPercent,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _InfoTile(
                                icon: Icons.speed_rounded,
                                value: selected.isMoving
                                    ? '${selected.speedKmh}'
                                    : '—',
                                label: 'km/h',
                                color: GuardianColors.accent,
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: _InfoTile(
                                icon: Icons.gps_fixed_rounded,
                                value: selected.hasFreshLocation
                                    ? 'Active'
                                    : 'Waiting',
                                label: 'GPS',
                                metric: DashboardFlagMetric.gps,
                                active: selected.hasFreshLocation,
                              ),
                            ),
                          ],
                        ),
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
      ),
    );
  }
}

const _dashboardHeaderTitleStyle = TextStyle(
  fontSize: 22,
  fontWeight: FontWeight.w800,
);

class _GuardianSloganText extends StatelessWidget {
  const _GuardianSloganText();

  static const _style = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.bold,
  );

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        style: _style,
        children: const [
          TextSpan(
            text: 'Know ',
            style: TextStyle(color: GuardianColors.flagRed),
          ),
          TextSpan(
            text: 'they ',
            style: TextStyle(color: GuardianColors.flagBlue),
          ),
          TextSpan(
            text: 'are ',
            style: TextStyle(color: GuardianColors.flagYellow),
          ),
          TextSpan(
            text: 'safe',
            style: TextStyle(color: GuardianColors.flagGreen),
          ),
        ],
      ),
    );
  }
}

class _DesktopTopBar extends StatelessWidget {
  const _DesktopTopBar({
    required this.userInitials,
  });

  final String userInitials;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44,
      child: Row(
        children: [
          Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Guardian', style: _dashboardHeaderTitleStyle),
              const _GuardianSloganText(),
            ],
          ),
          const Spacer(),
          IconButton(
            onPressed: () {},
            icon: const Icon(Icons.notifications_none_rounded),
            tooltip: 'Notifications',
          ),
          const SizedBox(width: 8),
          GuardianHeaderAvatar(
            initials: userInitials,
            color: context.guardianColors.accent,
            size: 38,
          ),
        ],
      ),
    );
  }
}

class _DesktopDevicesCard extends StatelessWidget {
  const _DesktopDevicesCard({
    required this.devices,
    required this.selectedImei,
    required this.onSelect,
  });

  final List<Device> devices;
  final String? selectedImei;
  final ValueChanged<Device> onSelect;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return GuardianCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'My devices',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                ),
              ),
              Text(
                '${devices.where((device) => device.online).length} online',
                style: TextStyle(
                  fontSize: 9,
                  color: colors.textMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: devices.isEmpty
                ? Center(
                    child: Text(
                      'No devices linked',
                      style: TextStyle(color: colors.textMuted),
                    ),
                  )
                : ListView.separated(
                    padding: EdgeInsets.zero,
                    itemCount: devices.length,
                    separatorBuilder: (_, _) => const Divider(height: 8),
                    itemBuilder: (context, index) {
                      final device = devices[index];
                      final selected = device.imei == selectedImei;
                      final relation =
                          device.displayName != device.relationshipLabel
                          ? '${device.relationshipLabel} • '
                          : '';
                      return Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: selected
                              ? colors.accentMuted
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            AvatarBubble(
                              initials: initialsFor(device.displayName),
                              color: avatarColorForKey(device.imei),
                              size: 34,
                              imageUrl: device.avatarUrl,
                            ),
                            const SizedBox(width: 5),
                            Expanded(
                              child: InkWell(
                                onTap: () => onSelect(device),
                                borderRadius: BorderRadius.circular(10),
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 4,
                                    vertical: 7,
                                  ),
                                  child: Row(
                                    children: [
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              device.displayName,
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                fontSize: 11,
                                                fontWeight: FontWeight.w700,
                                              ),
                                            ),
                                            Text(
                                              device.online
                                                  ? '$relation● Online • GPS ${device.hasFreshLocation ? 'active' : 'waiting'}'
                                                  : '$relation○ Offline',
                                              style: TextStyle(
                                                fontSize: 9,
                                                color: device.online
                                                    ? colors.accent
                                                    : colors.textMuted,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        device.batteryPercent == null
                                            ? '—'
                                            : '${device.batteryPercent}%',
                                        style: const TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _SafetyHero extends StatelessWidget {
  const _SafetyHero({
    required this.safe,
    required this.onlineCount,
    required this.totalCount,
    required this.updated,
  });

  final bool safe;
  final int onlineCount;
  final int totalCount;
  final String updated;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final title = totalCount == 0
        ? 'Let’s connect someone you care about'
        : safe
        ? 'Everyone you care about is safe'
        : 'A device needs your attention';
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: colors.textPrimary.withValues(alpha: 0.07),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 58,
            height: 58,
            decoration: BoxDecoration(
              color: safe ? GuardianColors.safeBg : GuardianColors.warningBg,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Icon(
              safe ? Icons.verified_user_rounded : Icons.shield_outlined,
              size: 32,
              color: safe ? GuardianColors.safe : GuardianColors.warning,
            ),
          ),
          const SizedBox(width: 14),
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
                    fontSize: 16,
                    height: 1.2,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  totalCount == 0
                      ? 'No linked devices'
                      : '$onlineCount online  •  ${totalCount - onlineCount} offline',
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
  const _LiveStatusBar({required this.device});

  final Device? device;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final connected = device?.online == true;
    final gps = device?.hasFreshLocation == true;
    final battery = device?.batteryPercent;
    final batteryHealthy = dashboardBatteryHealthy(battery);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        children: [
          _LiveMetric(
            metric: DashboardFlagMetric.connectivity,
            icon: Icons.sensors_rounded,
            label: connected ? 'Live' : 'Offline',
            active: connected,
          ),
          _LiveMetric(
            metric: DashboardFlagMetric.gps,
            icon: Icons.gps_fixed_rounded,
            label: gps ? 'GPS active' : 'GPS waiting',
            active: gps,
          ),
          _LiveMetric(
            metric: DashboardFlagMetric.battery,
            icon: Icons.battery_5_bar_rounded,
            label: battery == null ? 'Battery —' : '$battery%',
            active: batteryHealthy,
          ),
          _LiveMetric(
            metric: DashboardFlagMetric.signal,
            icon: Icons.signal_cellular_alt_rounded,
            label: connected ? 'Connected' : 'No signal',
            active: connected,
          ),
        ],
      ),
    );
  }
}

class _LiveMetric extends StatelessWidget {
  const _LiveMetric({
    required this.metric,
    required this.icon,
    required this.label,
    required this.active,
  });

  final DashboardFlagMetric metric;
  final IconData icon;
  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = flagMetricColors(metric, active);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
          decoration: BoxDecoration(
            color: colors.background,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 17, color: colors.foreground),
              const SizedBox(height: 3),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 9,
                  color: colors.foreground,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w600,
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
    _map = _buildMap(widget);
  }

  Object _propsKey(_StableGoogleMap config) {
    return Object.hash(
      config.markers,
      config.circles,
      config.myLocationEnabled,
      config.zoomControlsEnabled,
    );
  }

  Widget _buildMap(_StableGoogleMap config) {
    return GoogleMap(
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

class _FloatingDeviceCard extends StatelessWidget {
  const _FloatingDeviceCard({
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
    final batteryMetric = flagMetricColors(
      DashboardFlagMetric.battery,
      dashboardBatteryHealthy(device.batteryPercent),
    );
    return Material(
      color: colors.surface.withValues(alpha: 0.96),
      borderRadius: BorderRadius.circular(18),
      elevation: 6,
      shadowColor: colors.textPrimary.withValues(alpha: 0.15),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Container(
                  width: 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: device.online
                        ? colors.accent
                        : colors.textMuted,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 6),
                Text(
                  device.online ? 'Live' : 'Offline',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: device.online
                        ? colors.accent
                        : colors.textMuted,
                  ),
                ),
                const Spacer(),
                Icon(
                  Icons.more_horiz_rounded,
                  size: 18,
                  color: colors.textSecondary,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                AvatarBubble(
                  initials: initialsFor(device.displayName),
                  color: avatarColorForKey(device.imei),
                  size: 38,
                  imageUrl: device.avatarUrl,
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    device.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Icon(
                  Icons.star_border_rounded,
                  size: 18,
                  color: colors.textSecondary,
                ),
              ],
            ),
            if (device.displayName != device.relationshipLabel)
              Text(
                device.relationshipLabel,
                style: TextStyle(
                  fontSize: 10,
                  color: colors.textSecondary,
                ),
              ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  deviceMovementLabel(device),
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: device.isMoving
                        ? colors.accent
                        : device.online
                            ? colors.textSecondary
                            : colors.textMuted,
                  ),
                ),
                if (device.isMoving && device.speedKmh != null) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6),
                    child: Text(
                      '•',
                      style: TextStyle(color: colors.textMuted),
                    ),
                  ),
                  Text(
                    '${device.speedKmh} km/h',
                    style: TextStyle(
                      fontSize: 10,
                      color: colors.textSecondary,
                    ),
                  ),
                ],
              ],
            ),
            Text(
              updated,
              style: TextStyle(
                fontSize: 9,
                color: colors.textMuted,
              ),
            ),
            Divider(height: 16, color: colors.border),
            Row(
              children: [
                Icon(
                  Icons.battery_5_bar_rounded,
                  size: 15,
                  color: batteryMetric.foreground,
                ),
                const SizedBox(width: 5),
                Text(
                  device.batteryPercent == null
                      ? 'Battery unavailable'
                      : '${device.batteryPercent}% Battery',
                  style: TextStyle(
                    fontSize: 10,
                    color: colors.textSecondary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 9),
            SizedBox(
              width: double.infinity,
              height: 34,
              child: FilledButton(
                onPressed: onOpen,
                style: FilledButton.styleFrom(
                  elevation: 0,
                  backgroundColor: colors.accentMuted,
                  foregroundColor: colors.textPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text(
                      'View details',
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Icon(
                      Icons.chevron_right_rounded,
                      size: 16,
                      color: colors.accent,
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
  });

  final Device device;
  final bool selected;
  final String updated;
  final VoidCallback onTap;
  final VoidCallback onRename;

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
                  '${device.online ? '● Online' : '○ Offline'}'
                  '${device.displayName != device.relationshipLabel ? '  •  ${device.relationshipLabel}' : ''}',
                  style: TextStyle(
                    fontSize: 11,
                    color: device.online
                        ? colors.accent
                        : colors.textMuted,
                  ),
                ),
                const Spacer(),
                Text(
                  '${device.hasFreshLocation ? 'GPS active' : 'GPS waiting'}  •  $updated',
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
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [colors.surface, background.withValues(alpha: 0.72)],
        ),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GuardianAiIcon(
            size: 44,
            backgroundColor: background,
            accentColor: color,
            warning: warning,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Guardian AI',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 5),
                Text(
                  insight.title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  insight.detail,
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.45,
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

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.value,
    required this.label,
    this.color,
    this.metric,
    this.active = true,
  }) : assert(color != null || metric != null);

  final IconData icon;
  final String value;
  final String label;
  final Color? color;
  final DashboardFlagMetric? metric;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final iconColor = metric == null
        ? color!
        : flagMetricColors(metric!, active).foreground;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
      decoration: BoxDecoration(
        color: metric == null
            ? colors.surface
            : flagMetricColors(metric!, active).background,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [
          BoxShadow(
            color: colors.textPrimary.withValues(alpha: 0.04),
            blurRadius: 14,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: Column(
        children: [
          Icon(icon, size: 21, color: iconColor),
          const SizedBox(height: 7),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14,
              fontWeight: active ? FontWeight.w700 : FontWeight.w600,
              color: metric == null ? colors.textPrimary : iconColor,
            ),
          ),
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              color: colors.textMuted,
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
                      device.hasFreshLocation
                          ? 'Latest position received'
                          : 'Waiting for a position',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
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
        height: 82,
        decoration: BoxDecoration(
          color: GuardianColors.dangerBg,
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: GuardianColors.danger.withValues(alpha: 0.22),
          ),
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
                    width: 48,
                    height: 48,
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
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
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
