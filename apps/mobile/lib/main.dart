import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'firebase_options.dart';
import 'screens/auth_gate.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (DefaultFirebaseOptions.isConfigured) {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  }

  runApp(const GuardianApp());
}

class GuardianApp extends StatelessWidget {
  const GuardianApp({super.key});

  @override
  Widget build(BuildContext context) {
    final base = ThemeData(
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF1F8A4C),
        brightness: Brightness.light,
        surface: const Color(0xFFF7F4EF),
      ),
      useMaterial3: true,
    );

    return MaterialApp(
      title: 'Guardian',
      debugShowCheckedModeBanner: false,
      theme: base.copyWith(
        textTheme: GoogleFonts.dmSansTextTheme(base.textTheme),
      ),
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
          constraints: const BoxConstraints(maxWidth: 520),
          child: const Padding(
            padding: EdgeInsets.all(28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Guardian',
                  style: TextStyle(fontSize: 36, fontWeight: FontWeight.w800),
                ),
                SizedBox(height: 12),
                Text(
                  'Firebase Web app config is still missing.',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                SizedBox(height: 12),
                Text(
                  'See docs/FLUTTER_SETUP.md to register the Web app and paste config '
                  'into lib/firebase_options.dart.',
                  style: TextStyle(height: 1.45),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
