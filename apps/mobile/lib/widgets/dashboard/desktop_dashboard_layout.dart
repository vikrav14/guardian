import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

/// Keeps the selected-person card on the left of a desktop map so the
/// Google Maps control rail on the right remains visible and clickable.
class DesktopMapPersonCardPlacement extends StatelessWidget {
  const DesktopMapPersonCardPlacement({super.key, required this.child});

  static const double leftInset = 18;
  static const double bottomInset = 18;
  static const double cardWidth = 286;

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: leftInset,
      bottom: bottomInset,
      width: cardWidth,
      child: child,
    );
  }
}

class DesktopDashboardLayout extends StatelessWidget {
  const DesktopDashboardLayout({
    super.key,
    required this.topBar,
    required this.safetySummary,
    required this.liveStatus,
    required this.map,
    required this.devices,
    required this.aiInsight,
    this.timeline,
    this.quickActions,
    this.bottomStatus,
  });

  final Widget topBar;
  final Widget safetySummary;
  final Widget liveStatus;
  final Widget map;
  final Widget devices;
  final Widget aiInsight;
  final Widget? timeline;
  final Widget? quickActions;
  final Widget? bottomStatus;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.guardianColors.canvas,
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 22),
          child: Column(
            children: [
              topBar,
              const SizedBox(height: 12),
              SizedBox(
                height: 96,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(flex: 7, child: safetySummary),
                    const SizedBox(width: 12),
                    Expanded(flex: 5, child: liveStatus),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(height: 360, width: double.infinity, child: map),
              const SizedBox(height: 12),
              SizedBox(
                height: 216,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Expanded(child: devices),
                    const SizedBox(width: 12),
                    Expanded(child: aiInsight),
                    if (timeline != null) ...[
                      const SizedBox(width: 12),
                      Expanded(child: timeline!),
                    ],
                  ],
                ),
              ),
              if (quickActions != null) ...[
                const SizedBox(height: 12),
                quickActions!,
              ],
              if (bottomStatus != null) ...[
                const SizedBox(height: 12),
                SizedBox(height: 112, child: bottomStatus!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
