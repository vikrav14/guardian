import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
// Test the app's existing Maps platform boundary without another dependency.
// ignore: depend_on_referenced_packages
import 'package:google_maps_flutter_platform_interface/google_maps_flutter_platform_interface.dart';
import 'package:guardian/widgets/map/map_avatar_overlay.dart';

import 'support/dashboard_fixture.dart';

class _Maps extends MethodChannelGoogleMapsFlutter {
  int calls = 0;
  int pointerDowns = 0;
  Completer<ScreenCoordinate>? pending;
  final positions = <LatLng>[];
  final created = <int>{};

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
    return Listener(
      behavior: HitTestBehavior.opaque,
      onPointerDown: (_) => pointerDowns++,
      child: const SizedBox.expand(),
    );
  }

  @override
  Stream<GroundOverlayTapEvent> onGroundOverlayTap({required int mapId}) =>
      const Stream.empty();

  @override
  Future<void> updateGroundOverlays(
    GroundOverlayUpdates updates, {
    required int mapId,
  }) async {}

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
  Future<ScreenCoordinate> getScreenCoordinate(
    LatLng position, {
    required int mapId,
  }) {
    calls++;
    positions.add(position);
    return pending?.future ??
        Future.value(const ScreenCoordinate(x: 400, y: 400));
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late _Maps maps;
  late GoogleMapsFlutterPlatform original;

  setUp(() {
    original = GoogleMapsFlutterPlatform.instance;
    maps = _Maps();
    GoogleMapsFlutterPlatform.instance = maps;
  });
  tearDown(() => GoogleMapsFlutterPlatform.instance = original);

  Widget host({
    int generation = 0,
    bool active = true,
    bool selected = true,
    ValueChanged<String>? onSelect,
  }) {
    return _Host(
      generation: generation,
      active: active,
      selected: selected,
      onSelect: onSelect ?? (_) {},
    );
  }

  testWidgets('Android avatar uses logical pixels at the saved Home position', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(host(onSelect: (imei) => selected = imei));
    await tester.pump();
    await tester.pump();
    final marker = tester.widget<Positioned>(find.byType(Positioned).first);
    expect(marker.left, 129); // Physical x 400 / DPR 2 - marker width 142 / 2.
    expect(marker.top, 92); // Physical y 400 / DPR 2 - marker height 108.
    expect(maps.positions.single, const LatLng(-20.15, 57.55));
    expect(find.text('AM'), findsOneWidget);
    await tester.tapAt(tester.getCenter(find.text('Alex Morgan')));
    expect(selected, isNull);
    expect(maps.pointerDowns, 1); // Touches pass through the selected photo.
  });

  testWidgets('another person can still be selected from their avatar', (
    tester,
  ) async {
    String? selected;
    await tester.pumpWidget(
      host(selected: false, onSelect: (imei) => selected = imei),
    );
    await tester.pump();
    await tester.pump();
    await tester.tap(find.text('AM'));
    expect(selected, 'demo-watch-a');
    expect(maps.pointerDowns, 0);
  });

  testWidgets(
    'camera bursts coalesce and late projections cannot update a removed overlay',
    (tester) async {
      maps.pending = Completer<ScreenCoordinate>();
      await tester.pumpWidget(host());
      await tester.pump();
      for (var generation = 1; generation <= 15; generation++) {
        await tester.pumpWidget(host(generation: generation));
      }
      expect(maps.calls, 1);
      final first = maps.pending!;
      maps.pending = Completer<ScreenCoordinate>();
      first.complete(const ScreenCoordinate(x: 100, y: 100));
      await tester.pump();
      expect(maps.calls, 2);
      expect(find.text('Alex Morgan'), findsNothing);
      await tester.pumpWidget(const SizedBox());
      maps.pending!.complete(const ScreenCoordinate(x: 400, y: 400));
      await tester.pump();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('hidden map defers projection until visible', (tester) async {
    await tester.pumpWidget(host(active: false));
    await tester.pump();
    expect(maps.calls, 0);
    await tester.pumpWidget(host());
    await tester.pump();
    expect(maps.calls, 1);
    expect(find.text('Alex Morgan'), findsOneWidget);
  });
}

class _Host extends StatefulWidget {
  const _Host({
    required this.generation,
    required this.active,
    required this.selected,
    required this.onSelect,
  });
  final int generation;
  final bool active;
  final bool selected;
  final ValueChanged<String> onSelect;

  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  GoogleMapController? controller;

  @override
  Widget build(BuildContext context) {
    final device = dashboardFixtureDevice(rememberedHome: true);
    return MaterialApp(
      home: MediaQuery(
        data: const MediaQueryData(devicePixelRatio: 2),
        child: TickerMode(
          enabled: widget.active,
          child: SizedBox(
            width: 400,
            height: 300,
            child: Stack(
              children: [
                GoogleMap(
                  initialCameraPosition: const CameraPosition(
                    target: LatLng(-20.15, 57.55),
                  ),
                  onMapCreated: (value) => setState(() => controller = value),
                ),
                MapAvatarOverlay(
                  controller: controller,
                  devices: [device],
                  selectedImei: widget.selected ? device.imei : null,
                  cameraGeneration: widget.generation,
                  onSelect: widget.onSelect,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
