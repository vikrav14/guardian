import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';

enum ReadingTone { neutral, received, attention }

/// Describes a reading attempt, never whether the watch is currently worn.
class ReadingPresentation {
  const ReadingPresentation(this.title, this.detail, this.tone);

  final String title;
  final String detail;
  final ReadingTone tone;

  factory ReadingPresentation.at({
    required DateTime now,
    Map<String, dynamic> status = const {},
  }) {
    final attempt = status['lastAttempt'];
    final updated = _readingDate(status['updatedAt']);
    final gatewayFresh =
        updated != null &&
        !updated.isAfter(now) &&
        now.difference(updated) < const Duration(minutes: 2);
    if (attempt is! Map) {
      final next = _readingDate(status['nextCheckAt']);
      return ReadingPresentation(
        'Awaiting first check',
        gatewayFresh &&
                status['phase'] == 'scheduled' &&
                next != null &&
                next.isAfter(now)
            ? 'Next check · ${_readingMoment(next, now)}'
            : 'Readings will appear after a completed check',
        ReadingTone.neutral,
      );
    }

    final activeUntil = _readingDate(attempt['activeUntil']);
    final started =
        _readingDate(attempt['startedAt']) ??
        _readingDate(attempt['scheduledAt']);
    if (gatewayFresh &&
        status['phase'] == 'running' &&
        status['inFlight'] == true &&
        attempt['terminal'] == false &&
        started != null &&
        !started.isAfter(now) &&
        activeUntil != null &&
        activeUntil.isAfter(now)) {
      return const ReadingPresentation(
        'Checking readings',
        'Waiting for the watch to send results',
        ReadingTone.neutral,
      );
    }

    final at =
        _readingDate(attempt['finishedAt']) ??
        _readingDate(attempt['completedAt']) ??
        started;
    if (at == null || at.isAfter(now)) {
      return const ReadingPresentation(
        'Check status unavailable',
        'Waiting for an update',
        ReadingTone.neutral,
      );
    }
    final when = 'Scheduled check · ${_readingMoment(at, now)}';
    if (attempt['terminal'] != true) {
      return ReadingPresentation(
        'Check result unavailable',
        when,
        ReadingTone.neutral,
      );
    }
    final recent = now.difference(at) <= const Duration(minutes: 5);
    final outcome = attempt['outcome'];
    final reason = attempt['reason'];
    if (reason == 'unusable_heart_bp' || reason == 'unusable_oxygen') {
      return ReadingPresentation(
        recent ? 'Check watch fit' : 'Last check incomplete',
        '$when · No usable readings',
        recent ? ReadingTone.attention : ReadingTone.neutral,
      );
    }
    if (outcome == 'temperature_upload_observed') {
      return ReadingPresentation(
        'Readings received',
        when,
        recent ? ReadingTone.received : ReadingTone.neutral,
      );
    }
    final skippedReason = switch (reason) {
      'watch_offline' => 'Watch was offline',
      'slot_missed' || 'missed' => 'Scheduled time passed',
      'removal_reported' => 'Removal reported during check',
      'access_or_consent_unavailable' => 'Access unavailable',
      'daily_limit_reached' || 'daily_attempt_limit' => 'Daily checks complete',
      'attempt_in_progress' ||
      'measurement_busy' => 'Another check was in progress',
      'previous_attempt_reserved' => 'Check was not repeated',
      _ => outcome == 'watch_offline' ? 'Watch was offline' : null,
    };
    if (outcome == 'skipped' || skippedReason != null) {
      return ReadingPresentation(
        'Check skipped',
        skippedReason == null ? when : '$when · $skippedReason',
        ReadingTone.neutral,
      );
    }
    final detail = switch ((outcome, reason)) {
      (_, 'optical_timeout') => 'Results were incomplete',
      ('temperature_capture_ended', _) => 'Temperature result unavailable',
      ('temperature_skipped', _) => 'Temperature skipped',
      ('interrupted', _) ||
      ('interrupted_unknown', _) => 'Check was interrupted',
      _ => 'A complete result was not received',
    };
    return ReadingPresentation(
      'Readings incomplete',
      '$when · $detail',
      ReadingTone.neutral,
    );
  }
}

DateTime? _readingDate(dynamic value) => switch (value) {
  Timestamp timestamp => timestamp.toDate(),
  DateTime date => date,
  String text => DateTime.tryParse(text),
  _ => null,
};

String _readingMoment(DateTime value, DateTime now) {
  final local = value.toUtc().add(const Duration(hours: 4));
  final today = now.toUtc().add(const Duration(hours: 4));
  final sameDay =
      local.year == today.year &&
      local.month == today.month &&
      local.day == today.day;
  final day = sameDay ? 'today' : '${local.day}/${local.month}/${local.year}';
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  return '$day, $hour:$minute';
}

class DashboardReadingStatus extends StatefulWidget {
  const DashboardReadingStatus({
    super.key,
    required this.imei,
    required this.watchStatus,
    this.onTap,
    this.clock,
  });

  final String imei;
  final Stream<Map<String, dynamic>> Function(String imei) watchStatus;
  final VoidCallback? onTap;
  final DateTime Function()? clock;

  @override
  State<DashboardReadingStatus> createState() => _DashboardReadingStatusState();
}

class _DashboardReadingStatusState extends State<DashboardReadingStatus>
    with WidgetsBindingObserver {
  late Stream<Map<String, dynamic>> _status;
  Timer? _timer;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _subscribe();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted) setState(() {});
    });
  }

  void _subscribe() {
    _generation++;
    _status = widget.watchStatus(widget.imei);
  }

  @override
  void didUpdateWidget(DashboardReadingStatus oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imei != widget.imei ||
        oldWidget.watchStatus != widget.watchStatus) {
      _subscribe();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) setState(() {});
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<Map<String, dynamic>>(
    // Replacing the builder clears its previous snapshot before a watch switch.
    key: ValueKey(_generation),
    stream: _status,
    builder: (context, snapshot) {
      final presentation = snapshot.hasError
          ? const ReadingPresentation(
              'Check status unavailable',
              'Open Wellness routine for details',
              ReadingTone.neutral,
            )
          : snapshot.connectionState == ConnectionState.waiting
          ? const ReadingPresentation(
              'Loading check status',
              'Waiting for an update',
              ReadingTone.neutral,
            )
          : ReadingPresentation.at(
              now: widget.clock?.call() ?? DateTime.now(),
              status: snapshot.data ?? const {},
            );
      return ReadingStatusTile(presentation: presentation, onTap: widget.onTap);
    },
  );
}

/// Pure presentation, shared by the live dashboard and visual previews.
class ReadingStatusTile extends StatelessWidget {
  const ReadingStatusTile({super.key, required this.presentation, this.onTap});

  final ReadingPresentation presentation;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = switch (presentation.tone) {
      ReadingTone.received => dark ? colors.accent : GuardianColors.safeText,
      ReadingTone.attention =>
        dark ? GuardianColors.warning : GuardianColors.warningText,
      ReadingTone.neutral => colors.textSecondary,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Divider(height: 20, color: colors.border),
        InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Icon(Icons.watch_outlined, size: 18, color: color),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        presentation.title,
                        style: TextStyle(
                          color: color,
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        presentation.detail,
                        style: TextStyle(
                          color: colors.textSecondary,
                          fontSize: 13,
                          height: 1.4,
                        ),
                      ),
                    ],
                  ),
                ),
                if (onTap != null) ...[
                  const SizedBox(width: 8),
                  Icon(
                    Icons.chevron_right,
                    color: colors.textSecondary,
                    size: 20,
                  ),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}
