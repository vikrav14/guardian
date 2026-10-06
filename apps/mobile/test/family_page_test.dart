import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/screens/family_page.dart';
import 'package:guardian/services/family_sharing_service.dart';
import 'package:guardian/theme/colors.dart';
import 'package:guardian/widgets/navigation/guardian_navigation.dart';

class _Client implements FamilySharingClient {
  _Client({this.owner = true, this.error, this.preserved = false});
  final bool owner;
  final bool preserved;
  final Object? error;
  final List<Map<String, dynamic>> changes = [];
  @override
  String get uid => owner ? 'owner' : 'relative';
  @override
  Future<FamilySharingSnapshot> load() async {
    if (error != null) throw error!;
    return FamilySharingSnapshot([
      FamilyCircle({
        'imei': '999999999999999',
        'wearerName': 'Amira',
        'ownerUid': 'owner',
        'subscription': {'plan': 'family'},
        'limits': {
          'people': 3,
          'whatsappRecipients': 2,
          'monthlyMur': 1000,
          'answers': 50,
        },
        'usage': {'used': 24, 'reserved': 0},
        'overLimit': false,
        'notificationRouting': preserved ? 'legacy_preserved' : 'family',
        'pending': [],
        'members': [
          {
            'uid': 'owner',
            'name': 'Vikesh',
            'role': 'owner',
            'status': 'active',
            'permissions': familyPreset('caregiver'),
            'whatsapp': true,
            'whatsappConsent': true,
          },
          {
            'uid': 'relative',
            'name': 'Neelam',
            'role': 'viewer',
            'status': 'active',
            'permissions': familyPreset('viewer'),
            'whatsapp': false,
            'whatsappConsent': false,
          },
        ],
      }),
    ], phone: '+230 5700 0000');
  }

  @override
  Future<Map<String, dynamic>> change(
    String action,
    Map<String, dynamic> body, {
    String? imei,
  }) async {
    changes.add({'action': action, 'body': body, 'imei': imei});
    return {'code': 'synthetic-invite-code'};
  }

  @override
  void close() {}
}

