import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/services/movement_reminders_service.dart';
import 'package:guardian/wellness/movement_reminders_page.dart';

const imei = '999999999999999';
class FakeMovementClient implements MovementReminderClient {
  MovementState state = const MovementState(connected: true);
  int reads = 0;
  final requests = <MovementSettings>[];
  final ids = <String>[];
  final actions = <String>[];
  Completer<MovementState>? pending;
  Completer<MovementState>? pendingLoad;
  bool fail = false;
  bool failLoad = false;
  @override
  Future<MovementState> load(String imei) async {
    reads++;
    if (failLoad) throw const MovementRequestException('gateway_unavailable');
    return pendingLoad?.future ?? state;
  }
  @override
  Future<MovementState> save(String imei, {required String requestId,
    required int expectedVersion, required MovementSettings settings, required String action}) async {
    requests.add(settings); ids.add(requestId); actions.add(action);
    expect(expectedVersion, state.version);
    if (fail) throw const MovementRequestException('gateway_unavailable');
    return pending?.future ?? (state = MovementState(version: state.version + 1,
      status: 'replies_observed', desired: settings, connected: true, action: action));
  }
}

Widget screen(FakeMovementClient client, {String pilot = imei, double scale = 1}) => MaterialApp(
  builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
  home: MovementRemindersPage(imei: imei, name: 'Test wearer', client: client,
    pilotImei: pilot, subscription: GuardianSubscription.fromMap({
      'version': 1, 'managedBy': 'guardian_admin', 'plan': 'family', 'status': 'active',
    })),
);

final switchSave = find.byKey(const ValueKey('movement-save-switch'));
final hoursSave = find.byKey(const ValueKey('movement-save-hours'));

