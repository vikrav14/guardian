import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'firebase_options.dart';
import 'l10n/app_localizations.dart';
import 'screens/auth_gate.dart';
import 'services/locale_service.dart';
import 'services/push_service.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (DefaultFirebaseOptions.isConfigured) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await PushService.initLocalNotifications();
    PushService.listenForegroundMessages();
  }

  runApp(const GuardianApp());
}

class GuardianApp extends StatefulWidget {
  const GuardianApp({super.key});

  /// Lets any screen change the app's language, e.g. from account_page.dart.
  static void setLocale(BuildContext context, Locale locale) {
    context.findAncestorStateOfType<_GuardianAppState>()?._setLocale(locale);
  }

  @override
  State<GuardianApp> createState() => _GuardianAppState();
}

class _GuardianAppState extends State<GuardianApp> {
  Locale? _locale;

  @override
  void initState() {
    super.initState();
    LocaleService.loadSavedLocale().then((saved) {
      if (saved != null && mounted) setState(() => _locale = saved);
    });
  }

  void _setLocale(Locale locale) {
    setState(() => _locale = locale);
    LocaleService.saveLocale(locale);
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Guardian',
      debugShowCheckedModeBanner: false,
      theme: buildGuardianTheme(),
      locale: _locale,
      supportedLocales: LocaleService.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: DefaultFirebaseOptions.isConfigured
          ? const AuthGate()
          : const _FirebaseSetupPage(),
    );
  }
}

class _FirebaseSetupPage extends StatelessWidget {
  const _FirebaseSetupPage();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 480),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Guardian', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 12),
                const Text(
                  'Firebase Web app config is still missing. See docs/FLUTTER_SETUP.md.',
                  style: TextStyle(color: GuardianColors.textSecondary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
