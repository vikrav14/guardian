import 'package:flutter/material.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_v2_ui.dart';
import 'package:guardian/theme/app_theme.dart';

// Invented outing and locations. No account, Firebase, or routing requests.
JourneyRecord journeyFixture({
  String id = 'morning',
  int hour = 9,
  bool confirmedReturn = true,
}) {
  final start = DateTime(2026, 10, 7, hour, 10);
  const coords = [
    (-20.0200, 57.5800),
    (-20.0200, 57.5820),
    (-20.0180, 57.5820),
    (-20.0160, 57.5820),
    (-20.0160, 57.5840),
    (-20.0160, 57.5860),
    (-20.0160, 57.5860),
    (-20.0160, 57.5860),
    (-20.0160, 57.5860),
    (-20.0180, 57.5860),
    (-20.0200, 57.5860),
    (-20.0200, 57.5840),
    (-20.0200, 57.5820),
    (-20.0200, 57.5800),
  ];
  final end = start.add(const Duration(minutes: 52));
  return JourneyRecord(
    id: id,
    startAt: start,
    endAt: end,
    polyline: _encode(coords),
    distanceKm: 2.1,
    pointCount: coords.length,
    closeReason: confirmedReturn ? 'return_to_origin' : 'timeout',
    originGeofenceName: 'Home',
    departureAt: start,
    returnAt: confirmedReturn ? end : null,
    evidenceVersion: 3,
    routeStartAnchored: true,
    pointEvidence: [
      for (var i = 0; i < coords.length; i++)
        JourneyPointEvidence(
          offsetMs: i * 4 * 60 * 1000,
          source: 'gps',
          gpsValid: true,
        ),
    ],
    stopCount: 1,
    stops: [
      JourneyStop(
        id: 'garden',
        startAt: start.add(const Duration(minutes: 20)),
        endAt: start.add(const Duration(minutes: 32)),
        durationMinutes: 12,
        centerLat: -20.016,
        centerLng: 57.586,
        pointStartIndex: 5,
        pointEndIndex: 8,
        placeName: 'Sample garden',
      ),
    ],
  );
}

String _encode(List<(double, double)> coords) {
  final result = StringBuffer();
  var lastLat = 0;
  var lastLng = 0;
  void write(int delta) {
    var value = delta < 0 ? ~(delta << 1) : delta << 1;
    while (value >= 0x20) {
      result.writeCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    result.writeCharCode(value + 63);
  }

  for (final coordinate in coords) {
    final lat = (coordinate.$1 * 1e5).round();
    final lng = (coordinate.$2 * 1e5).round();
    write(lat - lastLat);
    write(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return result.toString();
}

Widget journeyFixtureHost({
  List<JourneyRecord>? journeys,
  GuardianThemeId themeId = GuardianThemeId.islandGlass,
  double textScale = 1,
  String? fontFamily,
  GlobalKey? boundaryKey,
}) {
  final records =
      journeys ?? [journeyFixture(), journeyFixture(id: 'afternoon', hour: 14)];
  final colors = themeId.semanticColors;
  final action = guardianActionColor(colors, themeId.brightness);
  var selected = records.isEmpty ? null : records.first;
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      brightness: themeId.brightness,
      fontFamily: fontFamily,
      scaffoldBackgroundColor: colors.canvas,
      extensions: [colors],
      colorScheme: ColorScheme.fromSeed(
        seedColor: colors.accent,
        brightness: themeId.brightness,
        primary: action,
        onPrimary: themeId.brightness == Brightness.dark
            ? colors.canvas
            : Colors.white,
        surface: colors.surface,
      ),
    ),
    builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        textScaler: TextScaler.linear(textScale),
        highContrast: themeId.isHighContrast,
      ),
      child: child!,
    ),
    home: RepaintBoundary(
      key: boundaryKey,
      child: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: StatefulBuilder(
              builder: (context, setState) => JourneyV2Dashboard(
                deviceName: 'Alex Morgan',
                day: DateTime(2026, 10, 7),
                journeys: records,
                selected: selected,
                onSelectJourney: (value) => setState(() => selected = value),
                onBack: () {},
                onChooseDay: () {},
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
