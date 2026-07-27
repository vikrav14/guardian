import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/map/guardian_map_presentation.dart';

void main() {
  test('Guardian map style is valid and suppresses commercial POI clutter', () {
    final style = jsonDecode(GuardianMapPresentation.style) as List<dynamic>;

    expect(style, isNotEmpty);
    expect(
      style.whereType<Map<String, dynamic>>().any(
            (rule) =>
                rule['featureType'] == 'poi' &&
                (rule['stylers'] as List<dynamic>).any(
                  (styler) =>
                      styler is Map<String, dynamic> &&
                      styler['visibility'] == 'off',
                ),
          ),
      isTrue,
    );
  });

  testWidgets('map controls centre the tracked person, never My Location', (
    tester,
  ) async {
    var zoomedIn = false;
    var zoomedOut = false;
    var centered = false;

    await tester.pumpWidget(
      MaterialApp(
        theme: buildGuardianTheme(),
        home: Scaffold(
          body: GuardianMapControlRail(
            trackedName: 'Bouboush',
            onZoomIn: () => zoomedIn = true,
            onZoomOut: () => zoomedOut = true,
            onCenterTrackedPerson: () => centered = true,
          ),
        ),
      ),
    );

    expect(find.byTooltip('Centre on Bouboush'), findsOneWidget);
    expect(find.textContaining('My location'), findsNothing);

    await tester.tap(find.byTooltip('Zoom in'));
    await tester.tap(find.byTooltip('Zoom out'));
    await tester.tap(find.byTooltip('Centre on Bouboush'));

    expect(zoomedIn, isTrue);
    expect(zoomedOut, isTrue);
    expect(centered, isTrue);
  });
}
