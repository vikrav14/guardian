import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/watch_calls_page.dart';
import 'package:guardian/services/guardian_entitlements.dart';
import 'package:guardian/services/watch_calls_service.dart';

const imei = '861397000000000';
GuardianSubscription subscription({bool active = true}) => GuardianSubscription.fromMap({
  'version': 1, 'managedBy': 'guardian_admin', 'plan': 'family', 'status': active ? 'active' : 'expired',
});
WatchCallsService service(FakeFirebaseFirestore db) => WatchCallsService(db: db,
  auth: MockFirebaseAuth(mockUser: MockUser(uid: 'owner'), signedIn: true));

Future<void> setup(FakeFirebaseFirestore db) => db.collection('watchCallSettings').doc(imei).set({
  'configured': true, 'autoAvailable': true, 'policyRevision': 'revision-1', 'callerHint': 'Guardian number ending 0000',
});

Future<void> showPage(WidgetTester tester, FakeFirebaseFirestore db, {bool active = true}) async {
  await tester.pumpWidget(MaterialApp(home: WatchCallsPage(imei: imei, wearerName: 'Sample wearer',
    subscription: subscription(active: active), service: service(db))));
  await tester.pumpAndSettle();
}

void main() {
  test('service writes only mode, consent, authority revision and a short deadline', () async {
    final db = FakeFirebaseFirestore();
    final before = DateTime.now();
    await service(db).requestMode(imei, WatchAnswerMode.auto, policyRevision: 'revision-1', consentAccepted: true);
    final row = (await db.collection('watchCallRequests').get()).docs.single.data();
    expect(row.keys.toSet(), {'imei', 'mode', 'requestedBy', 'policyRevision', 'consentAccepted', 'createdAt', 'expiresAt', 'status'});
    expect(row['mode'], 'auto'); expect(row['requestedBy'], 'owner'); expect(row['status'], 'pending');
    expect((row['expiresAt'] as Timestamp).toDate().difference(before).inSeconds, inInclusiveRange(59, 61));
    await expectLater(service(db).requestMode(imei, WatchAnswerMode.auto, policyRevision: 'revision-1', consentAccepted: false), throwsStateError);
    expect((await db.collection('watchCallRequests').get()).size, 1);
  });

  test('handoff, uncertainty, stale pending data and rejection retain honest status wording', () {
    final now = DateTime.now();
    expect(watchCallRequestMessage({'status': 'socket_handoff', 'mode': 'auto'}, now), contains('test call'));
    expect(watchCallRequestMessage({'status': 'device_replied', 'mode': 'manual'}, now), contains('Watch replied to Manual'));
    expect(watchCallRequestMessage({'status': 'handoff_unknown', 'mode': 'manual', 'reason': 'watch_reply_missing'}, now), contains('setting is unconfirmed'));
    expect(watchCallRequestMessage({'status': 'not_sent', 'mode': 'manual', 'reason': 'connection_unconfirmed'}, now), contains('was not sent'));
    expect(watchCallRequestMessage({'status': 'sending', 'mode': 'auto', 'leaseUntil': now.subtract(const Duration(seconds: 1))}, now), contains('Could not confirm'));
    expect(watchCallRequestMessage({'status': 'pending', 'mode': 'auto', 'expiresAt': now.subtract(const Duration(seconds: 1))}, now), contains('Check the watch'));
    expect(watchCallRequestMessage({'status': 'not_sent', 'mode': 'manual', 'reason': 'no_fresh_identified_session'}, now), contains('was not sent'));
  });

  testWidgets('opening Calls selects Manual without sending; Auto requires consent and cancel sends nothing', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db); await showPage(tester, db);
    expect(find.text('Send Manual setting'), findsOneWidget);
    expect((await db.collection('watchCallRequests').get()).size, 0);
    await tester.ensureVisible(find.text('Auto'));
    await tester.tap(find.text('Auto')); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Send Auto setting'));
    await tester.tap(find.text('Send Auto setting')); await tester.pumpAndSettle();
    expect(find.text('Enable handsfree answering?'), findsOneWidget);
    expect(find.textContaining('everyday calls too'), findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect((await db.collection('watchCallRequests').get()).size, 0);
    await tester.tap(find.text('Send Auto setting')); await tester.pumpAndSettle();
    await tester.tap(find.text('Enable Auto')); await tester.pumpAndSettle();
    final request = (await db.collection('watchCallRequests').get()).docs.single;
    expect(request.data()['mode'], 'auto'); expect(request.data()['consentAccepted'], isTrue);
    await request.reference.update({'status': 'device_replied'}); await tester.pumpAndSettle();
    expect(find.textContaining('Watch replied to Auto. Make a test call'), findsOneWidget);
    await tester.ensureVisible(find.text('Manual'));
    await tester.tap(find.text('Manual')); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Send Manual setting'));
    await tester.tap(find.text('Send Manual setting')); await tester.pumpAndSettle();
    final manual = (await db.collection('watchCallRequests').where('mode', isEqualTo: 'manual').get()).docs.single;
    expect(manual.data()['consentAccepted'], isFalse);
    await manual.reference.update({'status': 'handoff_unknown', 'reason': 'watch_reply_missing'});
    await tester.pumpAndSettle();
    expect(find.textContaining('setting is unconfirmed'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('inactive service still permits an explicit Manual request', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db); await showPage(tester, db, active: false);
    await tester.ensureVisible(find.text('Auto'));
    await tester.tap(find.text('Auto')); await tester.pumpAndSettle();
    expect(find.text('Send Manual setting'), findsOneWidget);
    await tester.ensureVisible(find.text('Send Manual setting'));
    await tester.tap(find.text('Send Manual setting')); await tester.pumpAndSettle();
    final request = (await db.collection('watchCallRequests').get()).docs.single.data();
    expect(request['mode'], 'manual'); expect(request['consentAccepted'], isFalse);
    expect(find.text('Enable handsfree answering?'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('unconfigured controls cannot send or imply the watch is in Manual', (tester) async {
    final db = FakeFirebaseFirestore(); await showPage(tester, db);
    expect(find.text('Answer controls are not set up for this watch yet.'), findsOneWidget);
    final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Send Manual setting'));
    expect(button.onPressed, isNull);
    expect(find.textContaining('Last setting sent:'), findsNothing);
    expect((await db.collection('watchCallRequests').get()).size, 0);
    await tester.pumpWidget(const SizedBox());
  });

  for (final width in [320.0, 1280.0]) {
    testWidgets('Calls fits $width with enlarged text', (tester) async {
      tester.view.physicalSize = Size(width, 1000); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final db = FakeFirebaseFirestore(); await setup(db);
      await tester.pumpWidget(MaterialApp(builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)), child: child!),
        home: WatchCallsPage(imei: imei, wearerName: 'Sample wearer', subscription: subscription(), service: service(db))));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Send Manual setting'));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
}
