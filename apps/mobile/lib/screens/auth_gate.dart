import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import 'login_page.dart';
import 'map_dashboard_page.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final _auth = AuthService();
  Future<void>? _profileFuture;
  String? _profileUid;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: _auth.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final user = snapshot.data;
        if (user == null) {
          _profileFuture = null;
          _profileUid = null;
          return const LoginPage();
        }

        if (_profileUid != user.uid || _profileFuture == null) {
          _profileUid = user.uid;
          _profileFuture = _auth.ensureUserProfile(user);
        }

        return FutureBuilder<void>(
          future: _profileFuture,
          builder: (context, profileSnap) {
            if (profileSnap.connectionState != ConnectionState.done) {
              return const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              );
            }
            if (profileSnap.hasError) {
              return Scaffold(
                body: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text('Could not load profile.\n${profileSnap.error}'),
                  ),
                ),
              );
            }
            return const MapDashboardPage();
          },
        );
      },
    );
  }
}
