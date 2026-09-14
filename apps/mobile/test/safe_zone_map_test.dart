import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
// Test the existing locked SDK's platform boundary without adding a new package.
// ignore: depend_on_referenced_packages
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:guardian/models/geofence.dart';
import 'package:guardian/widgets/safe_zones/safe_zone_map.dart';

Geofence _zone({
  String id = 'home',
  double lat = -20.024,
  double lng = 57.591,
  double radius = 150,
  bool active = true,
}) => Geofence(
  id: id,
  imei: 'fixture-watch',
  name: 'Home',
  active: active,
  lat: lat,
  lng: lng,
  radiusMeters: radius,
);

double _distance(LatLng a, LatLng b) {
  const earthRadius = 6371008.8;
  final lat1 = a.latitude * math.pi / 180;
  final lat2 = b.latitude * math.pi / 180;
  final latDelta = lat2 - lat1;
  final lngDelta = (b.longitude - a.longitude) * math.pi / 180;
  final h =
      math.pow(math.sin(latDelta / 2), 2) +
      math.cos(lat1) * math.cos(lat2) * math.pow(math.sin(lngDelta / 2), 2);
  return 2 * earthRadius * math.asin(math.sqrt(h));
}

class _FakeMapPlatform extends MethodChannelGoogleMapsFlutter {
  final Set<int> created = {};
  final List<CameraUpdate> cameraUpdates = [];
  final List<int> disposed = [];
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
    return const ColoredBox(color: Color(0xFFEAF3E9));
  }

  @override
  Future<void> init(int mapId) {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
          MethodChannel('plugins.flutter.io/google_maps_$mapId'),
          (_) async => null,
        );
    return super.init(mapId);
  }

  @override
  Future<void> moveCamera(CameraUpdate update, {required int mapId}) {
    cameraUpdates.add(update);
    return pendingCamera?.future ?? Future<void>.value();
  }

  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {}

  @override
  Stream<GroundOverlayTapEvent> onGroundOverlayTap({required int mapId}) =>
      const Stream.empty();

  @override
  void dispose({required int mapId}) {
    disposed.add(mapId);
    super.dispose(mapId: mapId);
  }
}

Widget _mapHost(Geofence zone, {bool expanded = false}) {
  return MaterialApp(
    home: Scaffold(
      body: SizedBox(
        width: 320,
        height: 370,
        child: SafeZoneMap(zone: zone, expanded: expanded),
      ),
    ),
  );
}

Future<void> _settleMap(WidgetTester tester) async {
  await tester.pump();
  await tester.pump();
  await tester.pump();
}

