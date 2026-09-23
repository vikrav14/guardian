import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/contacts_page.dart';
import 'package:guardian/screens/emergency_contacts_page.dart';
import 'package:guardian/services/contacts_service.dart';

const imei = '861397000000000';
ContactsService service(FakeFirebaseFirestore db, {String uid = 'owner'}) => ContactsService(
  db: db, auth: MockFirebaseAuth(mockUser: MockUser(uid: uid), signedIn: true));
Future<void> setup(FakeFirebaseFirestore db) async {
  await db.collection('users').doc('owner').set({'linkedImeis': [imei], 'emergencyContacts': []});
  await db.collection('devices').doc(imei).set({'name': 'Sample'});
  await db.collection('watchPhonebookSettings').doc(imei).set({
    'configured': true, 'managerUid': 'owner', 'policyRevision': 'revision-1', 'availableSlots': 2, 'contacts': [],
  });
}
Future<void> showPage(WidgetTester tester, FakeFirebaseFirestore db, {String uid = 'owner'}) async {
  await tester.pumpWidget(MaterialApp(home: ContactsPage(imei: imei, wearerName: 'Sample', service: service(db, uid: uid))));
  await tester.pumpAndSettle();
}
void main() {
  test('legacy + directory + watch numbers merge once without granting permissions or losing WhatsApp', () {
    final merged = mergeContacts({
      'contactDirectory': [{'name': 'Rav', 'phone': '+23050000000'}],
      'emergencyContacts': [{'name': 'Rav', 'phone': '+230 5000 0000', 'whatsapp': '+23050000002', 'isPrimary': true}],
    }, {'contacts': [{'name': 'Rav', 'phone': '0023050000000', 'slot': 1, 'status': 'imported'},
      {'name': 'Other', 'phone': '+23050000001', 'slot': 2, 'status': 'device_replied'}]});
    expect(merged.length, 2); expect(merged.first.receivesAlerts, isTrue);
    expect(merged.first.watch?['slot'], 1); expect(merged.first.whatsapp, '+23050000002');
    expect(merged.first.primary, isTrue); expect(merged.last.receivesAlerts, isFalse);
  });
  test('both permissions save atomically as independent notification membership and bounded call request', () async {
    final db = FakeFirebaseFirestore(); await setup(db);
    await service(db).saveContact(name: 'Éva', phone: '0023050000000', receivesAlerts: true,
      callImei: imei, policyRevision: 'revision-1');
    final row = (await db.collection('watchPhonebookRequests').get()).docs.single.data();
    expect(row.keys.toSet(), {'imei', 'name', 'phone', 'requestedBy', 'policyRevision', 'status', 'createdAt', 'expiresAt'});
    expect(row['phone'], '+23050000000'); expect(row['status'], 'pending');
    expect((row['expiresAt'] as Timestamp).toDate().difference(DateTime.now()).inSeconds, inInclusiveRange(58, 60));
    final profile = (await db.collection('users').doc('owner').get()).data()!;
    expect((profile['emergencyContacts'] as List).single['phone'], row['phone']);
    expect((profile['contactDirectory'] as List).length, 1);
    expect((await db.collection('deviceCommands').get()).size, 0);
    expect((await db.collection('watchCallRequests').get()).size, 0);
  });
  test('turning alerts off preserves directory and watch access; primary transfers and other recipients remain', () async {
    final db = FakeFirebaseFirestore(); await setup(db);
    await service(db).saveContact(name: 'One', phone: '+23050000000', receivesAlerts: true);
    await service(db).saveContact(name: 'Two', phone: '+23050000001', receivesAlerts: true);
    final before = (await db.collection('watchPhonebookSettings').doc(imei).get()).data();
    await service(db).saveContact(name: 'One', phone: '+23050000000', receivesAlerts: false);
    final profile = (await db.collection('users').doc('owner').get()).data()!;
    expect((profile['contactDirectory'] as List).length, 2);
    expect((profile['emergencyContacts'] as List).single['phone'], '+23050000001');
    expect((profile['emergencyContacts'] as List).single['isPrimary'], isTrue);
    expect((await db.collection('watchPhonebookSettings').doc(imei).get()).data(), before);
    expect((await db.collection('watchPhonebookRequests').get()).size, 0);
  });
  testWidgets('one list deduplicates legacy entries, retains both controls and never sends on open', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db);
    await db.collection('users').doc('owner').update({'emergencyContacts': [
      {'name': 'Existing', 'phone': '+23050000000', 'isPrimary': true},
    ]});
    await db.collection('watchPhonebookSettings').doc(imei).update({'contacts': [
      {'name': 'Existing', 'phone': '0023050000000', 'slot': 1, 'status': 'imported'},
    ]});
    await showPage(tester, db);
    expect(find.text('Contacts'), findsOneWidget); expect(find.text('Existing'), findsOneWidget);
    expect(find.text('Receive safety alerts'), findsOneWidget); expect(find.text('Call Sample'), findsOneWidget);
    expect((await db.collection('watchPhonebookRequests').get()).size, 0);
    await tester.tap(find.byType(SwitchListTile)); await tester.pumpAndSettle();
    expect(find.text('Existing'), findsOneWidget);
    expect((await db.collection('users').doc('owner').get()).data()!['emergencyContacts'], isEmpty);
    expect((await db.collection('watchPhonebookSettings').doc(imei).get()).data()!['contacts'], hasLength(1));
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('adding second caller uses one form; notifications can stay off and call receipt is explicit', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db); await showPage(tester, db);
    await tester.tap(find.text('Add contact')); await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextFormField, 'Name'), 'Second caller');
    await tester.enterText(find.widgetWithText(TextFormField, 'Phone number'), '+23050000002');
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Receive safety alerts')); await tester.pumpAndSettle();
    await tester.ensureVisible(find.widgetWithText(CheckboxListTile, 'Call Sample'));
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Call Sample')); await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Save and send to watch'));
    await tester.tap(find.text('Save and send to watch')); await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 500)); await tester.pumpAndSettle();
    final row = (await db.collection('watchPhonebookRequests').get()).docs.single;
    expect(row.data()['phone'], '+23050000002');
    expect((await db.collection('users').doc('owner').get()).data()!['emergencyContacts'], isEmpty);
    expect(find.text('Second caller'), findsOneWidget);
    await row.reference.update({'status': 'device_replied'}); await tester.pumpAndSettle();
    expect(find.textContaining('Watch replied. Check its phonebook'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('unconfigured watch still allows alert contacts and prevents call permission requests', (tester) async {
    final db = FakeFirebaseFirestore(); await showPage(tester, db);
    expect(find.textContaining('15 family numbers'), findsOneWidget);
    await tester.tap(find.text('Add contact')); await tester.pumpAndSettle();
    final calling = tester.widget<CheckboxListTile>(find.widgetWithText(CheckboxListTile, 'Call Sample'));
    expect(calling.onChanged, isNull);
    await tester.tap(find.text('Cancel')); await tester.pumpAndSettle();
    await tester.pump(const Duration(milliseconds: 500));
    expect((await db.collection('watchPhonebookRequests').get()).size, 0);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('account route chooses linked watch and opens the same unified Contacts page', (tester) async {
    final db = FakeFirebaseFirestore(); await setup(db);
    await tester.pumpWidget(MaterialApp(home: EmergencyContactsPage(service: service(db))));
    await tester.pumpAndSettle();
    expect(find.text('Contacts'), findsOneWidget);
    expect(find.textContaining('Call access: Sample.'), findsOneWidget);
    expect(find.text('Add contact'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  for (final width in [320.0, 1280.0]) {
    testWidgets('unified contacts fits $width with enlarged text', (tester) async {
      tester.view.physicalSize = Size(width, 1200); tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize); addTearDown(tester.view.resetDevicePixelRatio);
      final db = FakeFirebaseFirestore(); await setup(db);
      await tester.pumpWidget(MaterialApp(builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: const TextScaler.linear(2)), child: child!),
        home: ContactsPage(imei: imei, wearerName: 'Sample', service: service(db))));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Add contact')); expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    });
  }
}
