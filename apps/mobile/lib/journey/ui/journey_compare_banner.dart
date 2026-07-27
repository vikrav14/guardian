import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../models/location_history_point.dart';
import '../../widgets/brand/dodo_ai_icon.dart';
import '../journey_models.dart';
import '../journey_utils.dart';
import 'journey_screen_theme.dart';

/// Subtle banner shown when compare mode is active.
class JourneyCompareBanner extends StatelessWidget {
  const JourneyCompareBanner({
    super.key,
    required this.compareDay,
    required this.similarityPercent,
    required this.loading,
    required this.primaryStats,
    required this.comparePoints,
    required this.onDismiss,
  });

  final DateTime? compareDay;
  final int? similarityPercent;
  final bool loading;
  final JourneyStats primaryStats;
  final List<LocationHistoryPoint>? comparePoints;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return _BannerShell(
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2, color: JourneyScreenTheme.accent),
            ),
            const SizedBox(width: 10),
            Text(
              'Loading comparison…',
              style: JourneyScreenTheme.textStyle(fontSize: 12, color: JourneyScreenTheme.textSecondary),
            ),
          ],
        ),
      );
    }

    if (compareDay == null || similarityPercent == null) {
      return const SizedBox.shrink();
    }

    final points = comparePoints;
    final compareStats = points != null && points.isNotEmpty
        ? buildJourneyStats(points)
        : null;
    final narration = compareSimilarityNarration(similarityPercent!, compareDay!);

    return _BannerShell(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const GuardianAiIcon(size: 24),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  narration,
                  style: JourneyScreenTheme.textStyle(
                    fontSize: 11,
                    height: 1.3,
                    color: JourneyScreenTheme.textSecondary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton(
                tooltip: 'Exit compare',
                visualDensity: VisualDensity.compact,
                onPressed: onDismiss,
                icon: const Icon(Icons.close_rounded, size: 18, color: JourneyScreenTheme.textMuted),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: _CompareStat(
                  label: 'Selected',
                  distance: primaryStats.distanceKm,
                  duration: primaryStats.duration,
                  color: JourneyScreenTheme.accent,
                ),
              ),
              Container(
                width: 1,
                height: 28,
                color: JourneyScreenTheme.textMuted.withValues(alpha: 0.35),
              ),
              Expanded(
                child: _CompareStat(
                  label: DateFormat.MMMd().format(compareDay!),
                  distance: compareStats?.distanceKm ?? 0,
                  duration: compareStats?.duration ?? Duration.zero,
                  color: JourneyScreenTheme.danger,
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: JourneyScreenTheme.accent.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  '$similarityPercent%',
                  style: JourneyScreenTheme.textStyle(
                    fontWeight: FontWeight.w800,
                    color: JourneyScreenTheme.accent,
                    fontSize: 12,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _BannerShell extends StatelessWidget {
  const _BannerShell({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: JourneyScreenTheme.spacing2),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: JourneyScreenTheme.glassOverlay(),
      child: child,
    );
  }
}

class _CompareStat extends StatelessWidget {
  const _CompareStat({
    required this.label,
    required this.distance,
    required this.duration,
    required this.color,
  });

  final String label;
  final double distance;
  final Duration duration;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: JourneyScreenTheme.textStyle(fontSize: 9, color: JourneyScreenTheme.textMuted),
          ),
          Text(
            '${distance.toStringAsFixed(1)} km',
            style: JourneyScreenTheme.textStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
