import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../theme/app_theme.dart';
import '../widgets/auth/guardian_welcome_layout.dart';

class LoginPage extends StatefulWidget {
  const LoginPage({super.key, this.authService});

  final AuthService? authService;

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  late final AuthService _auth = widget.authService ?? AuthService();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _name = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  bool _registerMode = false;
  bool _obscure = true;
  bool _busy = false;
  bool _resetting = false;
  String? _error;
  String? _resetSent;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    super.dispose();
  }

  String _friendlyAuthError(FirebaseAuthException error) {
    return switch (error.code) {
      'email-already-in-use' =>
        'An account already uses this email. Try signing in instead.',
      'invalid-email' => 'Please check your email address.',
      'weak-password' => 'Choose a password with at least 6 characters.',
      'invalid-credential' || 'wrong-password' || 'user-not-found' =>
        'The email or password did not match. Please try again.',
      'network-request-failed' =>
        'We could not connect. Check your internet connection and try again.',
      'too-many-requests' =>
        'There have been too many attempts. Please wait a moment and try again.',
      'user-disabled' =>
        'This account is currently unavailable. Please contact Guardian support.',
      _ => 'We could not complete that request. Please try again shortly.',
    };
  }

  bool _validEmail(String value) {
    return RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$').hasMatch(value.trim());
  }

  Future<void> _resetPassword() async {
    if (_busy || _registerMode) return;
    final email = _email.text.trim();
    if (!_validEmail(email)) {
      setState(() {
        _error = 'Enter your email address above, then choose Forgot password.';
        _resetSent = null;
      });
      return;
    }
    setState(() {
      _busy = true;
      _resetting = true;
      _error = null;
      _resetSent = null;
    });
    try {
      await _auth.sendPasswordResetEmail(email);
      if (!mounted) return;
      setState(() {
        _resetSent =
            'If an account uses this email, you will receive a password reset link. Check your inbox.';
      });
    } on FirebaseAuthException catch (error) {
      if (mounted) setState(() => _error = _friendlyAuthError(error));
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'We could not send the reset email. Please try again shortly.';
        });
      }
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _resetting = false;
        });
      }
    }
  }

  Future<void> _submit() async {
    if (_busy) return;
    setState(() {
      _error = null;
      _resetSent = null;
    });
    if (!(_formKey.currentState?.validate() ?? false)) return;
    final email = _email.text.trim();
    final password = _password.text;
    final displayName = _name.text.trim();
    final registerMode = _registerMode;
    setState(() => _busy = true);
    try {
      if (registerMode) {
        await _auth.register(
          email: email,
          password: password,
          displayName: displayName,
        );
      } else {
        final credential = await _auth.signIn(email: email, password: password);
        final user = credential.user;
        if (user != null) await _auth.ensureUserProfile(user);
      }
    } on FirebaseAuthException catch (error) {
      if (mounted) setState(() => _error = _friendlyAuthError(error));
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'We could not complete that request. Please try again shortly.';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _changeMode() {
    if (_busy) return;
    final email = _email.text;
    _formKey.currentState?.reset();
    _email.text = email;
    _password.clear();
    setState(() {
      _registerMode = !_registerMode;
      _obscure = true;
      _error = null;
      _resetSent = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final theme = Theme.of(context);
    final dark = theme.brightness == Brightness.dark;
    final textStyle = theme.textTheme.bodyMedium!.copyWith(
      color: colors.textSecondary,
      fontSize: 14,
      height: 1.5,
    );
    final linkColor = dark ? const Color(0xFFAADEC8) : const Color(0xFF235C48);

    return GuardianWelcomeLayout(
      registerMode: _registerMode,
      form: LayoutBuilder(
        builder: (context, constraints) {
          return Container(
            padding: EdgeInsets.all(constraints.maxWidth >= 400 ? 32 : 24),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(28),
              border: Border.all(color: colors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: dark ? 0.10 : 0.025),
                  blurRadius: 32,
                  offset: const Offset(0, 12),
                ),
              ],
            ),
            child: AutofillGroup(
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(
                        _registerMode
                            ? 'Begin with the people you love'
                            : 'Welcome back',
                        style: theme.textTheme.headlineSmall!.copyWith(
                          color: colors.textPrimary,
                          fontSize: 28,
                          fontWeight: FontWeight.w700,
                          height: 1.2,
                          letterSpacing: -0.7,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      _registerMode
                          ? 'Create your account, then connect your family’s Guardian watch.'
                          : 'Sign in to your family’s Guardian space.',
                      style: textStyle,
                    ),
                    const SizedBox(height: 28),
                    if (_registerMode) ...[
                      _field(
                        label: 'Your name',
                        fieldKey: const ValueKey('login-name'),
                        controller: _name,
                        icon: Icons.person_outline_rounded,
                        hint: 'What should we call you?',
                        autofillHints: const [AutofillHints.name],
                        capitalization: TextCapitalization.words,
                      ),
                      const SizedBox(height: 20),
                    ],
                    _field(
                      label: 'Email address',
                      fieldKey: const ValueKey('login-email'),
                      controller: _email,
                      icon: Icons.mail_outline_rounded,
                      hint: 'you@example.com',
                      autofillHints: const [AutofillHints.email],
                      keyboardType: TextInputType.emailAddress,
                      validator: (value) => _validEmail(value ?? '')
                          ? null
                          : 'Enter a valid email address.',
                    ),
                    const SizedBox(height: 20),
                    _field(
                      label: 'Password',
                      fieldKey: const ValueKey('login-password'),
                      controller: _password,
                      icon: Icons.lock_outline_rounded,
                      hint: _registerMode ? 'At least 6 characters' : 'Your password',
                      autofillHints: [
                        _registerMode
                            ? AutofillHints.newPassword
                            : AutofillHints.password,
                      ],
                      password: true,
                      validator: (value) => (value?.length ?? 0) >= 6
                          ? null
                          : 'Use at least 6 characters.',
                    ),
                    if (!_registerMode)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(
                          onPressed: _busy ? null : _resetPassword,
                          style: TextButton.styleFrom(
                            foregroundColor: linkColor,
                            minimumSize: const Size(48, 48),
                            padding: const EdgeInsets.symmetric(horizontal: 4),
                            textStyle: textStyle.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          child: const Text('Forgot password?'),
                        ),
                      ),
                    if (_resetSent != null || _error != null) ...[
                      const SizedBox(height: 12),
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          _error ?? _resetSent!,
                          style: textStyle.copyWith(
                            color: _error != null
                                ? theme.colorScheme.error
                                : linkColor,
                          ),
                        ),
                      ),
                    ],
                    SizedBox(height: _registerMode ? 28 : 16),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton(
                        key: const ValueKey('login-submit'),
                        onPressed: _busy ? null : _submit,
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF193F33),
                          foregroundColor: Colors.white,
                          disabledBackgroundColor: const Color(0xFF446A5C),
                          disabledForegroundColor: Colors.white,
                          minimumSize: const Size(48, 52),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 14,
                          ),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                          textStyle: theme.textTheme.labelLarge!.copyWith(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        child: _busy
                            ? SizedBox.square(
                                dimension: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                  semanticsLabel: _resetting
                                      ? 'Sending reset email'
                                      : _registerMode
                                      ? 'Creating account'
                                      : 'Signing in',
                                ),
                              )
                            : Text(
                                _registerMode ? 'Create account' : 'Sign in',
                                textAlign: TextAlign.center,
                              ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Divider(height: 1, color: colors.border),
                    const SizedBox(height: 18),
                    Center(
                      child: Text(
                        _registerMode ? 'Already part of Guardian?' : 'New to Guardian?',
                        textAlign: TextAlign.center,
                        style: textStyle,
                      ),
                    ),
                    Center(
                      child: TextButton(
                        key: const ValueKey('login-mode-toggle'),
                        onPressed: _busy ? null : _changeMode,
                        style: TextButton.styleFrom(
                          foregroundColor: linkColor,
                          minimumSize: const Size(48, 48),
                          textStyle: textStyle.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        child: Text(
                          _registerMode ? 'Sign in to your account' : 'Create an account',
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _field({
    required String label,
    required Key fieldKey,
    required TextEditingController controller,
    required IconData icon,
    required String hint,
    required Iterable<String> autofillHints,
    TextInputType keyboardType = TextInputType.text,
    TextCapitalization capitalization = TextCapitalization.none,
    FormFieldValidator<String>? validator,
    bool password = false,
  }) {
    final colors = context.guardianColors;
    final theme = Theme.of(context);
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(14),
      borderSide: BorderSide(color: colors.border),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Text(
            label,
            style: theme.textTheme.labelLarge!.copyWith(
              color: colors.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(height: 8),
        Semantics(
          label: label,
          child: TextFormField(
            key: fieldKey,
            controller: controller,
            readOnly: _busy,
            obscureText: password && _obscure,
            keyboardType: keyboardType,
            textCapitalization: capitalization,
            autocorrect: false,
            enableSuggestions: !password,
            autofillHints: autofillHints,
            textInputAction: password ? TextInputAction.done : TextInputAction.next,
            onFieldSubmitted: password ? (_) => _submit() : null,
            style: theme.textTheme.bodyLarge!.copyWith(
              color: colors.textPrimary,
              fontSize: 16,
            ),
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: TextStyle(color: colors.textSecondary, fontSize: 16),
              filled: true,
              fillColor: Color.alphaBlend(
                colors.canvas.withValues(alpha: 0.45),
                colors.surface,
              ),
              constraints: const BoxConstraints(minHeight: 56),
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
              border: border,
              enabledBorder: border,
              focusedBorder: border.copyWith(
                borderSide: BorderSide(color: colors.accent, width: 1.5),
              ),
              errorBorder: border.copyWith(
                borderSide: BorderSide(color: theme.colorScheme.error),
              ),
              focusedErrorBorder: border.copyWith(
                borderSide: BorderSide(color: theme.colorScheme.error, width: 1.5),
              ),
              errorMaxLines: 3,
              prefixIcon: ExcludeSemantics(
                child: Icon(icon, size: 20, color: colors.textSecondary),
              ),
              suffixIcon: password
                  ? IconButton(
                      tooltip: _obscure ? 'Show password' : 'Hide password',
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.transparent,
                        foregroundColor: colors.textSecondary,
                        minimumSize: const Size(48, 48),
                        side: BorderSide.none,
                        shape: const CircleBorder(),
                      ),
                      onPressed: _busy ? null : () => setState(() => _obscure = !_obscure),
                      icon: Icon(
                        _obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined,
                        size: 20,
                      ),
                    )
                  : null,
            ),
            validator: validator,
          ),
        ),
      ],
    );
  }
}