Future<void> _pump(
  WidgetTester tester,
  _Client client, {
  double width = 390,
  double scale = 1,
}) async {
  tester.view.physicalSize = Size(width, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      theme: ThemeData(
        useMaterial3: true,
        fontFamily: 'FamilyReview',
        colorSchemeSeed: const Color(0xff648365),
        extensions: [GuardianThemeColors.chamarel],
      ),
      builder: (_, child) => MediaQuery(
        data: MediaQueryData(
          size: Size(width, 900),
          textScaler: TextScaler.linear(scale),
        ),
        child: child!,
      ),
      home: RepaintBoundary(
        key: const ValueKey('family-review'),
        child: Scaffold(
          body: FamilyPage(client: client),
          bottomNavigationBar: MobileBottomBar(currentIndex: 2, onTap: (_) {}),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _capture(WidgetTester tester, String name) async {
  final directory = Platform.environment['GUARDIAN_FAMILY_REVIEW_DIR'];
  if (directory == null) return;
  await tester.runAsync(() async {
    final boundary = tester.renderObject<RenderRepaintBoundary>(
      find.byKey(const ValueKey('family-review')),
    );
    final image = await boundary.toImage(pixelRatio: 1);
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    await Directory(directory).create(recursive: true);
    await File('$directory/$name.png').writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  testWidgets(
    'preserved alert routing is explicit and cannot be silently replaced',
    (tester) async {
      final client = _Client(preserved: true);
      await _pump(tester, client);
      await tester.tap(find.text('WhatsApp'));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('Your existing alert contacts are still active.'),
        findsOneWidget,
      );
      await tester.drag(find.byType(ListView).first, const Offset(0, -450));
      await tester.pumpAndSettle();
      final selections = tester
          .widgetList<SwitchListTile>(find.byType(SwitchListTile))
          .where(
            (tile) =>
                tile.title is Text &&
                ['Vikesh', 'Neelam'].contains((tile.title! as Text).data),
          );
      expect(selections.length, 2);
      expect(selections.every((tile) => tile.onChanged == null), isTrue);
      expect(find.text('Link my WhatsApp'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
  setUpAll(() async {
    if (Platform.environment['GUARDIAN_FAMILY_REVIEW_DIR'] != null) {
      final font = File('C:/Windows/Fonts/segoeui.ttf');
      if (await font.exists()) {
        await ui.loadFontFromList(
          await font.readAsBytes(),
          fontFamily: 'FamilyReview',
        );
      }
      final icons = File(
        'C:/Users/MSI/develop/flutter/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
      );
      if (await icons.exists()) {
        await ui.loadFontFromList(
          await icons.readAsBytes(),
          fontFamily: 'MaterialIcons',
        );
      }
    }
  });
  testWidgets('people roles and scoped invitation use the selected wearer', (
    tester,
  ) async {
    final client = _Client();
    await _pump(tester, client);
    expect(find.text('2 of 3 people · owner included'), findsOneWidget);
    expect(find.text('Vikesh (you)'), findsOneWidget);
    await _capture(tester, 'family-people-phone');
    await tester.tap(find.text('Invite a family member'));
    await tester.pumpAndSettle();
    expect(find.text('Voice messages'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'grandma@example.test');
    await tester.tap(find.text('Create invitation'));
    await tester.pumpAndSettle();
    expect(client.changes.single['imei'], '999999999999999');
    expect((client.changes.single['body'] as Map)['role'], 'viewer');
    expect(
      ((client.changes.single['body'] as Map)['permissions']
          as Map)['settings'],
      false,
    );
    expect(find.text('Personal invitation'), findsOneWidget);
  });
  testWidgets(
    'member cannot change other people or select recipients, but can consent',
    (tester) async {
      final client = _Client(owner: false);
      await _pump(tester, client);
      expect(find.text('Invite a family member'), findsNothing);
      expect(find.byTooltip('Edit access'), findsNothing);
      await tester.tap(find.text('WhatsApp'));
      await tester.pumpAndSettle();
      final ownConsent = find.widgetWithText(
        SwitchListTile,
        'I agree to WhatsApp safety messages for Amira',
      );
      await tester.tap(ownConsent);
      await tester.pumpAndSettle();
      expect(client.changes.single['body'], {
        'action': 'consent',
        'enabled': true,
      });
      final recipients = tester
          .widgetList<SwitchListTile>(find.byType(SwitchListTile))
          .where((tile) => tile.onChanged == null);
      expect(recipients, isNotEmpty);
    },
  );
  testWidgets(
    'allowance explains sharing and safety without suggesting paid overages',
    (tester) async {
      await _pump(tester, _Client());
      await tester.tap(find.text('Plan'));
      await tester.pumpAndSettle();
      expect(
        find.text('24 of 50 everyday WhatsApp answers used'),
        findsOneWidget,
      );
      expect(find.textContaining('No automatic paid overages'), findsOneWidget);
      expect(find.textContaining('SOS, fall alerts'), findsOneWidget);
      await _capture(tester, 'family-plan-phone');
    },
  );
  testWidgets(
    'unavailable service gives a recoverable state without fabricated members',
    (tester) async {
      await _pump(
        tester,
        _Client(error: const FamilySharingException('family_setup_pending')),
      );
      expect(find.textContaining('awaiting service setup'), findsOneWidget);
      expect(find.text('Vikesh (you)'), findsNothing);
      expect(find.text('Refresh'), findsOneWidget);
    },
  );
  for (final width in [320.0, 1100.0]) {
    testWidgets('Family fits width $width at enlarged text', (tester) async {
      await _pump(tester, _Client(), width: width, scale: 1.8);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('WhatsApp'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _capture(tester, 'family-whatsapp-${width.toInt()}');
    });
  }
}