Future<void> tapSave(WidgetTester tester) async {
  final finder = switchSave;
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('opening and editing never sends; explicit save sends once and never claims applied', (tester) async {
    final client = FakeMovementClient();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(client.requests, isEmpty);
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tester.pump();
    expect(client.requests, isEmpty);
    await tapSave(tester);
    expect(client.requests.length, 1);
    expect(client.requests.single.enabled, isTrue);
    expect(client.actions, ['switch']);
    expect(client.ids.single, matches(RegExp(r'^[a-f0-9-]{36}$')));
    expect(find.text('Watch replied — check the watch'), findsOneWidget);
    expect(find.text('The watch setting and reminder behaviour are not automatically verified.'), findsOneWidget);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNotNull);
  });

  testWidgets('lost response requires read-only refresh and unconfirmed enable requires Off', (tester) async {
    final client = FakeMovementClient()..fail = true;
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tapSave(tester);
    expect(client.requests.length, 1);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    expect(find.text('Save On/Off'), findsOneWidget);
    expect(find.text('Save active hours'), findsOneWidget);
    expect(find.text('Sending On…'), findsNothing);
    client.state = const MovementState(version: 1, status: 'unconfirmed', connected: true,
      desired: MovementSettings(enabled: true, start: '08:00', end: '20:00'));
    await tester.ensureVisible(find.text('Refresh status'));
    await tester.tap(find.text('Refresh status'));
    await tester.pumpAndSettle();
    expect(client.requests.length, 1);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNull);
    await tester.ensureVisible(find.byKey(const ValueKey('movement-switch')));
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tester.pump();
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNotNull);
    client.fail = false;
    await tapSave(tester);
    expect(client.requests.last.enabled, isFalse);
  });

  testWidgets('offline and unavailable pilot cannot send or load through direct navigation', (tester) async {
    final client = FakeMovementClient()..state = const MovementState();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(screen(client, pilot: ''));
    await tester.pumpAndSettle();
    expect(client.reads, 1);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('pending On save shows progress only on its button and blocks both actions', (tester) async {
    final client = FakeMovementClient()..pending = Completer<MovementState>();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tapSave(tester);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNull);
    expect(client.requests.length, 1);
    expect(client.actions, ['switch']);
    expect(find.text('Sending On…'), findsOneWidget);
    expect(find.text('Save active hours'), findsOneWidget);
    expect(find.text('Sending active hours…'), findsNothing);
    client.pending!.complete(const MovementState(version: 1, status: 'replies_observed', connected: true));
    await tester.pumpAndSettle();
    expect(find.text('Save On/Off'), findsOneWidget);
    expect(find.text('Save active hours'), findsOneWidget);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNotNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNotNull);
  });

  testWidgets('pending hours save leaves the On/Off label unchanged and sends only hours', (tester) async {
    final client = FakeMovementClient()..pending = Completer<MovementState>();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tester.ensureVisible(hoursSave);
    await tester.tap(hoursSave);
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNull);
    expect(client.actions, ['hours']);
    expect(find.text('Save On/Off'), findsOneWidget);
    expect(find.text('Sending active hours…'), findsOneWidget);
    expect(find.text('Sending Off…'), findsNothing);
    client.pending!.complete(const MovementState(version: 1, status: 'replies_observed',
      connected: true, action: 'hours',
      desired: MovementSettings(enabled: false, start: '08:00', end: '20:00')));
    await tester.pumpAndSettle();
    expect(find.text('Save On/Off'), findsOneWidget);
    expect(find.text('Save active hours'), findsOneWidget);
    expect(find.text('Requested hours: 08:00–20:00'), findsOneWidget);
  });

  testWidgets('read-only refresh does not make either Save appear to be sending', (tester) async {
    final client = FakeMovementClient();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    client.pendingLoad = Completer<MovementState>();
    await tester.ensureVisible(find.text('Refresh status'));
    await tester.tap(find.text('Refresh status'));
    await tester.pumpAndSettle();
    expect(client.requests, isEmpty);
    expect(find.text('Save On/Off'), findsOneWidget);
    expect(find.text('Save active hours'), findsOneWidget);
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNull);
    client.pendingLoad!.complete(client.state);
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNotNull);
    expect(tester.widget<FilledButton>(hoursSave).onPressed, isNotNull);
    expect(client.requests, isEmpty);
  });

  testWidgets('explicit Off stays available because a reply is not current watch state', (tester) async {
    final client = FakeMovementClient()..state = const MovementState(
      version: 1, status: 'replies_observed', connected: true,
      desired: MovementSettings(enabled: false, start: '08:00', end: '20:00'));
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(switchSave).onPressed, isNotNull);
    await tapSave(tester);
    expect(client.requests.single.enabled, isFalse);
  });

  testWidgets('320px with doubled text keeps connected controls usable', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(screen(FakeMovementClient(), scale: 2));
    await tester.pumpAndSettle();
    await tester.ensureVisible(switchSave);
    await tester.ensureVisible(hoursSave);
    expect(tester.takeException(), isNull);
  });

  testWidgets('hours Save is independent and does not submit the switch action', (tester) async {
    final client = FakeMovementClient();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tester.ensureVisible(hoursSave);
    await tester.tap(hoursSave);
    await tester.pumpAndSettle();
    expect(client.actions, ['hours']);
    expect(find.text('Requested hours: 08:00–20:00'), findsOneWidget);
  });

  testWidgets('last requested On does not block an explicit On save when watch disagrees', (tester) async {
    final client = FakeMovementClient()..state = const MovementState(
      version: 3, status: 'replies_observed', action: 'legacy_combined', connected: true,
      desired: MovementSettings(enabled: true, start: '00:30', end: '15:00'));
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tapSave(tester);
    expect(client.actions, ['switch']);
    expect(client.requests.single.enabled, isTrue);
  });

  testWidgets('initial load failure does not display fallback Off/hours as loaded settings', (tester) async {
    await tester.pumpWidget(screen(FakeMovementClient()..failLoad = true));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('movement-switch')), findsNothing);
    expect(find.text('From 08:00'), findsNothing);
    expect(find.text('Refresh status'), findsOneWidget);
  });
}
