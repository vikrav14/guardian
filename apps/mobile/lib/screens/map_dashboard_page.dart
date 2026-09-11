import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:url_launcher/url_launcher.dart';

import '../dashboard/dashboard_ai_interpretation.dart';
import '../dashboard/device_connectivity.dart';
import '../dashboard/dashboard_controller.dart';
import '../dashboard/device_formatters.dart';
import '../models/device.dart';
import '../models/geofence.dart';
import '../navigation/home_shell_scope.dart';
import '../services/guardian_contact_actions.dart';
import '../services/guardian_entitlements_scope.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/dashboard/guardian_help_sheet.dart';
import '../widgets/dashboard/guardian_dashboard_overview.dart';
import '../widgets/map/guardian_map_presentation.dart';
import '../widgets/map/map_avatar_overlay.dart';
import 'journey_page.dart';

class MapDashboardPage extends StatefulWidget {
  const MapDashboardPage({super.key});

  @override
  State<MapDashboardPage> createState() => MapDashboardPageState();
}

class MapDashboardPageState extends State<MapDashboardPage> {
  late final DashboardController _dashboard;
  GoogleMapController? _mapController;
  // Keep the platform map mounted when the responsive columns rearrange.
  final GlobalKey _mapKey = GlobalKey(debugLabel: 'dashboard-map');
  final ValueNotifier<int> _mapCameraGeneration = ValueNotifier(0);

  double _zoom = 14;
  MapType _mapType = MapType.normal;
  bool _sendingHelp = false;
  bool _didInitialFit = false;

  static const LatLng _mauritius = LatLng(-20.2642, 57.4791);

  List<Device> get _devices => _dashboard.devices;
  List<Geofence> get _geofences => _dashboard.geofences;
  String? get _selectedImei => _dashboard.selectedImei;
  Device? get _selected => _dashboard.selected;

  @override
  void initState() {
    super.initState();
    _dashboard = DashboardController()
      ..addListener(_onDashboardChanged)
      ..start();
  }

  void _onDashboardChanged() {
    if (!mounted) return;
    setState(() {});
    _followSelected();
  }

  @override
  void dispose() {
    _dashboard
      ..removeListener(_onDashboardChanged)
      ..dispose();
    _mapCameraGeneration.dispose();
    if (!kIsWeb) {
      _mapController?.dispose();
    }
    super.dispose();
  }

  List<Geofence> get _selectedGeofences {
    final imei = _selectedImei;
    if (imei == null) return const [];
    return _geofences
        .where(
          (zone) =>
              zone.active &&
              zone.imei == imei &&
              !(zone.lat == 0 && zone.lng == 0),
        )
        .toList(growable: false);
  }

  Set<Circle> _circles() {
    final selected = _selected;
    final approximate = selected?.latestLocationObservation;
    final uncertaintyRadius = selected?.hasApproximateLocation == true
        ? approximate?.accuracyMeters
        : null;
    return {
      for (final zone in _selectedGeofences)
        Circle(
          circleId: CircleId(zone.id),
          center: LatLng(zone.lat, zone.lng),
          radius: zone.radiusMeters,
          fillColor: GuardianColors.safe.withValues(alpha: 0.16),
          strokeColor: GuardianColors.safe.withValues(alpha: 0.72),
          strokeWidth: 2,
          zIndex: 1,
        ),
      if (approximate?.isValid == true &&
          uncertaintyRadius != null &&
          uncertaintyRadius > 0)
        Circle(
          circleId: const CircleId('display-location-uncertainty'),
          center: LatLng(approximate!.lat, approximate.lng),
          radius: uncertaintyRadius,
          fillColor: GuardianColors.warning.withValues(alpha: 0.12),
          strokeColor: GuardianColors.warning.withValues(alpha: 0.62),
          strokeWidth: 2,
          zIndex: 2,
        ),
    };
  }

  Set<Marker> _nativeMarkers() {
    if (kIsWeb) return const {};
    return {
      for (final device in _devices)
        if (device.mapDisplayLocation?.isValid == true)
          Marker(
            markerId: MarkerId(device.imei),
            position: LatLng(
              device.mapDisplayLocation!.lat,
              device.mapDisplayLocation!.lng,
            ),
            zIndexInt: device.imei == _selectedImei ? 2 : 1,
            alpha: device.isTrulyOffline ? 0.55 : 1,
            onTap: () => _dashboard.select(device.imei),
          ),
    };
  }

  LatLng get _mapCenter {
    final location = _selected?.mapDisplayLocation;
    if (location?.isValid == true) {
      return LatLng(location!.lat, location.lng);
    }
    return _mauritius;
  }

