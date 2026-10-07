import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'guardian_pin_logo.dart';

/// One continuous colour reveal while Firebase, sign-in and the profile load.
class GuardianLoadingScreen extends StatefulWidget {
  const GuardianLoadingScreen({super.key, this.onFirstCycleComplete});

  static const revealDuration = Duration(seconds: 14);
  static const minimumDuration = Duration(seconds: 15);
  static const cycleDuration = Duration(seconds: 16);

  final VoidCallback? onFirstCycleComplete;

  @override
  State<GuardianLoadingScreen> createState() => _GuardianLoadingScreenState();
}

class _GuardianLoadingScreenState extends State<GuardianLoadingScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: GuardianLoadingScreen.cycleDuration,
  )..addListener(_onTick);
  bool _reported = false;
  bool? _reduceMotion;

  void _reportFirstCycle() {
    if (_reported) return;
    _reported = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onFirstCycleComplete?.call();
    });
  }

  void _onTick() {
    // Reveal downwards for 14 seconds, then show the complete flag for one.
    // Elapsed time also handles a missed frame spanning the looping boundary.
    final elapsed = _controller.lastElapsedDuration ?? Duration.zero;
    if (elapsed >= GuardianLoadingScreen.minimumDuration) _reportFirstCycle();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (_reduceMotion == reduceMotion) return;
    _reduceMotion = reduceMotion;
    if (reduceMotion) {
      _controller.stop();
      _reportFirstCycle();
    } else {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: Colors.white,
      ),
      child: Scaffold(
        backgroundColor: Colors.white,
        body: Semantics(
          label: 'Guardian is loading',
          liveRegion: true,
          excludeSemantics: true,
          child: Center(
            child: RepaintBoundary(
              child: AnimatedBuilder(
                animation: _controller,
                builder: (context, _) {
                  final elapsedMs =
                      _controller.value *
                      GuardianLoadingScreen.cycleDuration.inMilliseconds;
                  // One constant-speed reveal, without pauses between bands.
                  final fill =
                      (elapsedMs /
                              GuardianLoadingScreen
                                  .revealDuration
                                  .inMilliseconds)
                          .clamp(0.0, 1.0);
                  // Only longer real loads reach the fade and repeat.
                  final fade = ((elapsedMs - 15500) / 500).clamp(0.0, 1.0);
                  return Stack(
                    children: [
                      const GuardianPinMark(size: 192, fillProgress: 0),
                      Opacity(
                        opacity: _reduceMotion! ? 1 : 1 - fade,
                        child: GuardianPinMark(
                          size: 192,
                          fillProgress: _reduceMotion! ? 1 : fill,
                        ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    );
  }
}
