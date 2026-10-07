import 'package:flutter/material.dart';

import 'guardian_loading_screen.dart';
import 'guardian_pin_logo.dart';

/// Starts services once and presents the brand sequence on launch and return
/// from the background. Place above the navigator to cover every current route.
/// [builder] calls its ready callback once auth/profile resolve.
class GuardianStartupGate extends StatefulWidget {
  const GuardianStartupGate({
    super.key,
    required this.initialize,
    required this.builder,
  });

  final Future<void> Function() initialize;
  final Widget Function(BuildContext, VoidCallback onReady) builder;

  /// Lets the initial auth page signal readiness through the navigator.
  /// Call after its ready frame rather than while building that page.
  static void reportReady(BuildContext context) {
    context.findAncestorStateOfType<_GuardianStartupGateState>()?._onReady();
  }

  @override
  State<GuardianStartupGate> createState() => _GuardianStartupGateState();
}

class _GuardianStartupGateState extends State<GuardianStartupGate>
    with WidgetsBindingObserver {
  bool _initialized = false;
  bool _ready = false;
  bool _firstCycleComplete = false;
  bool _failed = false;
  bool _backgrounded = false;
  int _presentation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.hidden ||
        state == AppLifecycleState.paused) {
      _backgrounded = true;
    } else if (state == AppLifecycleState.resumed && _backgrounded) {
      _backgrounded = false;
      setState(() {
        _presentation++;
        _firstCycleComplete = false;
      });
    }
    // Inactive alone includes notification shades and system dialogs. Those
    // focus changes do not represent leaving and reopening Guardian.
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _initialize() async {
    if (!mounted) return;
    setState(() => _failed = false);
    try {
      await widget.initialize();
      if (mounted) setState(() => _initialized = true);
    } catch (error, stack) {
      debugPrint('Guardian startup failed: $error\n$stack');
      if (mounted) setState(() => _failed = true);
    }
  }

  void _onReady() {
    if (mounted && !_ready) setState(() => _ready = true);
  }

  @override
  Widget build(BuildContext context) {
    final showContent = _ready && _firstCycleComplete;
    final presentation = _presentation;
    return Stack(
      fit: StackFit.expand,
      children: [
        if (_initialized)
          Offstage(
            offstage: !showContent,
            child: TickerMode(
              enabled: showContent,
              child: widget.builder(context, _onReady),
            ),
          ),
        if (!showContent)
          if (_failed)
            Scaffold(
              backgroundColor: Colors.white,
              body: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const GuardianPinMark(size: 96),
                      const SizedBox(height: 24),
                      const Text(
                        'Guardian could not start. Please try again.',
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _initialize,
                        child: const Text('Try again'),
                      ),
                    ],
                  ),
                ),
              ),
            )
          else
            GuardianLoadingScreen(
              key: ValueKey(presentation),
              onFirstCycleComplete: () {
                if (mounted &&
                    !_backgrounded &&
                    presentation == _presentation) {
                  setState(() => _firstCycleComplete = true);
                }
              },
            ),
      ],
    );
  }
}
