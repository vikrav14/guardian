import 'package:flutter/material.dart';
import 'package:guardian/dashboard/device_formatters.dart';
import 'package:guardian/models/device.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/widgets/brand/guardian_pin_logo.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/dashboard/guardian_dashboard_overview.dart';

// Synthetic presentation data only: no account, Firebase or map connection.
Device dashboardFixtureDevice({
  DateTime? now,
  String imei = 'demo-watch-a',
  String name = 'Alex Morgan',
  bool retainedGps = true,
}) {
  final current = now ?? DateTime.now();
  final satellite = DeviceLocation(
    lat: -20.1,
    lng: 57.5,
    source: 'gps',
    gpsValid: true,
    recordedAt: current.subtract(const Duration(minutes: 13)),
    satellites: 7,
    placeLabel: 'Sample garden',
    accuracyMeters: 12,
  );
  final network = DeviceLocation(
    lat: -20.2,
    lng: 57.6,
    source: 'wifi',
    gpsValid: false,
    recordedAt: current.subtract(const Duration(seconds: 15)),
    placeLabel: 'Sample network estimate',
    accuracyMeters: 550,
  );
  return Device(
    imei: imei,
    nickname: name,
    online: true,
    connectionState: 'live',
    careProfile: 'senior',
    lastHeartbeatAt: current.subtract(const Duration(minutes: 1)),
    updatedAt: current,
    batteryPercent: 78,
    batteryUpdatedAt: current.subtract(const Duration(minutes: 1)),
    accuracySource: retainedGps ? 'wifi' : 'gps',
    location: retainedGps ? network : satellite,
    lastLocationObservation: retainedGps ? network : satellite,
    lastSatelliteLocation: satellite,
    lastApproximateLocation: retainedGps ? network : null,
  );
}

const dashboardFixtureZone = Geofence(
  id: 'demo-zone-a',
  imei: 'demo-watch-a',
  name: 'Sample garden',
  active: true,
  lat: -20.1,
  lng: 57.5,
  radiusMeters: 100,
);

const dashboardFixtureInsight =
    'The watch is connected. The map keeps the last reliable GPS position '
    'while the newer network estimate remains approximate.';

GuardianDashboardOverview dashboardFixtureOverview({
  Device? device,
  List<Device>? devices,
  List<Geofence> geofences = const [dashboardFixtureZone],
  bool empty = false,
  bool loading = false,
  bool hasError = false,
  bool aiEnabled = true,
  bool helpEnabled = true,
  bool careEnabled = false,
  ValueChanged<String>? onSelect,
  VoidCallback? onCall,
  VoidCallback? onJourney,
  VoidCallback? onHelp,
  VoidCallback? onWatchStatus,
  VoidCallback? onLocationDetails,
  VoidCallback? onSafeZones,
  VoidCallback? onLinkWatch,
  List<Widget> serviceSections = const [],
  String? mapStatus,
}) {
  final selected = empty ? null : device ?? dashboardFixtureDevice();
  return GuardianDashboardOverview(
    device: selected,
    devices: devices ?? (selected == null ? const [] : [selected]),
    geofences: geofences,
    map: const DashboardFixtureMap(),
    mapStatus:
        mapStatus ??
        (selected == null ? '' : deviceMapLocationStatusLabel(selected)),
    insight: dashboardFixtureInsight,
    aiEnabled: aiEnabled,
    helpEnabled: helpEnabled,
    careEnabled: careEnabled,
    todaySummary: 'No recorded journeys in this sample.',
    activityStatus: 'No activity reading in this sample.',
    loading: loading,
    hasError: hasError,
    onSelect: onSelect ?? (_) {},
    onCall: onCall,
    onJourney: onJourney,
    onHelp: onHelp,
    onWatchStatus: onWatchStatus,
    onLocationDetails: onLocationDetails,
    onSafeZones: onSafeZones,
    onLinkWatch: onLinkWatch,
    serviceSections: serviceSections,
  );
}

/// Deliberately neutral: preview readers must not mistake this for a real map.
class DashboardFixtureMap extends StatelessWidget {
  const DashboardFixtureMap({super.key});

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return SizedBox(
      key: const ValueKey('dashboard-fixture-map'),
      // Match the real dashboard map viewport so layout checks use its budget.
      height: MediaQuery.sizeOf(context).width < 600 ? 210 : 380,
      child: ColoredBox(
        color: colors.surfaceMuted,
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.map_outlined, size: 40, color: colors.textSecondary),
                const SizedBox(height: 12),
                Text(
                  'Test map · no live location data',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: colors.textSecondary, fontSize: 14),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Widget dashboardFixtureHost(
  Widget child, {
  bool dark = false,
  double textScale = 1,
  String? fontFamily,
  GlobalKey? boundaryKey,
  bool viewport = false,
}) {
  final colors = dark ? GuardianThemeColors.dark : GuardianThemeColors.light;
  final brightness = dark ? Brightness.dark : Brightness.light;
  final content = ColoredBox(
    color: colors.canvas,
    child: Padding(padding: const EdgeInsets.all(16), child: child),
  );
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    theme: ThemeData(
      useMaterial3: true,
      brightness: brightness,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: colors.canvas,
      extensions: [colors],
      colorScheme: ColorScheme.fromSeed(
        seedColor: colors.accent,
        brightness: brightness,
        surface: colors.surface,
      ),
    ),
    builder: (context, app) => MediaQuery(
      data: MediaQuery.of(
        context,
      ).copyWith(textScaler: TextScaler.linear(textScale)),
      child: app!,
    ),
    home: viewport
        ? RepaintBoundary(
            key: boundaryKey,
            child: Scaffold(
              appBar: AppBar(
                toolbarHeight: 60,
                backgroundColor: colors.surface,
                title: const Row(
                  children: [
                    GuardianPinMark(size: 32),
                    SizedBox(width: 8),
                    GuardianWordmark(fontSize: 20),
                  ],
                ),
                actions: [
                  IconButton(
                    tooltip: 'Notifications',
                    onPressed: () {},
                    icon: const Icon(Icons.notifications_none_rounded),
                  ),
                ],
              ),
              bottomNavigationBar: MobileBottomBar(
                currentIndex: 0,
                onTap: (_) {},
                onSos: () {},
              ),
              body: SingleChildScrollView(child: content),
            ),
          )
        : Scaffold(
            body: SingleChildScrollView(
              child: boundaryKey == null
                  ? content
                  : RepaintBoundary(key: boundaryKey, child: content),
            ),
          ),
  );
}
