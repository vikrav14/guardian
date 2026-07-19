import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/l10n/app_localizations.dart';
import 'package:guardian/l10n/app_localizations_mfe.dart';
import 'package:guardian/main.dart';
import 'package:guardian/widgets/guardian_widgets.dart';

Widget _wrap(Widget child, {Locale locale = const Locale('en')}) {
  return MaterialApp(
    locale: locale,
    supportedLocales: AppLocalizations.supportedLocales,
    localizationsDelegates: guardianLocalizationsDelegates,
    home: Scaffold(body: child),
  );
}

void main() {
  testWidgets('GuardianBottomNav shows localized English labels and reports taps', (tester) async {
    var tapped = -1;
    await tester.pumpWidget(
      _wrap(GuardianBottomNav(currentIndex: 0, onTap: (i) => tapped = i)),
    );

    expect(find.text('Map'), findsOneWidget);
    expect(find.text('Safe zones'), findsOneWidget);
    expect(find.text('Alerts'), findsOneWidget);
    expect(find.text('Account'), findsOneWidget);

    await tester.tap(find.text('Alerts'));
    expect(tapped, 2);
  });

  testWidgets('GuardianBottomNav shows French labels when locale is fr', (tester) async {
    await tester.pumpWidget(
      _wrap(
        GuardianBottomNav(currentIndex: 0, onTap: (_) {}),
        locale: const Locale('fr'),
      ),
    );

    expect(find.text('Carte'), findsOneWidget);
    expect(find.text('Alertes'), findsOneWidget);
    expect(find.text('Compte'), findsOneWidget);
  });

  test('Kreol Morisien translations are present for the core nav labels', () {
    final t = AppLocalizationsMfe();
    expect(t.navMap, 'Kart');
    expect(t.navAlerts, 'Alert');
    expect(t.navAccount, 'Kont');
  });

  testWidgets(
    'locale mfe does not crash a widget that requires MaterialLocalizations',
    (tester) async {
      // Regression test: Flutter's built-in Material/Cupertino/Widgets
      // localizations don't ship an 'mfe' translation. Without the fallback
      // delegates in guardianLocalizationsDelegates, any widget requiring
      // MaterialLocalizations (PopupMenuButton, here) throws as soon as the
      // app locale is set to 'mfe' -- this is exactly what happened on the
      // Safe Zones page's per-zone menu the first time this was tried live.
      await tester.pumpWidget(
        _wrap(
          PopupMenuButton<String>(
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'a', child: Text('A')),
            ],
          ),
          locale: const Locale('mfe'),
        ),
      );

      expect(tester.takeException(), isNull);
      expect(find.byType(PopupMenuButton<String>), findsOneWidget);
    },
  );
}
