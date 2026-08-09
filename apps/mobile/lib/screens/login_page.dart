import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/brand/dodo_ai_icon.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _auth = AuthService();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _registerMode = false;
  bool _obscure = true;
  bool _busy = false;
  String? _error;
  String? _resetSent;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  String _friendlyAuthError(FirebaseAuthException e) {
    switch (e.code) {
      case 'operation-not-allowed':
        return 'Email/Password sign-in is disabled in Firebase.';
      case 'email-already-in-use':
        return 'That email is already registered. Try Sign in instead.';
      case 'invalid-email':
        return 'That email address looks invalid.';
      case 'weak-password':
        return 'Password is too weak (use at least 6 characters).';
      case 'invalid-credential':
      case 'wrong-password':
      case 'user-not-found':
        return 'Wrong email or password.';
      case 'network-request-failed':
        return 'Network error — check your internet connection.';
      default:
        return '${e.message ?? 'Authentication failed'} (${e.code})';
    }
  }

  Future<void> _resetPassword() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() {
        _error = 'Enter your email above, then tap Forgot password.';
        _resetSent = null;
      });
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _resetSent = null;
    });
    try {
      await _auth.sendPasswordResetEmail(email);
      setState(
        () => _resetSent = 'Password reset email sent — check your inbox.',
      );
    } on FirebaseAuthException catch (e) {
      setState(() => _error = _friendlyAuthError(e));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
      _resetSent = null;
    });
    try {
      if (_registerMode) {
        await _auth.register(
          email: _email.text.trim(),
          password: _password.text,
          displayName: _name.text.trim(),
        );
      } else {
        final cred = await _auth.signIn(
          email: _email.text.trim(),
          password: _password.text,
        );
        await _auth.ensureUserProfile(cred.user!);
      }
    } on FirebaseAuthException catch (e) {
      setState(() => _error = _friendlyAuthError(e));
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: GuardianColors.safeBg,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const GuardianBrandMark(
                      size: 64,
                      borderRadius: 18,
                      iconScale: 0.5,
                      showShadow: false,
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Guardian',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'Keep watch over the people who matter',
                      style: TextStyle(
                        fontSize: 13,
                        color: GuardianColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 24),
                    Container(
                      padding: const EdgeInsets.all(20),
                      decoration: BoxDecoration(
                        color: GuardianColors.surface,
                        borderRadius: BorderRadius.circular(18),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _registerMode ? 'Create account' : 'Sign in',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          if (_registerMode) ...[
                            const SizedBox(height: 14),
                            const Text(
                              'Display name',
                              style: TextStyle(
                                fontSize: 12,
                                color: GuardianColors.textSecondary,
                              ),
                            ),
                            const SizedBox(height: 5),
                            TextFormField(
                              controller: _name,
                              textInputAction: TextInputAction.next,
                              decoration: const InputDecoration(
                                hintText: 'Your name',
                              ),
                            ),
                          ],
                          const SizedBox(height: 14),
                          const Text(
                            'Email',
                            style: TextStyle(
                              fontSize: 12,
                              color: GuardianColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 5),
                          TextFormField(
                            controller: _email,
                            keyboardType: TextInputType.emailAddress,
                            textInputAction: TextInputAction.next,
                            decoration: const InputDecoration(
                              hintText: 'name@family.com',
                            ),
                            validator: (v) {
                              if (v == null || !v.contains('@'))
                                return 'Enter a valid email';
                              return null;
                            },
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            'Password',
                            style: TextStyle(
                              fontSize: 12,
                              color: GuardianColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: 5),
                          TextFormField(
                            controller: _password,
                            obscureText: _obscure,
                            textInputAction: TextInputAction.done,
                            onFieldSubmitted: (_) => _submit(),
                            decoration: InputDecoration(
                              hintText: '••••••••',
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscure
                                      ? Icons.visibility_off
                                      : Icons.visibility,
                                  size: 18,
                                ),
                                onPressed: () =>
                                    setState(() => _obscure = !_obscure),
                              ),
                            ),
                            validator: (v) {
                              if (v == null || v.length < 6)
                                return 'At least 6 characters';
                              return null;
                            },
                          ),
                          if (!_registerMode) ...[
                            Align(
                              alignment: Alignment.centerRight,
                              child: TextButton(
                                onPressed: _busy ? null : _resetPassword,
                                style: TextButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 0,
                                    vertical: 4,
                                  ),
                                  minimumSize: Size.zero,
                                  tapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                                child: const Text(
                                  'Forgot password?',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: GuardianColors.safeText,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ),
                          ],
                          if (_resetSent != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              _resetSent!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: GuardianColors.safeText,
                              ),
                            ),
                          ],
                          if (_error != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              _error!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: GuardianColors.danger,
                              ),
                            ),
                          ],
                          const SizedBox(height: 18),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton(
                              onPressed: _busy ? null : _submit,
                              child: _busy
                                  ? const SizedBox(
                                      width: 18,
                                      height: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : Text(
                                      _registerMode
                                          ? 'Create account'
                                          : 'Sign in',
                                    ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          Center(
                            child: TextButton(
                              onPressed: _busy
                                  ? null
                                  : () => setState(() {
                                      _registerMode = !_registerMode;
                                      _error = null;
                                      _resetSent = null;
                                    }),
                              child: Text(
                                _registerMode
                                    ? 'Already have an account? Sign in'
                                    : 'New here? Create an account',
                                style: const TextStyle(
                                  fontSize: 13,
                                  color: GuardianColors.safeText,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
