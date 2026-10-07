import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/journey/journey_v2_static_map.dart';
import 'package:guardian/theme/app_theme.dart';

import 'support/journey_fixture.dart';

Future<void> pumpJourney(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  for (final theme in [
    GuardianThemeId.islandGlass,
    GuardianThemeId.leMorne,
    GuardianThemeId.elderCare,
  ]) {
    testWidgets('320px at 200% text remains usable in ${theme.name}', (
      tester,
    ) async {
      await tester.binding.setSurfaceSize(const Size(320, 800));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(journeyFixtureHost(themeId: theme, textScale: 2));
      await pumpJourney(tester);
      expect(find.byType(DropdownButtonFormField<String>), findsOneWidget);
      expect(tester.takeException(), isNull);
      for (final key in [
        'journey-recording-details-morning',
        'journey-day-overview',
      ]) {
        final control = find.byKey(ValueKey(key));
        await tester.ensureVisible(control);
        await tester.tap(control);
        await pumpJourney(tester);
        expect(tester.takeException(), isNull);
      }
      expect(find.text('GPS location points'), findsOneWidget);
      final expand = find.byKey(const ValueKey('journey-expand-map'));
      await tester.ensureVisible(expand);
      await tester.tap(expand);
      await pumpJourney(tester);
      expect(
        find.byKey(const ValueKey('journey-fullscreen-map-morning')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey('journey-open-details')));
      await pumpJourney(tester);
      final evidence = find.byKey(
        const ValueKey('journey-toggle-source-evidence'),
      );
      await tester.ensureVisible(evidence);
      await tester.tap(evidence);
      await pumpJourney(tester);
      expect(find.text('Hide 14 GPS points'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  testWidgets(
    'timeline seeks recorded time, pauses replay, and returns to map',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 844));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await tester.pumpWidget(journeyFixtureHost());
      await pumpJourney(tester);
      final play = find.byKey(const ValueKey('journey-replay-toggle'));
      await tester.ensureVisible(play);
      await tester.tap(play);
      await tester.pump(const Duration(milliseconds: 50));
      final stop = find.byKey(const ValueKey('journey-event-morning-1'));
      await tester.ensureVisible(stop);
      await tester.tap(stop);
      await pumpJourney(tester);
      final map = tester.widget<JourneyV2StaticMap>(
        find.byKey(const ValueKey('journey-map-morning')),
      );
      expect(map.currentIndex, 5);
      expect(find.byTooltip('Play replay'), findsOneWidget);
      expect(
        find.byKey(const ValueKey('journey-expand-map')).hitTestable(),
        findsOneWidget,
      );
      expect(find.text('At 09:30 · Sample garden'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('changing trip resets replay and selects the new map', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(journeyFixtureHost());
    await pumpJourney(tester);
    final arrival = find.byKey(const ValueKey('journey-event-morning-2'));
    await tester.ensureVisible(arrival);
    await tester.tap(arrival);
    await pumpJourney(tester);
    final trip = find.byKey(const ValueKey('journey-trip-afternoon'));
    await tester.ensureVisible(trip);
    await tester.tap(trip);
    await pumpJourney(tester);
    expect(find.byKey(const ValueKey('journey-map-morning')), findsNothing);
    final map = tester.widget<JourneyV2StaticMap>(
      find.byKey(const ValueKey('journey-map-afternoon')),
    );
    expect(map.currentIndex, 0);
    expect(find.text('At 14:10 · Home'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('busy days use a compact selector that changes trips', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(
      journeyFixtureHost(
        journeys: [
          for (var i = 0; i < 5; i++)
            journeyFixture(id: 'trip-$i', hour: 8 + i),
        ],
      ),
    );
    await pumpJourney(tester);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await pumpJourney(tester);
    await tester.tap(find.text('5 of 5 · 12:10 – 13:02').last);
    await pumpJourney(tester);
    expect(find.byKey(const ValueKey('journey-map-trip-4')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an unconfirmed return is never presented as arriving home', (
    tester,
  ) async {
    await tester.pumpWidget(
      journeyFixtureHost(journeys: [journeyFixture(confirmedReturn: false)]),
    );
    await pumpJourney(tester);
    expect(find.text('Last recorded'), findsOneWidget);
    expect(find.text('Return home not confirmed'), findsOneWidget);
    expect(find.text('Returned Home'), findsNothing);
    expect(find.text('Time away'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