void main() {
  test('map retains exact saved centre and radius', () {
    final zone = _zone(lat: -20.0241234, lng: 57.5912345, radius: 187.5);
    final geometry = SafeZoneMapGeometry.fromZone(zone)!;

    expect(geometry.center, LatLng(zone.lat, zone.lng));
    expect(geometry.radiusMeters, 187.5);
    expect(geometry.cameraFor(const Size(320, 240)).target, geometry.center);
  });

  test('unset centre is not rendered at the model zero-coordinate default', () {
    expect(SafeZoneMapGeometry.fromZone(_zone(lat: 0, lng: 0)), isNull);
    // A centre on either meridian alone is still valid.
    expect(SafeZoneMapGeometry.fromZone(_zone(lat: 0)), isNotNull);
    expect(SafeZoneMapGeometry.fromZone(_zone(lng: 0)), isNotNull);
  });

  test('invalid coordinates and radius never create a misleading map', () {
    final invalid = [
      _zone(lat: double.nan),
      _zone(lng: double.infinity),
      _zone(lat: -90.01),
      _zone(lat: 90.01),
      _zone(lng: -180.01),
      _zone(lng: 180.01),
      _zone(radius: 0),
      _zone(radius: -50),
      _zone(radius: double.nan),
      _zone(radius: double.infinity),
    ];
    for (final zone in invalid) {
      expect(SafeZoneMapGeometry.fromZone(zone), isNull);
    }
  });

  test('north and south bounds are a radius away at all editor sizes', () {
    for (final radius in [50.0, 150.0, 5000.0]) {
      final geometry = SafeZoneMapGeometry.fromZone(_zone(radius: radius))!;
      final north = LatLng(
        geometry.bounds.northeast.latitude,
        geometry.center.longitude,
      );
      final south = LatLng(
        geometry.bounds.southwest.latitude,
        geometry.center.longitude,
      );
      expect(_distance(geometry.center, north), closeTo(radius, 0.001));
      expect(_distance(geometry.center, south), closeTo(radius, 0.001));
      expect(geometry.bounds.contains(geometry.center), isTrue);
    }
  });

  test('narrow phone camera fits 50 to 5000 metre zones with margin', () {
    for (final radius in [50.0, 150.0, 5000.0]) {
      final geometry = SafeZoneMapGeometry.fromZone(_zone(radius: radius))!;
      final camera = geometry.cameraFor(const Size(288, 220));
      final metresPerPixel =
          math.cos(geometry.center.latitude * math.pi / 180) *
          2 *
          math.pi *
          6371008.8 /
          (256 * math.pow(2, camera.zoom));

      expect(camera.zoom.isFinite, isTrue);
      expect(2 * radius / metresPerPixel, lessThanOrEqualTo(140.1));
    }
  });

  test('larger zones zoom out, larger viewports can zoom in', () {
    final small = SafeZoneMapGeometry.fromZone(_zone(radius: 50))!;
    final large = SafeZoneMapGeometry.fromZone(_zone(radius: 5000))!;
    const phone = Size(288, 220);
    const expanded = Size(800, 700);

    expect(large.cameraFor(phone).zoom, lessThan(small.cameraFor(phone).zoom));
    expect(
      large.cameraFor(expanded).zoom,
      greaterThan(large.cameraFor(phone).zoom),
    );
  });

  test('a dateline-crossing zone uses local bounds and a useful zoom', () {
    final geometry = SafeZoneMapGeometry.fromZone(
      _zone(lat: 0, lng: 179.9999, radius: 5000),
    )!;
    expect(geometry.bounds.contains(const LatLng(0, -179.99)), isTrue);
    expect(geometry.bounds.contains(const LatLng(0, 179.99)), isTrue);
    expect(geometry.cameraFor(const Size(320, 240)).zoom, greaterThan(9));
  });

  test('paused state does not move the centre or change the radius', () {
    final active = SafeZoneMapGeometry.fromZone(_zone())!;
    final paused = SafeZoneMapGeometry.fromZone(_zone(active: false))!;
    expect(paused.center, active.center);
    expect(paused.radiusMeters, active.radiusMeters);
    expect(paused.bounds, active.bounds);
  });

  test(
    'polar and degenerate viewport values still produce a finite camera',
    () {
      for (final latitude in [-90.0, 90.0]) {
        final geometry = SafeZoneMapGeometry.fromZone(_zone(lat: latitude))!;
        for (final size in [Size.zero, const Size(double.infinity, 240)]) {
          final camera = geometry.cameraFor(size);
          expect(camera.target, LatLng(latitude, 57.591));
          expect(camera.zoom.isFinite, isTrue);
          expect(camera.zoom, inInclusiveRange(0, 20));
        }
      }
    },
  );

  testWidgets('invalid data shows a readable fallback without a platform map', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 288,
            height: 220,
            child: SafeZoneMap(zone: _zone(lat: double.nan)),
          ),
        ),
      ),
    );
    expect(find.text('Map unavailable'), findsOneWidget);
    expect(find.byType(GoogleMap), findsNothing);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });

  group('real map widget contract', () {
    late GoogleMapsFlutterPlatform previousPlatform;
    late _FakeMapPlatform platform;

    setUp(() {
      previousPlatform = GoogleMapsFlutterPlatform.instance;
      platform = _FakeMapPlatform();
      GoogleMapsFlutterPlatform.instance = platform;
    });

    tearDown(() {
      for (final id in platform.created) {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(
              MethodChannel('plugins.flutter.io/google_maps_$id'),
              null,
            );
      }
      GoogleMapsFlutterPlatform.instance = previousPlatform;
    });

    testWidgets(
      'preview shows only saved geometry and leaves page gestures free',
      (tester) async {
        final zone = _zone(radius: 275);
        await tester.pumpWidget(_mapHost(zone));
        await _settleMap(tester);
        final map = tester.widget<GoogleMap>(find.byType(GoogleMap));

        expect(map.circles.single.center, LatLng(zone.lat, zone.lng));
        expect(map.circles.single.radius, 275);
        expect(map.markers.single.position, LatLng(zone.lat, zone.lng));
        expect(map.markers.single.draggable, isFalse);
        expect(map.myLocationEnabled, isFalse);
        expect(map.myLocationButtonEnabled, isFalse);
        expect(map.scrollGesturesEnabled, isFalse);
        expect(map.zoomGesturesEnabled, isFalse);
        expect(map.webGestureHandling, WebGestureHandling.none);
        expect(map.onTap, isNull);
        expect(map.onLongPress, isNull);
        expect(find.text('Loading map…'), findsNothing);
        expect(platform.created, hasLength(1));
        await tester.pumpWidget(const SizedBox.shrink());
        await _settleMap(tester);
        expect(platform.disposed, hasLength(1));
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('selection and radius updates refit the existing map', (
      tester,
    ) async {
      await tester.pumpWidget(_mapHost(_zone()));
      await _settleMap(tester);
      final initialUpdates = platform.cameraUpdates.length;
      final school = _zone(id: 'school', lat: -20.03, lng: 57.61, radius: 500);
      await tester.pumpWidget(_mapHost(school));
      await _settleMap(tester);

      expect(platform.created, hasLength(1));
      expect(platform.cameraUpdates.length, greaterThan(initialUpdates));
      final update = platform.cameraUpdates.last.toJson() as List;
      expect(update.first, 'newCameraPosition');
      expect((update[1] as Map)['target'], [-20.03, 57.61]);
      final map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      expect(map.circles.single.radius, 500);
      expect(map.markers.single.position, const LatLng(-20.03, 57.61));
      final schoolUpdates = platform.cameraUpdates.length;

      await tester.pumpWidget(
        _mapHost(_zone(id: 'school', lat: -20.03, lng: 57.61, radius: 1000)),
      );
      await _settleMap(tester);
      expect(platform.cameraUpdates.length, greaterThan(schoolUpdates));
      expect(platform.created, hasLength(1));
      await tester.pumpWidget(const SizedBox.shrink());
      await _settleMap(tester);
      expect(tester.takeException(), isNull);
    });

    testWidgets('expanded controls are read-only and retain zone geometry', (
      tester,
    ) async {
      final zone = _zone();
      await tester.pumpWidget(_mapHost(zone, expanded: true));
      await _settleMap(tester);
      var map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      expect(map.scrollGesturesEnabled, isTrue);
      expect(map.zoomGesturesEnabled, isTrue);
      expect(map.webGestureHandling, WebGestureHandling.greedy);

      for (final tooltip in [
        'Zoom in',
        'Zoom out',
        'Show whole safe zone',
        'Switch to satellite view',
      ]) {
        final bounds = tester.getSize(find.byTooltip(tooltip));
        expect(bounds.width, greaterThanOrEqualTo(48));
        expect(bounds.height, greaterThanOrEqualTo(48));
      }

      await tester.tap(find.byTooltip('Switch to satellite view'));
      await _settleMap(tester);
      map = tester.widget<GoogleMap>(find.byType(GoogleMap));
      expect(map.mapType, MapType.hybrid);
      expect(map.style, isNull);
      expect(map.circles.single.radius, zone.radiusMeters);
      expect(map.markers.single.position, LatLng(zone.lat, zone.lng));
      expect(platform.created, hasLength(1));

      await tester.tap(find.byTooltip('Zoom in'));
      await tester.tap(find.byTooltip('Show whole safe zone'));
      await _settleMap(tester);
      expect(
        platform.cameraUpdates.map((update) => (update.toJson() as List).first),
        contains('zoomIn'),
      );
      expect(
        (platform.cameraUpdates.last.toJson() as List).first,
        'newCameraPosition',
      );
      await tester.pumpWidget(const SizedBox.shrink());
      await _settleMap(tester);
      expect(tester.takeException(), isNull);
    });

    testWidgets('late camera failure after removing the map is ignored', (
      tester,
    ) async {
      platform.pendingCamera = Completer<void>();
      await tester.pumpWidget(_mapHost(_zone()));
      await _settleMap(tester);
      expect(platform.cameraUpdates, isNotEmpty);
      await tester.pumpWidget(const SizedBox.shrink());
      platform.pendingCamera!.completeError(
        StateError('Platform view removed'),
      );
      await _settleMap(tester);
      expect(platform.disposed, hasLength(1));
      expect(tester.takeException(), isNull);
    });
  });
}
