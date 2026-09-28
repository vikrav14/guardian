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
  Completer<MovementState>? pending;
  bool fail = false;
  @override
  Future<MovementState> load(String imei) async { reads++; return state; }
  @override
  Future<MovementState> save(String imei, {required String requestId,
    required int expectedVersion, required MovementSettings settings}) async {
    requests.add(settings); ids.add(requestId);
    expect(expectedVersion, state.version);
    if (fail) throw const MovementRequestException('gateway_unavailable');
    return pending?.future ?? (state = MovementState(version: state.version + 1,
      status: 'replies_observed', desired: settings, connected: true));
  }
}

Widget screen(FakeMovementClient client, {String pilot = imei, double scale = 1}) => MaterialApp(
  builder: (context, child) => MediaQuery(data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
  home: MovementRemindersPage(imei: imei, name: 'Test wearer', client: client,
    pilotImei: pilot, subscription: GuardianSubscription.fromMap({
      'version': 1, 'managedBy': 'guardian_admin', 'plan': 'family', 'status': 'active',
    })),
);

Future<void> tapSave(WidgetTester tester) async {
  final finder = find.text('Save to watch');
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
    expect(client.ids.single, matches(RegExp(r'^[a-f0-9-]{36}$')));
    expect(find.text('Watch replied — check the watch'), findsOneWidget);
    expect(find.text('The watch setting and reminder behaviour are not automatically verified.'), findsOneWidget);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
  });

  testWidgets('lost response requires read-only refresh and unconfirmed enable requires Off', (tester) async {
    final client = FakeMovementClient()..fail = true;
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tapSave(tester);
    expect(client.requests.length, 1);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    client.state = const MovementState(version: 1, status: 'unconfirmed', connected: true,
      desired: MovementSettings(enabled: true, start: '08:00', end: '20:00'));
    await tester.ensureVisible(find.text('Refresh status'));
    await tester.tap(find.text('Refresh status'));
    await tester.pumpAndSettle();
    expect(client.requests.length, 1);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    await tester.ensureVisible(find.byKey(const ValueKey('movement-switch')));
    await tester.tap(find.byKey(const ValueKey('movement-switch')));
    await tester.pump();
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNotNull);
    client.fail = false;
    await tapSave(tester);
    expect(client.requests.last.enabled, isFalse);
  });

  testWidgets('offline and unavailable pilot cannot send or load through direct navigation', (tester) async {
    final client = FakeMovementClient()..state = const MovementState();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(screen(client, pilot: ''));
    await tester.pumpAndSettle();
    expect(client.reads, 1);
    expect(find.byType(FilledButton), findsNothing);
  });

  testWidgets('pending save blocks duplicate taps', (tester) async {
    final client = FakeMovementClient()..pending = Completer<MovementState>();
    await tester.pumpWidget(screen(client));
    await tester.pumpAndSettle();
    await tapSave(tester);
    expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed, isNull);
    expect(client.requests.length, 1);
    client.pending!.complete(const MovementState(version: 1, status: 'replies_observed', connected: true));
    await tester.pumpAndSettle();
  });

  testWidgets('320px with doubled text keeps connected controls usable', (tester) async {
    tester.view.physicalSize = const Size(320, 700);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(screen(FakeMovementClient(), scale: 2));
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save to watch'));
    expect(tester.takeException(), isNull);
  });
}
