import 'package:flutter/material.dart';

import '../../models/activity_day.dart';
import '../../models/device.dart';
import '../../services/guardian_services.dart';
import '../../theme/app_theme.dart';

class ActivityStepsPanel extends StatelessWidget {
  const ActivityStepsPanel({
    required this.device,
    required this.decision,
    required this.subscription,
    this.days,
    super.key,
  });

  final Device? device;
  final GuardianEntitlementDecision decision;
  final GuardianSubscription? subscription;

  /// Test/demo injection. Production reads only backend-accepted Firestore
  /// activityDays records through [ActivityService].
  final Stream<List<ActivityDay>>? days;

  @override
  Widget build(BuildContext context) {
    final selected = device;
    if (selected == null) return const SizedBox.shrink();
    if (!decision.allowed) {
      return ActivityStepsCard.locked(message: decision.message);
    }
    final verifiedSubscription = subscription;
    if (verifiedSubscription == null) {
      return const ActivityStepsCard.unavailable(
        message: 'Guardian is checking this family’s activity access.',
      );
    }

    final stream = days ??
        ActivityService().watchRecentDays(
          imei: selected.imei,
          subscription: verifiedSubscription,
        );
    return StreamBuilder<List<ActivityDay>>(
      stream: stream,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const ActivityStepsCard.unavailable(
            message: 'Activity data could not be verified right now.',
          );
        }
        if (!snapshot.hasData) {
          return const ActivityStepsCard.loading();
        }
        return ActivityStepsCard(days: snapshot.data!);
      },
    );
  }
}

class ActivityStepsCard extends StatelessWidget {
  const ActivityStepsCard({required this.days, super.key})
    : _mode = _ActivityCardMode.data,
      message = null;

  const ActivityStepsCard.locked({required this.message, super.key})
    : _mode = _ActivityCardMode.locked,
      days = const <ActivityDay>[];

  const ActivityStepsCard.unavailable({required this.message, super.key})
    : _mode = _ActivityCardMode.unavailable,
      days = const <ActivityDay>[];

  const ActivityStepsCard.loading({super.key})
    : _mode = _ActivityCardMode.loading,
      days = const <ActivityDay>[],
      message = null;

  final List<ActivityDay> days;
  final _ActivityCardMode _mode;
  final String? message;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final ordered = [...days]
      ..sort((a, b) => b.localDate.compareTo(a.localDate));
    final today = ordered.firstOrNull;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: colors.border.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.directions_walk_rounded,
                color: GuardianColors.safe,
                size: 20,
              ),
              const SizedBox(width: 8),
              Text(
                'DAILY ACTIVITY',
                style: textTheme.labelSmall?.copyWith(
                  color: colors.textSecondary,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.7,
                ),
              ),
              const Spacer(),
              if (_mode == _ActivityCardMode.locked)
                const Icon(Icons.lock_outline_rounded, size: 18),
            ],
          ),
          const SizedBox(height: 16),
          if (_mode == _ActivityCardMode.loading)
            const LinearProgressIndicator(minHeight: 3)
          else if (_mode != _ActivityCardMode.data)
            Text(
              message ?? 'Activity is unavailable.',
              style: textTheme.bodyMedium?.copyWith(
                color: colors.textSecondary,
                height: 1.4,
              ),
            )
          else if (today == null)
            Text(
              'Waiting for accepted step data from the watch.',
              style: textTheme.bodyMedium?.copyWith(
                color: colors.textSecondary,
              ),
            )
          else ...[
            Text(
              _formatInteger(today.steps),
              key: const Key('activity-today-steps'),
              style: textTheme.headlineMedium?.copyWith(
                color: colors.textPrimary,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              'steps · ${_freshness(today.lastObservedAt)}',
              style: textTheme.bodySmall?.copyWith(
                color: colors.textSecondary,
              ),
            ),
            const SizedBox(height: 16),
            _WeekBars(days: ordered.take(7).toList(growable: false)),
            const SizedBox(height: 12),
            Text(
              'Activity estimates are for everyday wellbeing, not medical assessment.',
              style: textTheme.bodySmall?.copyWith(
                color: colors.textSecondary,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _WeekBars extends StatelessWidget {
  const _WeekBars({required this.days});

  final List<ActivityDay> days;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final maximum = days.fold<int>(1, (value, day) => day.steps > value ? day.steps : value);
    return Column(
      children: [
        for (final day in days.reversed) ...[
          Row(
            children: [
              SizedBox(
                width: 46,
                child: Text(
                  day.localDate.substring(5),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.textSecondary,
                  ),
                ),
              ),
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    minHeight: 8,
                    value: day.steps / maximum,
                    backgroundColor: colors.surfaceMuted,
                    color: GuardianColors.safe,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                width: 56,
                child: Text(
                  _formatInteger(day.steps),
                  textAlign: TextAlign.right,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
        ],
      ],
    );
  }
}

enum _ActivityCardMode { data, locked, unavailable, loading }

String _formatInteger(int value) {
  final digits = value.toString();
  return digits.replaceAllMapped(
    RegExp(r'\B(?=(\d{3})+(?!\d))'),
    (_) => ',',
  );
}

String _freshness(DateTime observedAt, {DateTime? now}) {
  final age = (now ?? DateTime.now()).difference(observedAt);
  if (age.isNegative || age.inMinutes < 1) return 'updated just now';
  if (age.inMinutes < 60) return 'updated ${age.inMinutes} min ago';
  if (age.inHours < 24) return 'updated ${age.inHours} h ago';
  return 'last updated ${observedAt.toLocal().toIso8601String().substring(0, 10)}';
}
