import 'dart:async';

import 'package:fake_cloud_firestore/fake_cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_auth_mocks/firebase_auth_mocks.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/screens/login_page.dart';
import 'package:guardian/services/auth_service.dart';
import 'package:guardian/services/push_service.dart';
import 'package:guardian/theme/colors.dart';

class _TestAuthService extends AuthService {
  _TestAuthService(this.database)
    : super(
        auth: MockFirebaseAuth(
          mockUser: MockUser(uid: 'family-user', email: 'family@example.com'),
        ),
        db: database,
        push: PushService(db: database),
      );

  final FakeFirebaseFirestore database;
  Completer<void>? signInGate;
  Completer<void>? resetGate;
  Object? signInError;
  int signInCalls = 0;
  int registerCalls = 0;
  int resetCalls = 0;
  String? submittedEmail;
  String? submittedName;

  @override
  Future<UserCredential> signIn({
    required String email,
    required String password,
  }) async {
    signInCalls++;
    submittedEmail = email;
    if (signInGate != null) await signInGate!.future;
    final error = signInError;
    if (error != null) throw error;
    return super.signIn(email: email, password: password);
  }

  @override
  Future<UserCredential> register({
    required String email,
    required String password,
    String? displayName,
  }) {
    registerCalls++;
    submittedEmail = email;
    submittedName = displayName;
    return super.register(
      email: email,
      password: password,
      displayName: displayName,
    );
  }

  @override
  Future<void> sendPasswordResetEmail(String email) async {
    resetCalls++;
    submittedEmail = email;
    if (resetGate != null) await resetGate!.future;
    await super.sendPasswordResetEmail(email);
  }
}

final _email = find.byKey(const ValueKey('login-email'));
final _password = find.byKey(const ValueKey('login-password'));
final _name = find.byKey(const ValueKey('login-name'));
final _submit = find.byKey(const ValueKey('login-submit'));
final _mode = find.byKey(const ValueKey('login-mode-toggle'));

Future<void> _pump(
  WidgetTester tester,
  _TestAuthService auth, {
  double width = 1280,
  double textScale = 1,
  bool dark = false,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 1000);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final colors = dark ? GuardianThemeColors.dark : GuardianThemeColors.light;
  final brightness = dark ? Brightness.dark : Brightness.light;
  await tester.pumpWidget(
    MaterialApp(
      theme: ThemeData(
        useMaterial3: true,
        brightness: brightness,
        extensions: [colors],
        colorScheme: ColorScheme.fromSeed(
          seedColor: colors.accent,
          brightness: brightness,
          surface: colors.surface,
        ),
      ),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScale),
        ),
        child: child!,
      ),
      home: LoginPage(key: ObjectKey(auth), authService: auth),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pump();
}

Future<void> _credentials(WidgetTester tester) async {
  await tester.ensureVisible(_email);
  await tester.enterText(_email, '  family@example.com  ');
  await tester.ensureVisible(_password);
  await tester.enterText(_password, 'secret1');
}

