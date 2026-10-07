import 'dart:async';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/widgets/brand/guardian_loading_screen.dart';
import 'package:guardian/widgets/brand/guardian_pin_logo.dart';
import 'package:guardian/widgets/brand/guardian_startup_gate.dart';

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized()
        .handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  });

  testWidgets(
    'first frame loads before services and reveals all four bands in order',
    (tester) async {
      final init = Completer<void>();
      var started = false;
      VoidCallback? ready;
      await tester.pumpWidget(
        MaterialApp(
          home: GuardianStartupGate(
            initialize: () {
              started = true;
              return init.future;
            },
            builder: (context, onReady) {
              ready = onReady;
              return const Text('App ready');
            },
          ),
        ),
      );
      expect(started, isTrue);
      expect(find.byType(GuardianLoadingScreen), findsOneWidget);
      expect(ready, isNull);
      double fill() => tester
          .widgetList<GuardianPinMark>(find.byType(GuardianPinMark))
          .last
          .fillProgress;
      expect(fill(), 0);
      for (final expected in [0.25, 0.5, 0.75, 1.0]) {
        await tester.pump(const Duration(milliseconds: 3500));
        expect(fill(), closeTo(expected, 0.001));
      }
      // Finishing the animation must never imply that the app has finished loading.
      await tester.pump(const Duration(seconds: 1));
      expect(find.byType(GuardianLoadingScreen), findsOneWidget);
      init.complete();
      await tester.pump();
      expect(ready, isNotNull);
      expect(find.text('App ready'), findsNothing);
      ready!();
      await tester.pump();
      expect(find.text('App ready'), findsOneWidget);
      expect(find.byType(GuardianLoadingScreen), findsNothing);
      expect(tester.hasRunningAnimations, isFalse);
    },
  );

  testWidgets(
    'fast startup waits exactly 15 seconds including full-colour hold',
    (tester) async {
      VoidCallback? ready;
      await tester.pumpWidget(
        MaterialApp(
          home: GuardianStartupGate(
            initialize: () async {},
            builder: (context, onReady) {
              ready = onReady;
              return const Text('Ready');
            },
          ),
        ),
      );
      await tester.pump();
      ready!();
      await tester.pump(const Duration(milliseconds: 2000));
      expect(find.text('Ready'), findsNothing);
      await tester.pump(const Duration(seconds: 12));
      expect(
        tester
            .widgetList<GuardianPinMark>(find.byType(GuardianPinMark))
            .last
            .fillProgress,
        1,
      );
      // Keep the complete Mauritius flag visible for another second.
      await tester.pump(const Duration(milliseconds: 999));
      expect(find.text('Ready'), findsNothing);
      await tester.pump(const Duration(milliseconds: 1));
      await tester.pump();
      expect(find.text('Ready'), findsOneWidget);
    },
  );

  testWidgets(
    'failed initialization offers a working retry without opening content',
    (tester) async {
      var attempts = 0;
      VoidCallback? ready;
      await tester.pumpWidget(
        MaterialApp(
          home: GuardianStartupGate(
            initialize: () async {
              attempts++;
              if (attempts == 1) throw StateError('Service unavailable');
            },
            builder: (context, onReady) {
              ready = onReady;
              return const Text('Ready');
            },
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Try again'), findsOneWidget);
      expect(ready, isNull);
      await tester.tap(find.text('Try again'));
      await tester.pump();
      expect(attempts, 2);
      ready!();
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      expect(find.text('Ready'), findsOneWidget);
    },
  );

  testWidgets(
    'reduced motion shows the coloured mark and does not delay readiness',
    (tester) async {
      VoidCallback? ready;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, child) => MediaQuery(
            data: const MediaQueryData(disableAnimations: true),
            child: child!,
          ),
          home: GuardianStartupGate(
            initialize: () async {},
            builder: (context, onReady) {
              ready = onReady;
              return const Text('Ready');
            },
          ),
        ),
      );
      await tester.pump();
      final marks = tester.widgetList<GuardianPinMark>(
        find.byType(GuardianPinMark),
      );
      expect(marks.last.fillProgress, 1);
      expect(tester.hasRunningAnimations, isFalse);
      ready!();
      await tester.pump();
      expect(find.text('Ready'), findsOneWidget);
      _background(tester);
      _resume(tester);
      await tester.pump();
      await tester.pump();
      expect(find.text('Ready'), findsOneWidget);
      expect(tester.hasRunningAnimations, isFalse);
    },
  );

  testWidgets(
    'returning replays above pushed routes and preserves their state and services',
    (tester) async {
      var initializations = 0;
      await tester.pumpWidget(
        MaterialApp(
          builder: (context, navigator) => GuardianStartupGate(
            initialize: () async {
              initializations++;
            },
            builder: (context, onReady) => navigator!,
          ),
          home: const _ReadyHome(),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(seconds: 15));
      await tester.pump();
      await tester.tap(find.text('Open details'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Count 0'));
      await tester.pump();
      expect(find.text('Count 1'), findsOneWidget);

      for (var reopen = 0; reopen < 2; reopen++) {
        _background(tester);
        await tester.pump(const Duration(seconds: 8));
        _resume(tester);
        await tester.pump();
        expect(find.byType(GuardianLoadingScreen), findsOneWidget);
        expect(find.text('Count 1'), findsNothing);
        expect(initializations, 1);

        await tester.pump(const Duration(milliseconds: 2000));
        expect(find.byType(GuardianLoadingScreen), findsOneWidget);
        // A duplicate focus event must not restart an in-progress reveal.
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        await tester.pump(const Duration(milliseconds: 12999));
        expect(find.byType(GuardianLoadingScreen), findsOneWidget);
        await tester.pump(const Duration(milliseconds: 1));
        await tester.pump();
        expect(find.byType(GuardianLoadingScreen), findsNothing);
        expect(find.text('Count 1'), findsOneWidget);
      }
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Open details'), findsOneWidget);
      expect(initializations, 1);
    },
  );

  testWidgets('temporary focus loss does not replay the loading screen', (
    tester,
  ) async {
    VoidCallback? ready;
    await tester.pumpWidget(
      MaterialApp(
        home: GuardianStartupGate(
          initialize: () async {},
          builder: (context, onReady) {
            ready = onReady;
            return const Text('Ready');
          },
        ),
      ),
    );
    await tester.pump();
    ready!();
    await tester.pump(const Duration(seconds: 15));
    await tester.pump();
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(find.byType(GuardianLoadingScreen), findsNothing);
    expect(find.text('Ready'), findsOneWidget);
  });

  testWidgets('leaving mid-reveal starts a complete fresh sequence on return', (
    tester,
  ) async {
    VoidCallback? ready;
    await tester.pumpWidget(
      MaterialApp(
        home: GuardianStartupGate(
          initialize: () async {},
          builder: (context, onReady) {
            ready = onReady;
            return const Text('Ready');
          },
        ),
      ),
    );
    await tester.pump();
    ready!();
    await tester.pump(const Duration(milliseconds: 2000));
    _background(tester);
    await tester.pump(const Duration(seconds: 10));
    _resume(tester);
    await tester.pump();
    expect(
      tester
          .widgetList<GuardianPinMark>(find.byType(GuardianPinMark))
          .last
          .fillProgress,
      0,
    );
    await tester.pump(const Duration(milliseconds: 2000));
    expect(find.text('Ready'), findsNothing);
    await tester.pump(const Duration(seconds: 13));
    await tester.pump();
    expect(find.text('Ready'), findsOneWidget);
  });

  testWidgets(
    'a delayed frame past a whole cycle still finishes the minimum wait',
    (tester) async {
      var completed = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: GuardianLoadingScreen(onFirstCycleComplete: () => completed++),
        ),
      );
      await tester.pump(const Duration(seconds: 17));
      expect(completed, 1);
      await tester.pump(const Duration(seconds: 16));
      expect(completed, 1);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'colour reaches both ring sides together and stays grey below the front',
    (tester) async {
      final key = GlobalKey();
      await tester.pumpWidget(
        Directionality(
          textDirection: TextDirection.ltr,
          child: Center(
            child: RepaintBoundary(
              key: key,
              child: const GuardianPinMark(size: 200, fillProgress: 0.375),
            ),
          ),
        ),
      );
      final boundary =
          key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
      await tester.runAsync(() async {
        final image = await boundary.toImage();
        final pixels = await image.toByteData(
          format: ui.ImageByteFormat.rawRgba,
        );
        List<int> pixel(int x, int y) {
          final offset = (y * image.width + x) * 4;
          return List.generate(
            4,
            (channel) => pixels!.getUint8(offset + channel),
          );
        }

        // At 37.5%, the front is at y=75 on both sides, even though the
        // reference's sloping colour joins put different bands above it.
        expect(pixel(100, 10), [0xF5, 0x13, 0x20, 0xFF]);
        expect(pixel(10, 70), [0x00, 0x30, 0x80, 0xFF]);
        expect(pixel(190, 70), [0xFF, 0xE0, 0x00, 0xFF]);
        for (final x in [10, 190]) {
          expect(pixel(x, 85), [0xE5, 0xE9, 0xE7, 0xFF]);
        }
        expect(pixel(100, 51), [0x8D, 0xD5, 0xB5, 0xFF]);
        // The heart below the front stays grey; the family stays dark.
        expect(pixel(100, 190), [0xE5, 0xE9, 0xE7, 0xFF]);
        expect(pixel(55, 100), [0x14, 0x26, 0x2D, 0xFF]);
        image.dispose();
      });
    },
  );

  testWidgets(
    'late initialization after disposal does not update a dead widget',
    (tester) async {
      final init = Completer<void>();
      await tester.pumpWidget(
        MaterialApp(
          home: GuardianStartupGate(
            initialize: () => init.future,
            builder: (_, _) => const SizedBox(),
          ),
        ),
      );
      await tester.pumpWidget(const SizedBox());
      init.complete();
      await tester.pump();
      expect(tester.takeException(), isNull);
      expect(tester.hasRunningAnimations, isFalse);
    },
  );
}

void _background(WidgetTester tester) {
  for (final state in [
    AppLifecycleState.inactive,
    AppLifecycleState.hidden,
    AppLifecycleState.paused,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
}

void _resume(WidgetTester tester) {
  for (final state in [
    AppLifecycleState.hidden,
    AppLifecycleState.inactive,
    AppLifecycleState.resumed,
  ]) {
    tester.binding.handleAppLifecycleStateChanged(state);
  }
}

class _ReadyHome extends StatefulWidget {
  const _ReadyHome();

  @override
  State<_ReadyHome> createState() => _ReadyHomeState();
}

class _ReadyHomeState extends State<_ReadyHome> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) GuardianStartupGate.reportReady(context);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: TextButton(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const _RetainedDetails()),
        ),
        child: const Text('Open details'),
      ),
    ),
  );
}

class _RetainedDetails extends StatefulWidget {
  const _RetainedDetails();

  @override
  State<_RetainedDetails> createState() => _RetainedDetailsState();
}

class _RetainedDetailsState extends State<_RetainedDetails> {
  int count = 0;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Details')),
    body: Center(
      child: TextButton(
        onPressed: () => setState(() => count++),
        child: Text('Count $count'),
      ),
    ),
  );
}
