import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'firebase_options.dart';
import 'l10n/app_localizations.dart';
import 'screens/auth_gate.dart';
import 'services/locale_service.dart';
import 'services/push_service.dart';
import 'services/theme_service.dart';
import 'theme/app_theme.dart';

/// Flutter's built-in Material/Cupertino/Widgets localizations don't ship a
/// Kreol Morisien ('mfe') translation. Without a fallback, any widget that
/// requires MaterialLocalizations (e.g. PopupMenuButton) crashes outright
/// when the app locale is 'mfe' — this makes those specific framework
/// strings fall back to English while our own AppLocalizations.mfe strings
/// (nav labels, buttons, etc.) still render correctly.
class _MfeFallbackDelegate<T> extends LocalizationsDelegate<T> {
  const _MfeFallbackDelegate(this._delegate);

  final LocalizationsDelegate<T> _delegate;

  @override
  bool isSupported(Locale locale) => locale.languageCode == 'mfe';

  @override
  Future<T> load(Locale locale) => _delegate.load(const Locale('en'));

  @override
  bool shouldReload(_MfeFallbackDelegate<T> old) => false;
}

/// The exact delegate list the app runs with — exposed so tests exercise the
/// same configuration rather than a hand-rolled copy that can drift.
final List<LocalizationsDelegate<dynamic>> guardianLocalizationsDelegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
  _MfeFallbackDelegate<MaterialLocalizations>(GlobalMaterialLocalizations.delegate),
  _MfeFallbackDelegate<WidgetsLocalizations>(GlobalWidgetsLocalizations.delegate),
  _MfeFallbackDelegate<CupertinoLocalizations>(GlobalCupertinoLocalizations.delegate),
];

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (DefaultFirebaseOptions.isConfigured) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    unawaited(_initializeOptionalPush());
  }

  runApp(const GuardianApp());
}

Future<void> _initializeOptionalPush() async {
  try {
    await PushService.initLocalNotifications();
    PushService.listenForegroundMessages();
  } catch (error) {
    debugPrint('Push initialization unavailable: $error');
  }
}

class GuardianApp extends StatefulWidget {
  const GuardianApp({super.key});

  /// Lets any screen change the app's language, e.g. from account_page.dart.
  static void setLocale(BuildContext context, Locale locale) {
    context.findAncestorStateOfType<_GuardianAppState>()?._setLocale(locale);
  }

  /// Lets any screen change the app theme, e.g. from account_page.dart.
  static void setTheme(BuildContext context, GuardianThemeId theme) {
    GuardianThemeScope.maybeOf(context)?.setTheme(theme);
  }

  static GuardianThemeId? themeOf(BuildContext context) {
    return GuardianThemeScope.maybeOf(context)?.themeId;
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
      localizationsDelegates: guardianLocalizationsDelegates,
      home: DefaultFirebaseOptions.isConfigured
          ? const _ThemedAppRoot()
          : const _FirebaseSetupPage(),
    );
  }
}

/// Holds theme state inside [MaterialApp] so switching themes updates colors
/// without recreating the navigator or tearing down platform views like
/// Google Maps on web.
class GuardianThemeScope extends InheritedWidget {
  const GuardianThemeScope({
    super.key,
    required this.themeId,
    required this.onThemeChanged,
    required super.child,
  });

  final GuardianThemeId themeId;
  final ValueChanged<GuardianThemeId> onThemeChanged;

  static GuardianThemeScope? maybeOf(BuildContext context) {
    return context.getInheritedWidgetOfExactType<GuardianThemeScope>();
  }

  void setTheme(GuardianThemeId theme) {
    if (themeId == theme) return;
    onThemeChanged(theme);
  }

  @override
  bool updateShouldNotify(GuardianThemeScope oldWidget) {
    return themeId != oldWidget.themeId;
  }
}

class _ThemedAppRoot extends StatefulWidget {
  const _ThemedAppRoot();

  @override
  State<_ThemedAppRoot> createState() => _ThemedAppRootState();
}

class _ThemedAppRootState extends State<_ThemedAppRoot> {
  GuardianThemeId _themeId = GuardianThemeId.defaultTheme;

  @override
  void initState() {
    super.initState();
    ThemeService.loadSavedTheme().then((saved) {
      if (mounted) setState(() => _themeId = saved);
    });
  }

  void _setTheme(GuardianThemeId theme) {
    setState(() => _themeId = theme);
    ThemeService.saveTheme(theme);
  }

  @override
  Widget build(BuildContext context) {
    return GuardianThemeScope(
      themeId: _themeId,
      onThemeChanged: _setTheme,
      child: Theme(
        data: buildGuardianTheme(themeId: _themeId),
        child: const AuthGate(),
      ),
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
