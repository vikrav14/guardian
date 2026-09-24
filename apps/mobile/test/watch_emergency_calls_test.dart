import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/services/watch_calls_service.dart';
import 'package:guardian/widgets/watch_emergency_calls_card.dart';

const imei = '861397000000000';
WatchCallsService service(FakeFirebaseFirestore db, {String uid = 'owner'}) => WatchCallsService(db: db,
  auth: MockFirebaseAuth(mockUser: MockUser(uid: uid), signedIn: true));

void main() {
  test('emergency preference has explicit consent, a short expiry and no caller or commands', () async {
    final db = FakeFirebaseFirestore();
    await service(db).requestEmergency(imei, enabled: true, revision: 'policy', consentAccepted: true);
    final row = (await db.collection('watchEmergencyRequests').get()).docs.single.data();
    expect(row.keys.toSet(), {'imei', 'enabled', 'requestedBy', 'revision', 'consentAccepted', 'status', 'createdAt', 'expiresAt'});
    expect(row['enabled'], true); expect(row['requestedBy'], 'owner');
    expect((row['expiresAt'] as Timestamp).toDate().difference(DateTime.now()).inSeconds, inInclusiveRange(58, 60));
    await expectLater(service(db).requestEmergency(imei, enabled: true, revision: 'policy', consentAccepted: false), throwsStateError);
  });

  test('expired window never implies Manual has already been restored', () {
    final now = DateTime.now();
    expect(emergencyCallStatus({'status': 'auto_replied', 'windowEndsAt': now.subtract(const Duration(seconds: 1))}, now), contains('Auto may still be on'));
    expect(emergencyCallStatus({'status': 'restoration_pending'}, now), contains('reconnects and replies'));
    expect(emergencyCallStatus({'status': 'manual_replied'}, now), contains('Make a test call'));
  });

  testWidgets('owner opts in separately, cancellation sends nothing, and off remains available after expiry', (tester) async {
    final db = FakeFirebaseFirestore();
    await db.collection('watchEmergencySettings').doc(imei).set({'configured': true, 'managerUid': 'owner',
      'revision': 'policy', 'enabled': false, 'status': 'disabled', 'callerHint': 'Primary contact ending 0000'});
    Widget page(bool access) => MaterialApp(home: Scaffold(body: SingleChildScrollView(child:
      WatchEmergencyCallsCard(imei: imei, service: service(db), familyAccess: access))));
    await tester.pumpWidget(page(true)); await tester.pumpAndSettle();
    expect((await db.collection('watchEmergencyRequests').get()).size, 0);
    await tester.tap(find.text('Set up emergency answering')); await tester.pumpAndSettle();
    expect(find.textContaining('any call from this number'), findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect((await db.collection('watchEmergencyRequests').get()).size, 0);
    await tester.tap(find.text('Set up emergency answering')); await tester.pumpAndSettle();
    await tester.tap(find.text('Enable emergency answering')); await tester.pumpAndSettle();
    final enabled = (await db.collection('watchEmergencyRequests').get()).docs.single;
    expect(enabled.data()['consentAccepted'], true);
    await enabled.reference.update({'status': 'applied'});
    await db.collection('watchEmergencySettings').doc(imei).update({'enabled': true, 'status': 'restoration_pending'});
    await tester.pumpWidget(page(false)); await tester.pumpAndSettle();
    expect(find.textContaining('Auto may remain on'), findsOneWidget);
    await tester.ensureVisible(find.text('Turn off emergency answering'));
    await tester.tap(find.text('Turn off emergency answering')); await tester.pumpAndSettle();
    final off = (await db.collection('watchEmergencyRequests').where('enabled', isEqualTo: false).get()).docs.single;
    expect(off.data()['consentAccepted'], false);
  });

  testWidgets('another linked guardian sees status but cannot change owner consent', (tester) async {
    final db = FakeFirebaseFirestore();
    await db.collection('watchEmergencySettings').doc(imei).set({'configured': true, 'managerUid': 'owner', 'revision': 'policy', 'enabled': false});
    await tester.pumpWidget(MaterialApp(home: Scaffold(body: WatchEmergencyCallsCard(imei: imei,
      service: service(db, uid: 'member'), familyAccess: true))));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Set up emergency answering')).onPressed, isNull);
    expect((await db.collection('watchEmergencyRequests').get()).size, 0);
  });
}
