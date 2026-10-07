import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A wellness action surface that keeps the supplied button's native behaviour.
///
/// Pass [enabled] to match the button's callback state. The button still owns its
/// callback, semantics, focus, keyboard handling and interaction feedback.
class WellnessControl extends StatelessWidget {
  const WellnessControl({
    super.key,
    required this.builder,
    this.emphasized = false,
    this.enabled = true,
  });

  final Widget Function(ButtonStyle style) builder;
  final bool emphasized;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final style = emphasized
        ? GuardianControlStyles.primary(context)
        : GuardianControlStyles.secondary(context);
    return builder(style);
  }
}
