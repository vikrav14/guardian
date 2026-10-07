import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../services/push_service.dart';
import '../widgets/brand/guardian_loading_screen.dart';
import '../widgets/brand/guardian_startup_gate.dart';
import 'home_shell.dart';
import '../models/incident_photos.dart';
import 'login_page.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key, this.onReady});

  final VoidCallback? onReady;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  final _auth = AuthService();
  late final _authChanges = _auth.authStateChanges();
  Future<void>? _profileFuture;
  String? _profileUid;
  final String? _incidentId = incidentFromUri(Uri.base);
  bool _reportedReady = false;

  void _reportReady() {
    if (_reportedReady) return;
    _reportedReady = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (widget.onReady != null) {
        widget.onReady!();
      } else {
        GuardianStartupGate.reportReady(context);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: _authChanges,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const GuardianLoadingScreen();
        }

        final user = snapshot.data;
        if (user == null) {
          _profileFuture = null;
          _profileUid = null;
          _reportReady();
          return const LoginPage();
        }

        if (_profileUid != user.uid || _profileFuture == null) {
          _profileUid = user.uid;
          _profileFuture = _auth.ensureUserProfile(user);
          unawaited(
            _profileFuture!.then<void>(
              (_) async {
                try {
                  await PushService().registerForUser(user.uid);
                } catch (error) {
                  // Push is optional. A browser that blocks notifications or
                  // service workers must not prevent the safety dashboard from
                  // opening.
                  debugPrint('Push registration unavailable: $error');
                }
              },
              onError: (Object error, StackTrace stack) {
                // The FutureBuilder below owns the profile error UI.
              },
            ),
          );
        }

        return FutureBuilder<void>(
          future: _profileFuture,
          builder: (context, profileSnap) {
            if (profileSnap.connectionState != ConnectionState.done) {
              return const GuardianLoadingScreen();
            }
            _reportReady();
            if (profileSnap.hasError) {
              return Scaffold(
                body: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      'Could not load profile.\n${profileSnap.error}',
                    ),
                  ),
                ),
              );
            }
            return HomeShell(initialIncidentId: _incidentId);
          },
        );
      },
    );
  }
}
