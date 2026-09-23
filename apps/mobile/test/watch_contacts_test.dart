import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/watch_contacts_page.dart';
import 'package:guardian/services/watch_phonebook_service.dart';

const imei = '861397000000000';
WatchPhonebookService service(FakeFirebaseFirestore db, {String uid = 'owner'}) => WatchPhonebookService(
  db: db, auth: MockFirebaseAuth(mockUser: MockUser(uid: uid), signedIn: true));
Future<void> setup(FakeFirebaseFirestore db) => db.collection('watchPhonebookSettings').doc(imei).set({
  'configured': true, 'managerUid': 'owner', 'policyRevision': 'revision-1', 'availableSlots': 2, 'contacts': [],
});
Future<void> showPage(WidgetTester tester, FakeFirebaseFirestore db, {String uid = 'owner'}) async {
  await tester.pumpWidget(MaterialApp(home: WatchContactsPage(imei: imei, wearerName: 'Sample', service: service(db, uid: uid))));
  await tester.pumpAndSettle();
}
void main() {
  test('contact requests have a short deadline and cannot include slot or protocol instructions', () async {
    final db = FakeFirebaseFirestore();
    await service(db).addContact(imei, name: 'Éva', phone: '+230 5000 0000', policyRevision: 'revision-1');
    final row = (await db.collection('watchPhonebookRequests').get()).docs.single.data();
    expect(row.keys.toSet(), {'imei', 'name', 'phone', 'requestedBy', 'policyRevision', 'status', 'createdAt', 'expiresAt'});
    expect(row['phone'], '+23050000000'); expect(row['status'], 'pending');
    expect((row['expiresAt'] as Timestamp).toDate().difference(DateTime.now()).inSeconds, inInclusiveRange(58, 60));
    await expectLater(service(db).addContact(imei, name: 'Test', phone: '50000000', policyRevision: 'revision-1'), throwsFormatException);
    await expectLater(service(db).addContact(imei, name: 'x' * 21, phone: '+23050000000', policyRevision: 'revision-1'), throwsFormatException);
    expect((await db.collection('watchPhonebookRequests').get()).size, 1);
  });
  testWidgets('add requires explicit confirmation and reports reply without claiming watch application', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db); await showPage(tester, db);
    expect((await db.collection('watchPhonebookRequests').get()).size, 0);
    await tester.tap(find.text('Add watch contact')); await tester.pumpAndSettle();
    expect(find.textContaining('Removal from the watch is not available'), findsOneWidget);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    expect((await db.collection('watchPhonebookRequests').get()).size, 0);
    await tester.tap(find.text('Add watch contact')); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Name'), 'Second caller');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone number'), '+23050000002');
    await tester.tap(find.text('Send to watch')); await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 500)); await tester.pumpAndSettle();
    final row = (await db.collection('watchPhonebookRequests').get()).docs.single;
    expect(row.data()['phone'], '+23050000002');
    await row.reference.update({'status': 'device_replied'}); await tester.pumpAndSettle();
    expect(find.textContaining('Watch replied. Check its phonebook'), findsOneWidget);
    expect((await db.collection('watchCallRequests').get()).size, 0);
    expect((await db.collection('users').get()).size, 0);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('unconfigured and nonmanager views do not allow additions', (tester) async {
    final db = FakeFirebaseFirestore(); await showPage(tester, db);
    expect(find.textContaining('one-time setup'), findsOneWidget);
    expect(find.text('Add watch contact'), findsNothing);
    await tester.pumpWidget(const SizedBox());
    await setup(db); await showPage(tester, db, uid: 'viewer');
    expect(find.textContaining('Only the designated contact manager'), findsOneWidget);
    expect(find.text('Add watch contact'), findsNothing);
    await tester.pumpWidget(const SizedBox());
  });
  test('uncertainty and expired requests cannot look like confirmed phonebook entries', () {
    final now = DateTime.now();
    expect(watchContactMessage({'status': 'sending', 'leaseUntil': now.subtract(const Duration(seconds: 1))}, now), contains('uncertain'));
    expect(watchContactMessage({'status': 'pending', 'expiresAt': now.subtract(const Duration(seconds: 1))}, now), contains('will not be sent later'));
    expect(watchContactMessage({'status': 'device_replied'}, now), contains('test call'));
    expect(watchContactMessage({'status': 'imported'}, now), contains('recorded during setup'));
  });
  for (final width in [320.0, 1280.0]) {
    testWidgets('watch contacts fits $width with enlarged text', (tester) async {
      tester.view.physicalSize = Size(width, 1200); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final db = FakeFirebaseFirestore(); await setup(db);
      await tester.pumpWidget(MaterialApp(builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)), child: child!),
        home: WatchContactsPage(imei: imei, wearerName: 'Sample', service: service(db))));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add watch contact')); expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
}
