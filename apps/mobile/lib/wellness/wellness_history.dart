import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/activity_day.dart';
import '../theme/app_theme.dart';
import 'wellness_card.dart';
import 'wellness_sample.dart';
import 'wellness_window.dart';

class WellnessHistory extends StatelessWidget {
  const WellnessHistory({
    super.key,
    required this.window,
    required this.days,
    required this.samples,
    required this.now,
    required this.readingsAvailable,
    this.activityAvailable = true,
    this.onPrevious,
    this.onNext,
    this.onChooseDate,
    this.onAsk,
    this.onRoutine,
    this.planDescription,
    this.readingError = false,
    this.activityError = false,
    this.pilotPreview = false,
  });
  final WellnessWindow window;
  final List<ActivityDay> days;
  final List<WellnessSample> samples;
  final DateTime now;
  final bool activityAvailable, readingsAvailable, readingError, activityError;
  final VoidCallback? onPrevious, onNext, onChooseDate, onAsk, onRoutine;
  final String? planDescription;
  final bool pilotPreview;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final accepted = days
        .where(
          (d) =>
              window.includesDate(d.localDate) &&
              window.contains(d.lastObservedAt, now: now),
        )
        .toList();
    final maximum = accepted.fold<int>(1, (a, d) => d.steps > a ? d.steps : a);
    final ordered =
        samples
            .where(
              (s) =>
                  window.contains(s.recordedAt, now: now) &&
                  (pilotPreview || s.metric != WellnessMetric.skinTemperature),
            )
            .toList()
          ..sort((a, b) => b.recordedAt.compareTo(a.recordedAt));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (planDescription != null || onRoutine != null) ...[
          WellnessSurface(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (planDescription != null) Text(planDescription!),
                if (onRoutine != null) ...[
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: onRoutine,
                    icon: const Icon(Icons.schedule),
                    label: const Text('Wellness routine'),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
        ],
        if (pilotPreview) ...[
          const WellnessSurface(
            child: Text(
              'Private preview · unverified watch readings. Wearing at measurement time is unconfirmed. These values are excluded from customer reports and alerts.',
            ),
          ),
          const SizedBox(height: 12),
        ],
        WellnessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              WellnessHeading(
                title: 'Activity history',
                subtitle:
                    '${wellnessDateKey(window.start)} – ${wellnessDateKey(window.end.subtract(const Duration(days: 1)))}',
              ),
              if (onPrevious != null ||
                  onNext != null ||
                  onChooseDate != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    OutlinedButton(
                      onPressed: onPrevious,
                      child: const Text('Earlier week'),
                    ),
                    OutlinedButton(
                      onPressed: onNext,
                      child: const Text('Later week'),
                    ),
                    TextButton.icon(
                      onPressed: onChooseDate,
                      icon: const Icon(Icons.calendar_month_outlined),
                      label: const Text('Choose date'),
                    ),
                  ],
                ),
              ],
              const SizedBox(height: 18),
              if (!activityAvailable)
                const Text('Activity is not available yet.')
              else if (activityError)
                const Text('Activity history could not be loaded.')
              else ...[
                Text(
                  '${accepted.length} days with readings · missing days are shown as gaps.',
                  style: TextStyle(color: colors.textSecondary),
                ),
                const SizedBox(height: 16),
                for (
                  var date = window.start;
                  date.isBefore(window.end);
                  date = date.add(const Duration(days: 1))
                )
                  _DayRow(
                    date: date,
                    day: accepted
                        .where((d) => d.localDate == wellnessDateKey(date))
                        .firstOrNull,
                    maximum: maximum,
                    today: wellnessDateKey(date) == wellnessDateKey(now),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 18),
        WellnessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              WellnessHeading(
                title: 'Watch readings',
                subtitle: pilotPreview
                    ? 'Heart rate, blood oxygen, blood-pressure and skin-temperature estimates'
                    : 'Heart rate, blood oxygen and blood-pressure estimates',
              ),
              const SizedBox(height: 16),
              if (!readingsAvailable)
                const Text('Wellbeing readings are not available yet.')
              else if (readingError)
                const Text(
                  'Readings could not be verified. Check your connection and reading access.',
                )
              else if (ordered.isEmpty)
                const Text('No readings in this period.')
              else
                _ReadingHistoryList(
                  key: ValueKey(window.start),
                  samples: ordered,
                  now: now,
                ),
              const SizedBox(height: 12),
              if (!pilotPreview)
                Text(
                  'Skin temperature · Not available yet',
                  style: TextStyle(color: colors.textSecondary),
                ),
              const SizedBox(height: 8),
              Text(
                'These are watch estimates, not medical measurements.',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            ],
          ),
        ),
        if (onAsk != null) ...[
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: onAsk,
            icon: const Icon(Icons.chat_bubble_outline),
            label: const Text('Ask on WhatsApp'),
          ),
        ],
      ],
    );
  }
}

class _DayRow extends StatelessWidget {
  const _DayRow({
    required this.date,
    required this.day,
    required this.maximum,
    required this.today,
  });
  final DateTime date;
  final ActivityDay? day;
  final int maximum;
  final bool today;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 15),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          spacing: 12,
          children: [
            Text(
              today
                  ? 'Today · still updating'
                  : DateFormat(
                      'EEE d MMM',
                    ).format(date.toUtc().add(const Duration(hours: 4))),
            ),
            Text(
              day == null
                  ? 'No reading'
                  : '${NumberFormat.decimalPattern().format(day!.steps)} steps${day!.partialCoverage ? ' · Partial day' : ''}',
            ),
          ],
        ),
        const SizedBox(height: 6),
        if (day != null)
          LinearProgressIndicator(
            value: day!.steps / maximum,
            minHeight: 6,
            borderRadius: BorderRadius.circular(8),
            color: context.guardianColors.accent,
            backgroundColor: context.guardianColors.surfaceMuted,
          )
        else
          Divider(color: context.guardianColors.border),
      ],
    ),
  );
}

String _metricName(WellnessMetric metric) => switch (metric) {
  WellnessMetric.heartRate => 'Heart rate',
  WellnessMetric.bloodOxygen => 'Blood oxygen',
  WellnessMetric.bloodPressure => 'Blood-pressure estimate',
  WellnessMetric.skinTemperature => 'Skin temperature · received',
};

class _ReadingHistoryList extends StatefulWidget {
  const _ReadingHistoryList({
    super.key,
    required this.samples,
    required this.now,
  });
  final List<WellnessSample> samples;
  final DateTime now;
  @override
  State<_ReadingHistoryList> createState() => _ReadingHistoryListState();
}

class _ReadingHistoryListState extends State<_ReadingHistoryList> {
  int _visible = 20;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final sample in widget.samples.take(_visible))
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_metricName(sample.metric)} · ${sample.value}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 3),
              Text(
                '${DateFormat('d MMM, HH:mm').format(sample.recordedAt.toUtc().add(const Duration(hours: 4)))} MUT · ${wellnessAge(sample.recordedAt, widget.now)}',
                style: TextStyle(
                  color: context.guardianColors.textSecondary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      if (widget.samples.length > _visible)
        TextButton(
          onPressed: () => setState(() => _visible += 20),
          child: Text(
            'Show more readings (${widget.samples.length - _visible} remaining)',
          ),
        ),
    ],
  );
}
