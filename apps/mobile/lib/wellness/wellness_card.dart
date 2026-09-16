import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../widgets/cards/guardian_surface.dart';
import '../models/activity_day.dart';
import '../models/wear_status.dart';
import '../theme/app_theme.dart';
import 'wellness_sample.dart';
import 'wellness_window.dart';

class WellnessCard extends StatelessWidget {
  const WellnessCard({
    super.key,
    required this.days,
    required this.samples,
    required this.now,
    this.activityAvailable = true,
    this.readingsAvailable = false,
    this.activityError = false,
    this.readingsError = false,
    this.loading = false,
    this.onOpen,
    this.onRoutine,
    this.wearStatus = const WearStatus(),
    this.pilotPreview = false,
  });
  final List<ActivityDay> days;
  final List<WellnessSample> samples;
  final DateTime now;
  final bool activityAvailable,
      readingsAvailable,
      activityError,
      readingsError,
      loading;
  final VoidCallback? onOpen, onRoutine;
  final WearStatus wearStatus;
  final bool pilotPreview;

  @override
  Widget build(BuildContext context) {
    final todayKey = wellnessDateKey(now);
    final today = days
        .where((d) => d.localDate == todayKey && !d.lastObservedAt.isAfter(now))
        .firstOrNull;
    WellnessSample? latest(WellnessMetric metric) {
      final matches =
          samples
              .where(
                (s) =>
                    s.metric == metric &&
                    wellnessDateKey(s.recordedAt) == todayKey &&
                    !s.recordedAt.isAfter(now),
              )
              .toList()
            ..sort((a, b) => b.recordedAt.compareTo(a.recordedAt));
      return matches.firstOrNull;
    }

    final heart = latest(WellnessMetric.heartRate);
    final oxygen = latest(WellnessMetric.bloodOxygen);
    final pressure = latest(WellnessMetric.bloodPressure);
    final temperature = pilotPreview
        ? latest(WellnessMetric.skinTemperature)
        : null;
    String status(bool available, bool error, DateTime? at) => !available
        ? 'Not available yet'
        : error
        ? 'Could not load reading'
        : at == null
        ? 'No reading today'
        : wellnessAge(at, now);
    return WellnessSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const WellnessHeading(
            title: 'Wellness',
            subtitle: 'Today’s watch readings',
          ),
          const SizedBox(height: 8),
          if (pilotPreview) ...[
            const Text(
              'Private preview · watch readings are unverified. Wearing at measurement time is unconfirmed.',
            ),
            const SizedBox(height: 8),
          ],
          Text(
            wearStatus.labelAt(now),
            style: TextStyle(
              fontSize: 12,
              color: context.guardianColors.textSecondary,
            ),
          ),
          if (loading) ...[
            const SizedBox(height: 12),
            const LinearProgressIndicator(minHeight: 2),
          ],
          const SizedBox(height: 16),
          LayoutBuilder(
            builder: (context, size) {
              final single =
                  size.maxWidth < 260 ||
                  MediaQuery.textScalerOf(context).scale(14) > 21;
              final width = single ? size.maxWidth : (size.maxWidth - 12) / 2;
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  SizedBox(
                    width: width,
                    child: WellnessTile(
                      label: pilotPreview
                          ? 'Recorded steps today'
                          : 'Steps today',
                      icon: Icons.directions_walk_rounded,
                      tint: const Color(0xFF15956F),
                      value:
                          activityAvailable && !activityError && today != null
                          ? NumberFormat.decimalPattern().format(today.steps)
                          : '—',
                      status:
                          (today?.partialCoverage == true &&
                                  activityAvailable &&
                                  !activityError
                              ? 'Partial day · '
                              : '') +
                          status(
                            activityAvailable,
                            activityError,
                            today?.lastObservedAt,
                          ),
                    ),
                  ),
                  SizedBox(
                    width: width,
                    child: WellnessTile(
                      label: 'Heart rate',
                      icon: Icons.favorite_border_rounded,
                      tint: const Color(0xFFB85667),
                      value: readingsAvailable && !readingsError
                          ? heart?.value ?? '— bpm'
                          : '— bpm',
                      status: status(
                        readingsAvailable,
                        readingsError,
                        heart?.recordedAt,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: width,
                    child: WellnessTile(
                      label: 'Blood oxygen',
                      icon: Icons.water_drop_outlined,
                      tint: const Color(0xFF2875AD),
                      value: readingsAvailable && !readingsError
                          ? oxygen?.value ?? '— %'
                          : '— %',
                      status: status(
                        readingsAvailable,
                        readingsError,
                        oxygen?.recordedAt,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: width,
                    child: WellnessTile(
                      label: 'Skin temperature',
                      icon: Icons.thermostat_outlined,
                      tint: const Color(0xFF7860AA),
                      value: pilotPreview && readingsAvailable && !readingsError
                          ? temperature?.value ?? '— °C'
                          : '— °C',
                      status:
                          pilotPreview &&
                              readingsAvailable &&
                              !readingsError &&
                              temperature != null
                          ? 'Received ${wellnessAge(temperature.recordedAt, now)}'
                          : status(
                              pilotPreview && readingsAvailable,
                              readingsError,
                              null,
                            ),
                    ),
                  ),
                ],
              );
            },
          ),
          const SizedBox(height: 12),
          _BloodPressureRow(
            value: readingsAvailable && !readingsError
                ? pressure?.value ?? '—/— mmHg'
                : '—/— mmHg',
            status: status(
              readingsAvailable,
              readingsError,
              pressure?.recordedAt,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'Watch estimates · each reading has its own update time.',
            style: TextStyle(
              fontSize: 12,
              color: context.guardianColors.textSecondary,
            ),
          ),
          if (onRoutine != null) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onRoutine,
              icon: const Icon(Icons.schedule),
              label: const Text('Wellness routine'),
            ),
          ],
          if (onOpen != null) ...[
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onOpen,
              icon: const Icon(Icons.arrow_forward_rounded, size: 18),
              label: const Text('View wellness'),
            ),
          ],
        ],
      ),
    );
  }
}

