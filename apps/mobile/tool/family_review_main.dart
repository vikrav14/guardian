// Isolated review entry point. No production project, push registration or
// watch connection. All authenticated operations use the real app/API/rules.
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:guardian/main.dart';
import 'package:guardian/screens/home_shell.dart';

const _people = <String, String>{
  'vikesh': 'Vikesh · owner',
  'neelam': 'Neelam · invite this account',
  'ravi': 'Ravi · viewer',
};

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  const gateway = String.fromEnvironment('GUARDIAN_GATEWAY_URL');
  if (gateway != 'http://127.0.0.1:9011') {
    throw StateError('Review builds require the isolated local gateway.');
  }
  await Firebase.initializeApp(
    options: const FirebaseOptions(
      apiKey: 'guardian-review-emulator-only',
      appId: '1:123456789:web:guardianreview',
      messagingSenderId: '123456789',
      projectId: 'demo-guardian-family',
      authDomain: 'demo-guardian-family.firebaseapp.com',
      storageBucket: 'demo-guardian-family.appspot.com',
    ),
  );
  await FirebaseAuth.instance.useAuthEmulator('127.0.0.1', 9195);
  // A release-web reload can restore a persisted user before FlutterFire
  // connects its Auth emulator. Keep disposable review sessions in memory so
  // startup never tries to refresh an emulator token against the cloud SDK.
  await FirebaseAuth.instance.setPersistence(Persistence.NONE);
  FirebaseFirestore.instance.useFirestoreEmulator('127.0.0.1', 8185);
  FirebaseFirestore.instance.settings = const Settings(
    persistenceEnabled: false,
  );
  await FirebaseStorage.instance.useStorageEmulator('127.0.0.1', 9295);
  runApp(const GuardianApp(home: _ReviewRoot()));
}

class _ReviewRoot extends StatefulWidget {
  const _ReviewRoot();
  @override
  State<_ReviewRoot> createState() => _ReviewRootState();
}

class _ReviewRootState extends State<_ReviewRoot> {
  late final _users = FirebaseAuth.instance.authStateChanges();
  bool _busy = false;
  String? _error;
  Future<void> _choose(String value) async {
    if (value == 'whatsapp') {
      await showDialog<void>(
        context: context,
        builder: (_) => const _WhatsAppSimulation(),
      );
    } else {
      await _signIn(value);
    }
  }

  Future<void> _signIn(String person) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await FirebaseAuth.instance.signOut();
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: '$person@guardian.test',
        password: 'Guardian-review-2026!',
      );
    } catch (error) {
      if (mounted) {
        final reason = error is FirebaseAuthException
            ? error.code
            : 'unavailable';
        setState(
          () => _error =
              'Test sign-in failed ($reason). Check the local review service.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<User?>(
    stream: _users,
    builder: (context, snapshot) {
      final user = snapshot.data;
      return Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              Container(
                width: double.infinity,
                color: const Color(0xffeaf1e5),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'GUARDIAN TEST\nSample people • no live alerts',
                        style: TextStyle(
                          fontSize: 12,
                          color: Color(0xff233d29),
                        ),
                      ),
                    ),
                    if (user != null)
                      PopupMenuButton<String>(
                        tooltip: 'Switch test account',
                        enabled: !_busy,
                        onSelected: _choose,
                        itemBuilder: (_) => [
                          for (final person in _people.entries)
                            PopupMenuItem(
                              value: person.key,
                              child: Text(person.value),
                            ),
                          const PopupMenuItem(
                            value: 'whatsapp',
                            child: Text('Simulate WhatsApp message'),
                          ),
                        ],
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text(
                            '${user.displayName ?? 'Test account'} ▾',
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              if (_error != null)
                Padding(padding: const EdgeInsets.all(8), child: Text(_error!)),
              Expanded(
                child: user == null || _busy
                    ? Center(
                        child: SingleChildScrollView(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'Try family sharing',
                                  style: Theme.of(
                                    context,
                                  ).textTheme.headlineSmall,
                                ),
                                const SizedBox(height: 12),
                                const Text(
                                  'Start as Vikesh. Invite neelam@guardian.test, then switch to Neelam to accept the code. These accounts exist only on this laptop.',
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 20),
                                for (final person in _people.entries)
                                  Padding(
                                    padding: const EdgeInsets.all(5),
                                    child: FilledButton(
                                      onPressed: _busy
                                          ? null
                                          : () => _signIn(person.key),
                                      child: Text(person.value),
                                    ),
                                  ),
                                if (_busy) const CircularProgressIndicator(),
                              ],
                            ),
                          ),
                        ),
                      )
                    : HomeShell(key: ValueKey(user.uid), initialIndex: 2),
              ),
            ],
          ),
        ),
      );
    },
  );
}

class _WhatsAppSimulation extends StatefulWidget {
  const _WhatsAppSimulation();
  @override
  State<_WhatsAppSimulation> createState() => _WhatsAppSimulationState();
}

class _WhatsAppSimulationState extends State<_WhatsAppSimulation> {
  final _text = TextEditingController();
  String _result = '';
  bool _busy = false;
  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      final token = await FirebaseAuth.instance.currentUser!.getIdToken();
      final response = await http
          .post(
            Uri.parse('http://127.0.0.1:9011/review/whatsapp'),
            headers: {
              'Authorization': 'Bearer $token',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'text': _text.text}),
          )
          .timeout(const Duration(seconds: 15));
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode != 200) throw StateError('Simulation failed');
      if (mounted) {
        setState(
          () => _result = (data['replies'] as List).isNotEmpty
              ? (data['replies'] as List).join('\n\n')
              : data['handled'] == true
              ? 'Processed. Refresh Family to check the linked number or response.'
              : 'No linked test number yet. Generate a code in Family → WhatsApp and paste the LINK text here.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _result = 'Simulation unavailable. Check the local test service.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('WhatsApp simulation'),
    content: SizedBox(
      width: 440,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'No real message is sent. This uses a test number for the selected account and the same backend checks as WhatsApp.',
            ),
            const SizedBox(height: 12),
            const Text(
              'Paste LINK text, or try “999991 battery”, “999991 where”, or “ACK review-sos”.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _text,
              decoration: const InputDecoration(labelText: 'Simulated message'),
              maxLines: 3,
            ),
            if (_result.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: SelectableText(_result),
              ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.pop(context),
        child: const Text('Close'),
      ),
      FilledButton(
        onPressed: _busy ? null : _send,
        child: Text(_busy ? 'Checking…' : 'Simulate'),
      ),
    ],
  );
}