void main() {
  testWidgets('invalid input does not start an authentication request', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    await _pump(tester, auth);
    await _tap(tester, _submit);
    await tester.pumpAndSettle();

    expect(find.text('Enter a valid email address.'), findsOneWidget);
    expect(find.text('Use at least 6 characters.'), findsOneWidget);
    expect(auth.signInCalls, 0);
    expect(auth.registerCalls, 0);
  });

  testWidgets('sign in trims email and preserves the empty-family profile flow', (
    tester,
  ) async {
    final database = FakeFirebaseFirestore();
    final auth = _TestAuthService(database);
    await _pump(tester, auth);
    await _credentials(tester);
    await _tap(tester, _submit);
    await tester.pumpAndSettle();

    expect(auth.signInCalls, 1);
    expect(auth.submittedEmail, 'family@example.com');
    final profile = await database.collection('users').doc('family-user').get();
    expect(profile.exists, isTrue);
    expect(profile.data()!['linkedImeis'], isEmpty);
    expect(profile.data()!['role'], 'guardian');
    expect(tester.takeException(), isNull);
  });

  testWidgets('registration keeps email and creates a named family profile', (
    tester,
  ) async {
    final database = FakeFirebaseFirestore();
    final auth = _TestAuthService(database);
    await _pump(tester, auth);
    await _credentials(tester);
    await _tap(tester, _mode);
    await tester.pumpAndSettle();

    expect(find.text('Begin with the people you love'), findsOneWidget);
    expect(find.text('Forgot password?'), findsNothing);
    expect(
      tester.widget<TextFormField>(_email).controller!.text,
      '  family@example.com  ',
    );
    await tester.ensureVisible(_name);
    await tester.enterText(_name, '  Maya  ');
    await tester.ensureVisible(_password);
    await tester.enterText(_password, 'secret1');
    await _tap(tester, _submit);
    await tester.pumpAndSettle();

    expect(auth.registerCalls, 1);
    expect(auth.signInCalls, 0);
    expect(auth.submittedEmail, 'family@example.com');
    expect(auth.submittedName, 'Maya');
    final user = auth.currentUser!;
    final profile = await database.collection('users').doc(user.uid).get();
    expect(profile.data()!['displayName'], 'Maya');
    expect(profile.data()!['linkedImeis'], isEmpty);
  });

  testWidgets('password reset validates email and clears feedback on mode change', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    await _pump(tester, auth);
    await _tap(tester, find.text('Forgot password?'));
    expect(auth.resetCalls, 0);
    expect(find.textContaining('Enter your email address above'), findsOneWidget);

    await tester.ensureVisible(_email);
    await tester.enterText(_email, '  family@example.com  ');
    await _tap(tester, find.text('Forgot password?'));
    await tester.pumpAndSettle();
    expect(auth.resetCalls, 1);
    expect(auth.submittedEmail, 'family@example.com');
    expect(find.textContaining('you will receive a password reset link'), findsOneWidget);
    expect(find.textContaining('Enter your email address above'), findsNothing);

    await _tap(tester, _mode);
    await tester.pumpAndSettle();
    expect(find.textContaining('you will receive a password reset link'), findsNothing);
  });

  testWidgets('show and hide password keeps the entered value', (tester) async {
    await _pump(tester, _TestAuthService(FakeFirebaseFirestore()));
    await _credentials(tester);
    await _tap(tester, find.byTooltip('Show password'));
    final input = find.descendant(of: _password, matching: find.byType(TextField));
    expect(tester.widget<TextField>(input).obscureText, isFalse);
    expect(tester.widget<TextFormField>(_password).controller!.text, 'secret1');
    await _tap(tester, find.byTooltip('Hide password'));
    expect(tester.widget<TextField>(input).obscureText, isTrue);
  });

  testWidgets('repeated keyboard submission starts only one sign-in request', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    auth.signInGate = Completer<void>();
    await _pump(tester, auth);
    await _credentials(tester);
    final submitFromKeyboard = tester.widget<TextField>(
      find.descendant(of: _password, matching: find.byType(TextField)),
    ).onSubmitted!;
    submitFromKeyboard('secret1');
    submitFromKeyboard('secret1');
    await tester.pump();

    expect(auth.signInCalls, 1);
    expect(tester.widget<FilledButton>(_submit).onPressed, isNull);
    expect(tester.widget<TextButton>(_mode).onPressed, isNull);
    expect(
      tester.widget<TextButton>(find.widgetWithText(TextButton, 'Forgot password?')).onPressed,
      isNull,
    );
    auth.signInGate!.complete();
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(_submit).onPressed, isNotNull);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a reset in progress also blocks a queued keyboard sign in', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    auth.resetGate = Completer<void>();
    await _pump(tester, auth);
    await _credentials(tester);
    final submitFromKeyboard = tester.widget<TextField>(
      find.descendant(of: _password, matching: find.byType(TextField)),
    ).onSubmitted!;
    await _tap(tester, find.text('Forgot password?'));
    submitFromKeyboard('secret1');
    await tester.pump();
    expect(auth.resetCalls, 1);
    expect(auth.signInCalls, 0);
    auth.resetGate!.complete();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('authentication failures never expose service internals', (
    tester,
  ) async {
    final failures = <Object>[
      FirebaseAuthException(
        code: 'operation-not-allowed',
        message: 'Internal project configuration detail',
      ),
      StateError('Internal project configuration detail'),
    ];
    for (final failure in failures) {
      final auth = _TestAuthService(FakeFirebaseFirestore());
      auth.signInError = failure;
      await _pump(tester, auth);
      await _credentials(tester);
      await _tap(tester, _submit);
      await tester.pumpAndSettle();
      expect(
        find.text('We could not complete that request. Please try again shortly.'),
        findsOneWidget,
      );
      expect(find.textContaining('Internal project'), findsNothing);
      expect(find.textContaining('operation-not-allowed'), findsNothing);
      expect(tester.widget<FilledButton>(_submit).onPressed, isNotNull);
    }
  });

  testWidgets('late sign-in failure is safe after the login page is removed', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    auth.signInGate = Completer<void>();
    await _pump(tester, auth);
    await _credentials(tester);
    await _tap(tester, _submit);
    await tester.pumpWidget(const SizedBox());
    auth.signInGate!.completeError(
      FirebaseAuthException(code: 'network-request-failed'),
    );
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('late reset success is safe after the login page is removed', (
    tester,
  ) async {
    final auth = _TestAuthService(FakeFirebaseFirestore());
    auth.resetGate = Completer<void>();
    await _pump(tester, auth);
    await _credentials(tester);
    await _tap(tester, find.text('Forgot password?'));
    await tester.pumpWidget(const SizedBox());
    auth.resetGate!.complete();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  for (final dark in [false, true]) {
    testWidgets('both auth modes fit 320px with 2x text, dark=$dark', (
      tester,
    ) async {
      final auth = _TestAuthService(FakeFirebaseFirestore());
      await _pump(tester, auth, width: 320, textScale: 2, dark: dark);
      expect(tester.takeException(), isNull);
      await _tap(tester, _submit);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await _tap(tester, _mode);
      await tester.pumpAndSettle();
      expect(find.text('Begin with the people you love'), findsOneWidget);
      await _tap(tester, _submit);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(_mode);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