  Future<void> _animateTo(LatLng target, {double? zoom}) async {
    final controller = _mapController;
    if (controller == null || _mapKey.currentContext == null) return;
    final nextZoom = zoom ?? _zoom;
    _mapCameraGeneration.value++;
    await controller.animateCamera(
      CameraUpdate.newLatLngZoom(target, nextZoom),
    );
    if (mounted && identical(controller, _mapController)) {
      _zoom = nextZoom;
      _mapCameraGeneration.value++;
    }
  }

  void _followSelected() {
    final location = _selected?.mapDisplayLocation;
    final controller = _mapController;
    if (controller == null ||
        _mapKey.currentContext == null ||
        location?.isValid != true) {
      return;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final currentLocation = _selected?.mapDisplayLocation;
      if (!mounted ||
          _mapKey.currentContext == null ||
          !identical(controller, _mapController) ||
          currentLocation?.isValid != true) {
        return;
      }
      unawaited(
        _animateTo(
          LatLng(currentLocation!.lat, currentLocation.lng),
          zoom: _didInitialFit ? _zoom : 15,
        ),
      );
      _didInitialFit = true;
    });
  }

  VoidCallback? _centerSelectedAction() {
    final location = _selected?.mapDisplayLocation;
    if (location?.isValid != true) return null;
    return () =>
        unawaited(_animateTo(LatLng(location!.lat, location.lng), zoom: 16));
  }

  Future<void> _changeMapZoom(double delta) async {
    final controller = _mapController;
    if (controller == null || _mapKey.currentContext == null) return;
    final next = (_zoom + delta).clamp(3.0, 20.0).toDouble();
    _zoom = next;
    _mapCameraGeneration.value++;
    await controller.animateCamera(CameraUpdate.zoomTo(next));
    if (mounted && identical(controller, _mapController)) {
      _mapCameraGeneration.value++;
    }
  }

  void _toggleMapType() {
    setState(() {
      _mapType = _mapType == MapType.normal ? MapType.hybrid : MapType.normal;
    });
  }

  String _mapStatus(Device device) {
    if (device.isReconnecting) return 'Reconnecting';
    if (device.isTrulyOffline) return 'Last known';
    if (device.isMapDisplayingLastSatelliteLocation) {
      return 'Last reliable fix';
    }
    if (device.hasApproximateLocation) return 'Approximate area';
    if (device.hasFreshLocation && device.displayLocationSource == 'gps') {
      return 'Satellite GPS';
    }
    if (device.displayLocation?.isValid == true) return 'Last known';
    return 'Locating';
  }

  Future<void> _sendHelp(Device device) async {
    if (_sendingHelp) return;
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
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not send alert: $error')));
      }
    } finally {
      if (mounted) setState(() => _sendingHelp = false);
    }
  }

  void sendHelpFromNavigation() {
    final selected = _selected;
    if (selected == null) {
      _showUnavailable('No watch is available for an SOS alert.');
      return;
    }
    unawaited(_sendHelp(selected));
  }

  Future<void> _callDevice(Device device) async {
    final sim = device.simNumber?.trim();
    if (sim == null || sim.isEmpty) {
      _showUnavailable(
        'No SIM number is saved for this watch yet. Add it in the watch settings first.',
      );
      return;
    }
    if (!isMobileGuardianPlatform) {
      await _showCallHandoff(device, sim);
      return;
    }
    final uri = Uri(scheme: 'tel', path: sim);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication) &&
        mounted) {
      _showUnavailable('Could not start a call to $sim.');
    }
  }

  Future<void> _showCallHandoff(Device device, String sim) {
    return showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Call ${device.displayName}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SelectableText(
              sim,
              style: Theme.of(dialogContext).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            const Text(
              'This is a normal voice call to the watch. It does not use the watch\'s 500MB mobile-data allowance; normal voice charges may apply.',
            ),
            if (!device.isLiveConnected) ...[
              const SizedBox(height: 10),
              const Text(
                'The watch has not checked in recently. Voice may still work if it has mobile network coverage.',
              ),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          TextButton.icon(
            onPressed: () {
              unawaited(Clipboard.setData(ClipboardData(text: sim)));
              Navigator.pop(dialogContext);
              _showUnavailable('Watch number copied. Call it from your phone.');
            },
            icon: const Icon(Icons.copy_rounded),
            label: const Text('Copy number'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              unawaited(_tryDesktopCall(sim));
            },
            child: const Text('Try this device'),
          ),
        ],
      ),
    );
  }

  Future<void> _tryDesktopCall(String sim) async {
    final opened = await launchUrl(
      Uri(scheme: 'tel', path: sim),
      mode: LaunchMode.externalApplication,
    );
    if (!opened && mounted) {
      _showUnavailable('No calling app handled the number. Copy it instead.');
    }
  }

  void _showQuickFact(String title, String message) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  void _showLocationFact(Device device) {
    final location = device.mapDisplayLocation;
    if (location?.isValid != true) {
      _showQuickFact(
        '${device.displayName}\'s location',
        'Guardian does not have a recorded location for ${device.displayName} yet.',
      );
      return;
    }
    final place = location?.placeLabel?.trim();
    final label = place == null || place.isEmpty
        ? 'the position shown on the map'
        : place;
    if (device.isMapDisplayingLastSatelliteLocation) {
      final approximate = device.latestLocationObservation;
      final radius = approximate?.accuracyMeters;
      final radiusCopy = radius == null
          ? 'A newer indoor network estimate is available, but it is approximate.'
          : 'A newer indoor network estimate is available with an estimated radius of ${radius.round()}m.';
      _showQuickFact(
        '${device.displayName}\'s location',
        'Showing $label from the last reliable satellite fix. ${deviceMapLocationFixLabel(device)}. $radiusCopy The approximate estimate does not move the main avatar.',
      );
      return;
    }
    final quality = device.hasApproximateLocation
        ? 'approximate network location'
        : device.hasFreshLocation
        ? 'latest satellite location'
        : 'last known location';
    _showQuickFact(
      '${device.displayName}\'s location',
      '${device.displayName}\'s $quality is $label. ${deviceLocationFixLabel(device)}.',
    );
  }

  void _showWatchStatusFact(Device device) {
    final connection = device.isLiveConnected
        ? 'online now'
        : device.isReconnecting
        ? 'reconnecting'
        : 'offline';
    final battery = device.batteryPercent;
    final batteryText = battery == null
        ? 'No battery reading is available.'
        : device.isLiveConnected
        ? 'Battery is $battery%.'
        : 'The last battery reading was $battery%.';
    _showQuickFact(
      '${device.displayName}\'s watch',
      'The watch is $connection. $batteryText ${deviceWatchCheckInLabel(device)}.',
    );
  }

  void _showGuardianHelp(
    Device device, {
    required GuardianSubscription? subscription,
    required GuardianEntitlementDecision historyDecision,
  }) {
    final home = HomeShellScope.maybeOf(context);
    unawaited(
      showGuardianHelpSheet(
        context,
        deviceName: device.displayName,
        onLocation: () => _showLocationFact(device),
        onWatchStatus: () => _showWatchStatusFact(device),
        onAlerts: () {
          if (home == null) {
            _showUnavailable('Open Alerts from Guardian navigation.');
            return;
          }
          home.goToTab(2);
        },
        onJourney: () => _openHistory(
          device,
          subscription: subscription,
          decision: historyDecision,
        ),
        onWhatsApp: () => unawaited(_continueOnWhatsApp(device)),
      ),
    );
  }

  Future<void> _continueOnWhatsApp(Device device) async {
    final number = configuredGuardianWhatsAppNumber();
    if (number == null) {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Guardian WhatsApp is not configured'),
          content: const Text(
            'Quick checks remain available here. Guardian support must configure the approved business number before WhatsApp can be opened from this build.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('OK'),
            ),
          ],
        ),
      );
      return;
    }

    final message = 'Hi Guardian, I need help with ${device.displayName}.';
    if (isMobileGuardianPlatform) {
      final opened = await launchUrl(
        guardianWhatsAppMobileUri(number: number, message: message),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        _showUnavailable(
          'Could not open WhatsApp. The Guardian number is +$number.',
        );
      }
      return;
    }

    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Continue on WhatsApp'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'WhatsApp is optional. Open WhatsApp Web on this computer, or copy the Guardian number and use WhatsApp on your phone.',
            ),
            const SizedBox(height: 12),
            SelectableText(
              '+$number',
              style: Theme.of(dialogContext).textTheme.titleMedium,
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          TextButton.icon(
            onPressed: () {
              unawaited(Clipboard.setData(ClipboardData(text: '+$number')));
              Navigator.pop(dialogContext);
              _showUnavailable('Guardian WhatsApp number copied.');
            },
            icon: const Icon(Icons.copy_rounded),
            label: const Text('Copy number'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              unawaited(
                launchUrl(
                  guardianWhatsAppWebUri(number: number, message: message),
                  mode: LaunchMode.externalApplication,
                ),
              );
            },
            child: const Text('Open WhatsApp Web'),
          ),
        ],
      ),
    );
  }

  void _openHistory(
    Device device, {
    required GuardianSubscription? subscription,
    required GuardianEntitlementDecision decision,
  }) {
    if (!decision.allowed || subscription == null) {
      _showEntitlementDecision(decision);
      return;
    }
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => JourneyPage(
          imei: device.imei,
          deviceName: device.displayName,
          subscription: subscription,
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

  void _showEntitlementDecision(GuardianEntitlementDecision decision) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(decision.title),
        content: Text(decision.message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('OK'),
          ),
        ],
      ),
    );
  }

  Widget _buildMapCard(Device selected) {
    final center = _mapCenter;

    return SizedBox(
      height: MediaQuery.sizeOf(context).width < 600 ? 210 : 380,
      child: Stack(
        fit: StackFit.expand,
        children: [
          GoogleMap(
            key: _mapKey,
            initialCameraPosition: CameraPosition(target: center, zoom: 15),
            mapType: _mapType,
            markers: _nativeMarkers(),
            circles: _circles(),
            zoomControlsEnabled: false,
            myLocationButtonEnabled: false,
            myLocationEnabled: false,
            mapToolbarEnabled: false,
            compassEnabled: false,
            onMapCreated: (controller) {
              _mapController = controller;
              _mapCameraGeneration.value++;
              _didInitialFit = false;
              _followSelected();
            },
            onCameraMove: (position) {
              _zoom = position.zoom;
              _mapCameraGeneration.value++;
            },
            onCameraIdle: () => _mapCameraGeneration.value++,
          ),
          if (kIsWeb)
            ValueListenableBuilder<int>(
              valueListenable: _mapCameraGeneration,
              builder: (context, generation, _) => MapAvatarOverlay(
                controller: _mapController,
                devices: _devices,
                selectedImei: _selectedImei,
                cameraGeneration: generation,
                onSelect: _dashboard.select,
              ),
            ),
          Positioned(
            top: 18,
            right: 18,
            child: GuardianMapControlRail(
              trackedName: selected.displayName,
              onZoomIn: () => unawaited(_changeMapZoom(1)),
              onZoomOut: () => unawaited(_changeMapZoom(-1)),
              onCenterTrackedPerson: _centerSelectedAction(),
              isSatelliteView: _mapType != MapType.normal,
              onToggleSatelliteView: _toggleMapType,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDashboardContent(Device? selected) {
    final entitlementScope = GuardianEntitlementsScope.of(context);
    final home = HomeShellScope.maybeOf(context);
    final aiDecision = entitlementScope.decision(GuardianFeature.guardianAi);
    final whatsappDecision = entitlementScope.decision(
      GuardianFeature.whatsappQuestionsAnswers,
    );
    final careSummaryDecision = entitlementScope.decision(
      GuardianFeature.wellbeingActivitySummaries,
    );
    final historyDecision = entitlementScope.decision(
      GuardianFeature.locationHistory,
    );

    return GuardianDashboardOverview(
      device: selected,
      devices: _devices,
      geofences: _geofences,
      loading: _dashboard.loading,
      hasError: _dashboard.error != null,
      map: selected == null ? const SizedBox.shrink() : _buildMapCard(selected),
      mapStatus: selected == null ? '' : _mapStatus(selected),
      insight: buildGuardianAiInterpretation(selected),
      aiEnabled: aiDecision.allowed,
      helpEnabled: whatsappDecision.allowed,
      careEnabled: careSummaryDecision.allowed,
      todaySummary: buildTodaySummary(selected),
      activityStatus: buildTodayActivityStatus(selected),
      onSelect: _dashboard.select,
      onCall: selected == null ? null : () => _callDevice(selected),
      onJourney: selected == null
          ? null
          : () => _openHistory(
              selected,
              subscription: entitlementScope.subscription,
              decision: historyDecision,
            ),
      onHelp: selected == null
          ? null
          : whatsappDecision.allowed
          ? () => _showGuardianHelp(
              selected,
              subscription: entitlementScope.subscription,
              historyDecision: historyDecision,
            )
          : () => _showEntitlementDecision(whatsappDecision),
      onWatchStatus: selected == null
          ? null
          : () => _showWatchStatusFact(selected),
      onLocationDetails: selected == null
          ? null
          : () => _showLocationFact(selected),
      onSafeZones: home == null ? null : () => home.goToTab(1),
      onLinkWatch: home == null ? null : () => home.goToTab(3),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: SafeArea(
        top: false,
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1240),
            child: LayoutBuilder(
              builder: (context, constraints) => CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: EdgeInsets.fromLTRB(
                      constraints.maxWidth < 600 ? 16 : 32,
                      constraints.maxWidth < 600 ? 12 : 28,
                      constraints.maxWidth < 600 ? 16 : 32,
                      // HomeShell reserves space for navigation and safe area.
                      24,
                    ),
                    sliver: SliverList.list(
                      children: [_buildDashboardContent(_selected)],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