class _BloodPressureRow extends StatelessWidget {
  const _BloodPressureRow({required this.value, required this.status});
  final String value, status;

  @override
  Widget build(BuildContext context) {
    const tint = Color(0xFFAA7845);
    final colors = context.guardianColors;
    return GuardianSurface(
      padding: const EdgeInsets.all(14),
      radius: 16,
      tint: tint,
      tonal: true,
      elevation: 0,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.speed_outlined, color: tint, size: 25),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Blood pressure',
                  style: TextStyle(fontSize: 13, color: colors.textSecondary),
                ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 12,
                  runSpacing: 4,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(
                      value,
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w700,
                        color: colors.textPrimary,
                      ),
                    ),
                    Text(
                      status,
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.textSecondary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'Watch estimate',
                  style: TextStyle(fontSize: 12, color: colors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String wellnessAge(DateTime at, DateTime now) {
  final age = now.difference(at);
  if (age.isNegative) return 'Time unconfirmed';
  if (age.inMinutes < 1) return 'Just now';
  final text = age.inMinutes < 60
      ? '${age.inMinutes}m ago'
      : age.inHours < 24
      ? '${age.inHours}h ago'
      : '${age.inDays}d ago';
  return age > const Duration(minutes: 90) ? '$text · older reading' : text;
}

class WellnessTile extends StatelessWidget {
  const WellnessTile({
    super.key,
    required this.label,
    required this.icon,
    required this.tint,
    required this.value,
    required this.status,
  });
  final String label, value, status;
  final IconData icon;
  final Color tint;
  @override
  Widget build(BuildContext context) => GuardianSurface(
    padding: const EdgeInsets.all(14),
    radius: 16,
    tint: tint,
    tonal: true,
    elevation: 0,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: tint, size: 25),
        const SizedBox(height: 8),
        Text(
          label,
          style: TextStyle(
            fontSize: 13,
            color: context.guardianColors.textSecondary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: TextStyle(
            fontSize: 24,
            fontWeight: FontWeight.w700,
            color: context.guardianColors.textPrimary,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          status,
          style: TextStyle(
            fontSize: 12,
            color: context.guardianColors.textSecondary,
          ),
        ),
      ],
    ),
  );
}

class WellnessHeading extends StatelessWidget {
  const WellnessHeading({
    super.key,
    required this.title,
    required this.subtitle,
  });
  final String title, subtitle;
  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Icon(
        Icons.monitor_heart_outlined,
        color: context.guardianColors.accent,
        size: 27,
      ),
      const SizedBox(width: 12),
      Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w700,
                color: context.guardianColors.textPrimary,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              subtitle,
              style: TextStyle(
                fontSize: 13,
                color: context.guardianColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    ],
  );
}

class WellnessSurface extends StatelessWidget {
  const WellnessSurface({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) =>
      GuardianSurface(padding: const EdgeInsets.all(20), child: child);
}
