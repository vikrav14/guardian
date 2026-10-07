import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
// Exercise the app's locked Maps platform boundary without a new dependency.
// ignore: depend_on_referenced_packages
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:guardian/journey/journey_models.dart';
import 'package:guardian/journey/journey_replay_overlay.dart';
import 'package:guardian/journey/journey_v2_data.dart';
import 'package:guardian/journey/journey_v2_static_map.dart';
import 'package:guardian/models/location_history_point.dart';

class _Maps extends MethodChannelGoogleMapsFlutter {
  final created = <int>{};
  final disposed = <int>[];
  int updates = 0;
  int projections = 0;
  int inFlightProjections = 0;
  int maxInFlightProjections = 0;
  Completer<ScreenCoordinate>? pendingProjection;
  Completer<void>? pendingCamera;

  @override
  Widget buildViewWithConfiguration(
    int creationId,
    PlatformViewCreatedCallback onPlatformViewCreated, {
    required MapWidgetConfiguration widgetConfiguration,
    MapConfiguration mapConfiguration = const MapConfiguration(),
    MapObjects mapObjects = const MapObjects(),
  }) {
    if (created.add(creationId)) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        onPlatformViewCreated(creationId);
      });
    }
    return const ColoredBox(color: Colors.grey);
  }

  @override
  Future<void> init(int mapId) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          MethodChannel('plugins.flutter.io/google_maps_$mapId'),
          (_) async {
            updates++;
            return null;
          },
        );
    return super.init(mapId);
  }

  @override
  Future<ScreenCoordinate> getScreenCoordinate(
    LatLng position, {
    required int mapId,
  }) async {
    projections++;
    inFlightProjections++;
    if (inFlightProjections > maxInFlightProjections) {
      maxInFlightProjections = inFlightProjections;
    }
    try {
      return await (pendingProjection?.future ??
          Future.value(const ScreenCoordinate(x: 200, y: 300)));
    } finally {
      inFlightProjections--;
    }
  }

  @override
  Future<void> animateCamera(CameraUpdate update, {required int mapId}) =>
      pendingCamera?.future ?? Future.value();

  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {
    this.updates++;
  }

  @override
  Stream<GroundOverlayTapEvent> onGroundOverlayTap({required int mapId}) =>
      const Stream.empty();

  @override
  void dispose({required int mapId}) {
    disposed.add(mapId);
    super.dispose(mapId: mapId);
  }
}

JourneyV2Route _route([int count = 3]) {
  final start = DateTime(2026, 9, 25, 18);
  final points = List.generate(
    count,
    (index) => LocationHistoryPoint(
      lat: -20.02 - index * 0.001,
      lng: 57.59 + index * 0.001,
      recordedAt: start.add(Duration(seconds: index * 30)),
      source: 'gps',
      gpsValid: true,
    ),
  );
  return JourneyV2Route(
    record: JourneyRecord(
      id: 'runtime-trip',
      startAt: start,
      endAt: start.add(Duration(seconds: count * 30)),
      polyline: '',
      distanceKm: 1,
      pointCount: count,
    ),
    rawPoints: points,
    usablePoints: points,
  );
}

Widget _host(JourneyV2Route route, {int index = 0}) => MaterialApp(
  home: MediaQuery(
    data: const MediaQueryData(devicePixelRatio: 2),
    child: Scaffold(
      body: SizedBox(
        width: 320,
        height: 400,
        child: JourneyV2StaticMap(
          route: route,
          currentIndex: index,
          showReplayPosition: true,
          deviceName: 'Test',
          onPointSelected: (_) {},
        ),
      ),
    ),
  ),
);

Future<void> _pumpMap(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  late GoogleMapsFlutterPlatform previous;
  late _Maps maps;
  setUp(() {
    previous = GoogleMapsFlutterPlatform.instance;
    GoogleMapsFlutterPlatform.instance = maps = _Maps();
  });
  tearDown(() {
    GoogleMapsFlutterPlatform.instance = previous;
  });

  testWidgets(
    'idle person label and movement do not flood native map updates',
    (tester) async {
      final route = _route(1200);
      await tester.pumpWidget(_host(route));
      await _pumpMap(tester);
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      expect(map.circles.length, lessThan(10));
      expect(map.gestureRecognizers.single.type, EagerGestureRecognizer);
      expect(
        map.markers,
        isEmpty,
        reason: 'No default pins while custom labels load.',
      );
      expect(find.text('Test'), findsOneWidget);
      expect(find.text(' · 18:00'), findsOneWidget);
      final idleUpdates = maps.updates;
      final idleProjections = maps.projections;
      for (var i = 0; i < 180; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(maps.updates, idleUpdates);
      expect(maps.projections, idleProjections);

      await tester.pumpWidget(_host(route, index: 1));
      await _pumpMap(tester);
      final replayUpdates = maps.updates;
      final replayProjections = maps.projections;
      for (var i = 0; i < 60; i++) {
        await tester.pump(const Duration(milliseconds: 16));
      }
      expect(maps.updates, replayUpdates);
      expect(maps.projections, replayProjections);
      expect(
        tester.binding.transientCallbackCount,
        0,
        reason: 'A paused wearer marker must not pulse.',
      );
      final overlay = tester.widget<JourneyReplayOverlay>(
        find.byType(JourneyReplayOverlay),
      );
      expect(
        overlay.position,
        LatLng(route.usablePoints[1].lat, route.usablePoints[1].lng),
      );
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
      expect(maps.disposed, maps.created.toList());
    },
  );

  testWidgets(
    'coalesces camera projection and ignores completion after disposal',
    (tester) async {
      maps.pendingProjection = Completer();
      maps.pendingCamera = Completer();
      await tester.pumpWidget(_host(_route()));
      await _pumpMap(tester);
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      for (var i = 0; i < 30; i++) {
        map.onCameraMove!(const CameraPosition(target: LatLng(-20, 57)));
        await tester.pump();
      }
      expect(maps.projections, 1);
      final first = maps.pendingProjection!;
      maps.pendingProjection = Completer();
      first.complete(const ScreenCoordinate(x: 100, y: 100));
      await _pumpMap(tester);
      expect(maps.projections, 2);
      expect(maps.maxInFlightProjections, 1);
      await tester.pumpWidget(const SizedBox());
      maps.pendingProjection!.complete(const ScreenCoordinate(x: 200, y: 300));
      maps.pendingCamera!.completeError(StateError('Map disposed'));
      map.onCameraIdle!();
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(maps.disposed, maps.created.toList());
    },
  );

  testWidgets(
    'Android projection uses logical pixels and overlay passes touches',
    (tester) async {
      await tester.pumpWidget(_host(_route()));
      await _pumpMap(tester);
      final overlay = find.byType(JourneyReplayOverlay);
      final marker = tester.widget<Positioned>(
        find.descendant(of: overlay, matching: find.byType(Positioned)),
      );
      expect(marker.left, 80); // 200 / DPR 2 - half the 40 pixel avatar.
      expect(marker.top, 130);
      expect(
        tester
            .widget<IgnorePointer>(
              find.descendant(
                of: overlay,
                matching: find.byType(IgnorePointer),
              ),
            )
            .ignoring,
        isTrue,
      );
      await tester.pumpWidget(const SizedBox());
      await tester.pump();
    },
  );

  test('tap lookup keeps route indexes and ignores taps outside 22 metres', () {
    final points = _route(1200).usablePoints;
    final point = points[789];
    expect(
      journeyV2NearestPointIndex(points, LatLng(point.lat, point.lng)),
      789,
    );
    expect(journeyV2NearestPointIndex(points, const LatLng(0, 0)), isNull);
  });
}
