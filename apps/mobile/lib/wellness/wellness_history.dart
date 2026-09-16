import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/activity_day.dart';
import '../theme/app_theme.dart';
import 'wellness_card.dart';
import 'wellness_chart.dart';
import 'wellness_sample.dart';
import 'wellness_trends.dart';
import 'wellness_window.dart';

class WellnessHistory extends StatefulWidget {
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
    this.onToday,
    this.onWeek,
    this.onAsk,
    this.onRoutine,
    this.planDescription,
    this.readingError = false,
    this.activityError = false,
    this.loading = false,
    this.pilotPreview = false,
    this.initialActivity,
    this.initialMetric = WellnessMetric.heartRate,
    this.onActivityChanged,
    this.onMetricChanged,
  });
  final WellnessWindow window;
  final List<ActivityDay> days;
  final List<WellnessSample> samples;
  final DateTime now;
  final bool activityAvailable, readingsAvailable, readingError, activityError;
  final bool loading, pilotPreview;
  final VoidCallback? onPrevious, onNext, onChooseDate, onToday, onWeek;
  final VoidCallback? onAsk, onRoutine;
  final String? planDescription;
  final bool? initialActivity;
  final WellnessMetric initialMetric;
  final ValueChanged<bool>? onActivityChanged;
  final ValueChanged<WellnessMetric>? onMetricChanged;

  @override
  State<WellnessHistory> createState() => _WellnessHistoryState();
}

class _WellnessHistoryState extends State<WellnessHistory> {
  late bool _activity = widget.initialActivity ?? !widget.readingsAvailable;
  late WellnessMetric _metric =
      !widget.pilotPreview &&
          widget.initialMetric == WellnessMetric.skinTemperature
      ? WellnessMetric.heartRate
      : widget.initialMetric;

  void _selectActivity(bool activity) {
    setState(() => _activity = activity);
    widget.onActivityChanged?.call(activity);
  }

  void _selectMetric(WellnessMetric metric) {
    setState(() => _metric = metric);
    widget.onMetricChanged?.call(metric);
  }

  @override
  void didUpdateWidget(covariant WellnessHistory oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!widget.pilotPreview && _metric == WellnessMetric.skinTemperature) {
      _metric = WellnessMetric.heartRate;
    }
  }

  WellnessTrend trend(WellnessMetric metric) => WellnessTrend(
    metric: metric,
    window: widget.window,
    samples: widget.readingError || !widget.readingsAvailable
        ? const []
        : widget.samples,
    now: widget.now,
    pilotPreview: widget.pilotPreview,
  );

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final today = widget.window.end.difference(widget.window.start).inDays == 1;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.planDescription != null || widget.onRoutine != null) ...[
          Wrap(
            spacing: 16,
            runSpacing: 8,
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (widget.planDescription != null)
                Text(
                  widget.planDescription!,
                  style: TextStyle(color: colors.textSecondary),
                ),
              if (widget.onRoutine != null)
                OutlinedButton.icon(
                  onPressed: widget.onRoutine,
                  icon: const Icon(Icons.schedule, size: 18),
                  label: const Text('Wellness routine'),
                ),
            ],
          ),
          const SizedBox(height: 18),
        ],
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.center,
          runSpacing: 12,
          spacing: 16,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  key: const ValueKey('wellness-tab-activity'),
                  avatar: const Icon(Icons.directions_walk_outlined, size: 18),
                  label: const Text('Activity'),
                  selected: _activity,
                  onSelected: (_) => _selectActivity(true),
                ),
                ChoiceChip(
                  key: const ValueKey('wellness-tab-readings'),
                  avatar: const Icon(Icons.monitor_heart_outlined, size: 18),
                  label: const Text('Watch readings'),
                  selected: !_activity,
                  onSelected: (_) => _selectActivity(false),
                ),
              ],
            ),
            if (widget.onToday != null || widget.onWeek != null)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ChoiceChip(
                    label: const Text('Today'),
                    selected: today,
                    onSelected: widget.onToday == null
                        ? null
                        : (_) => widget.onToday!(),
                  ),
                  ChoiceChip(
                    label: const Text('7 days'),
                    selected: !today,
                    onSelected: widget.onWeek == null
                        ? null
                        : (_) => widget.onWeek!(),
                  ),
                ],
              ),
          ],
        ),
        if (widget.onPrevious != null ||
            widget.onNext != null ||
            widget.onChooseDate != null) ...[
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: widget.onPrevious,
                child: const Text('Earlier week'),
              ),
              OutlinedButton(
                onPressed: widget.onNext,
                child: const Text('Later week'),
              ),
              TextButton.icon(
                onPressed: widget.onChooseDate,
                icon: const Icon(Icons.calendar_month_outlined),
                label: const Text('Choose date'),
              ),
            ],
          ),
        ],
        const SizedBox(height: 16),
        if (widget.loading) ...[
          const LinearProgressIndicator(minHeight: 2),
          const SizedBox(height: 12),
        ],
        if (_activity) _activityView(context) else _readingsView(context),
        const SizedBox(height: 16),
        if (widget.pilotPreview)
          _HistoryDisclosure(
            childrenPadding: const EdgeInsets.only(bottom: 12),
            title: Text(
              'Private preview · Unverified readings',
              style: TextStyle(fontSize: 13, color: colors.textSecondary),
            ),
            children: const [
              Text(
                'Wearing at measurement time is unconfirmed. These values are excluded from customer reports and alerts. Recorded ranges describe saved values, not medical reference ranges.',
              ),
            ],
          )
        else
          Text(
            'These are watch estimates, not medical measurements.',
            style: TextStyle(color: colors.textSecondary, fontSize: 12),
          ),
        if (widget.onAsk != null) ...[
          const SizedBox(height: 16),
          OutlinedButton.icon(
            onPressed: widget.onAsk,
            icon: const Icon(Icons.chat_bubble_outline),
            label: const Text('Ask on WhatsApp'),
          ),
        ],
      ],
    );
  }

  Widget _readingsView(BuildContext context) {
    final colors = context.guardianColors;
    if (!widget.readingsAvailable) {
      return const WellnessSurface(
        child: Text('Wellbeing readings are not available yet.'),
      );
    }
    if (widget.readingError) {
      return const WellnessSurface(
        child: Text(
          'Readings could not be verified. Check your connection and reading access.',
        ),
      );
    }
    final selected = trend(_metric);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final largeText = MediaQuery.textScalerOf(context).scale(14) > 20;
            final columns = largeText || constraints.maxWidth < 300
                ? 1
                : constraints.maxWidth >= 820
                ? 4
                : 2;
            const metrics = [
              WellnessMetric.heartRate,
              WellnessMetric.bloodOxygen,
              WellnessMetric.bloodPressure,
              WellnessMetric.skinTemperature,
            ];
            return Column(
              children: [
                for (var start = 0; start < metrics.length; start += columns)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          for (
                            var i = start;
                            i < start + columns && i < metrics.length;
                            i++
                          ) ...[
                            if (i > start) const SizedBox(width: 12),
                            Expanded(
                              child: _MetricCard(
                                metric: metrics[i],
                                sample: trend(metrics[i]).latest,
                                selected: _metric == metrics[i],
                                now: widget.now,
                                available:
                                    widget.pilotPreview ||
                                    metrics[i] !=
                                        WellnessMetric.skinTemperature,
                                loading: widget.loading,
                                onTap: () => _selectMetric(metrics[i]),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
        WellnessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                '${_metric.label} over time',
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${wellnessPeriodLabel(widget.window)} · Mauritius time',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 14),
              if (selected.range != null)
                Text(
                  'Recorded range · ${selected.range}',
                  key: const ValueKey('wellness-recorded-range'),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
              if (_metric == WellnessMetric.bloodPressure &&
                  selected.points.isNotEmpty)
                Wrap(
                  spacing: 16,
                  runSpacing: 8,
                  children: [
                    _Legend(
                      label: 'Systolic',
                      color: metricColor(_metric, context),
                    ),
                    _Legend(
                      label: 'Diastolic',
                      color: colors.textPrimary,
                      square: true,
                    ),
                  ],
                ),
              const SizedBox(height: 12),
              if (widget.loading && selected.readings.isEmpty)
                const Text('Loading watch readings…')
              else if (selected.readings.isEmpty)
                const Text('No readings in this period.')
              else if (selected.points.isEmpty)
                const Text(
                  'Chart values are unavailable for these records. Open the reading log for saved values.',
                )
              else ...[
                WellnessChart(
                  key: ValueKey(
                    '${_metric.name}:${widget.window.start}:${widget.window.end}',
                  ),
                  window: widget.window,
                  unit: _metric.unit,
                  color: metricColor(_metric, context),
                  points: [
                    for (final sample in selected.points)
                      WellnessPlotPoint(
                        at: sample.recordedAt,
                        value: sample.numericValue!.toDouble(),
                        secondary: sample.secondaryValue?.toDouble(),
                        label:
                            '${_metric == WellnessMetric.skinTemperature ? 'Received ' : ''}${wellnessLocalTime(sample.recordedAt)} MUT · ${sample.value}',
                      ),
                  ],
                ),
                const SizedBox(height: 14),
                Divider(color: colors.border),
                const SizedBox(height: 8),
                Text(
                  '${selected.readings.length} readings · ${selected.daysWithReadings} of ${selected.daysInWindow} days with data',
                  style: TextStyle(color: colors.textSecondary, fontSize: 12),
                ),
                const SizedBox(height: 4),
                Text(
                  _metric == WellnessMetric.skinTemperature
                      ? 'Points show receipt times. Measurement times are unconfirmed.'
                      : 'Each point is one saved reading. Missing records remain gaps.',
                  style: TextStyle(color: colors.textSecondary, fontSize: 12),
                ),
              ],
            ],
          ),
        ),
        if (selected.readings.isNotEmpty) ...[
          const SizedBox(height: 14),
          _ReadingLog(
            key: ValueKey(
              'log:${_metric.name}:${widget.window.start}:${widget.window.end}',
            ),
            samples: selected.readings.reversed.toList(),
            now: widget.now,
            metric: _metric,
          ),
        ],
      ],
    );
  }

  Widget _activityView(BuildContext context) {
    final colors = context.guardianColors;
    if (!widget.activityAvailable) {
      return const WellnessSurface(
        child: Text('Activity is not available yet.'),
      );
    }
    if (widget.activityError) {
      return const WellnessSurface(
        child: Text('Activity history could not be loaded.'),
      );
    }
    final accepted = wellnessActivityDays(
      days: widget.days,
      window: widget.window,
      now: widget.now,
    );
    final byDate = {for (final day in accepted) day.localDate: day};
    final dates = [
      for (
        var date = widget.window.start;
        date.isBefore(widget.window.end);
        date = date.add(const Duration(days: 1))
      )
        date,
    ];
    final includesToday = widget.window.includesDate(
      wellnessDateKey(widget.now),
    );
    final latest = includesToday
        ? byDate[wellnessDateKey(widget.now)]
        : accepted.lastOrNull;
    String dayValue(ActivityDay? day) => day == null
        ? 'No reading'
        : '${NumberFormat.decimalPattern().format(day.steps)} steps${day.partialCoverage ? ' · Partial day' : ''}';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WellnessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                includesToday
                    ? widget.pilotPreview
                          ? 'Recorded steps today'
                          : 'Steps today'
                    : 'Latest recorded day in this period',
                style: TextStyle(color: colors.textSecondary),
              ),
              const SizedBox(height: 6),
              Text(
                latest == null
                    ? '—'
                    : NumberFormat.decimalPattern().format(latest.steps),
                style: TextStyle(
                  fontSize: 36,
                  fontWeight: FontWeight.w700,
                  color: colors.textPrimary,
                ),
              ),
              Text(
                latest == null
                    ? widget.loading
                          ? 'Loading activity…'
                          : includesToday
                          ? 'No reading today'
                          : 'No records in this period'
                    : '${latest.partialCoverage ? 'Partial day · ' : ''}${wellnessLocalTime(latest.lastObservedAt)} MUT',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 22),
              const Text(
                'Daily activity',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(
                wellnessPeriodLabel(widget.window),
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 14),
              if (accepted.isEmpty)
                Text(
                  widget.loading
                      ? 'Loading activity history…'
                      : 'No activity records in this period.',
                )
              else
                WellnessChart(
                  key: ValueKey(
                    'activity:${widget.window.start}:${widget.window.end}',
                  ),
                  window: widget.window,
                  unit: 'Steps',
                  color: colors.accent,
                  activity: true,
                  points: [
                    for (final date in dates)
                      WellnessPlotPoint(
                        at: date.add(const Duration(hours: 12)),
                        value: byDate[wellnessDateKey(date)]?.steps.toDouble(),
                        label:
                            '${wellnessDateKey(date)} · ${dayValue(byDate[wellnessDateKey(date)])}',
                      ),
                  ],
                ),
              const SizedBox(height: 12),
              Divider(color: colors.border),
              const SizedBox(height: 8),
              Text(
                '${accepted.length} of ${dates.length} days with recorded data',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
              const SizedBox(height: 4),
              Text(
                accepted.any((day) => day.partialCoverage)
                    ? 'Partial totals · Missing days are gaps, not zero steps.'
                    : 'Missing days are gaps, not zero steps.',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        WellnessSurface(
          child: _HistoryDisclosure(
            key: ValueKey(
              'activity-log:${widget.window.start}:${widget.window.end}',
            ),
            title: const Text(
              'Daily log',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            subtitle: Text('${dates.length} days'),
            children: [
              for (final date in dates.reversed)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          DateFormat(
                            'EEE d MMM',
                          ).format(date.toUtc().add(const Duration(hours: 4))),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          dayValue(byDate[wellnessDateKey(date)]),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

Color metricColor(WellnessMetric metric, BuildContext context) {
  final base = switch (metric) {
    WellnessMetric.heartRate => const Color(0xFFB85667),
    WellnessMetric.bloodOxygen => const Color(0xFF2875AD),
    WellnessMetric.bloodPressure => const Color(0xFFAA7845),
    WellnessMetric.skinTemperature => const Color(0xFF7860AA),
  };
  return Theme.of(context).brightness == Brightness.dark
      ? Color.lerp(base, Colors.white, .3)!
      : base;
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.metric,
    required this.sample,
    required this.selected,
    required this.available,
    required this.loading,
    required this.now,
    required this.onTap,
  });
  final WellnessMetric metric;
  final WellnessSample? sample;
  final bool selected, available, loading;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final icon = switch (metric) {
      WellnessMetric.heartRate => Icons.favorite_border_rounded,
      WellnessMetric.bloodOxygen => Icons.water_drop_outlined,
      WellnessMetric.bloodPressure => Icons.speed_outlined,
      WellnessMetric.skinTemperature => Icons.thermostat_outlined,
    };
    return Semantics(
      selected: selected,
      child: Material(
        color: colors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: selected ? colors.accent : colors.border,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          key: ValueKey('wellness-metric-${metric.name}'),
          onTap: available ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(icon, size: 20, color: metricColor(metric, context)),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        metric.label,
                        style: TextStyle(
                          fontSize: 13,
                          color: colors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                Text(
                  available
                      ? sample?.value ?? '— ${metric.unit}'
                      : '— ${metric.unit}',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    color: colors.textPrimary,
                  ),
                ),
                const SizedBox(height: 7),
                Text(
                  !available
                      ? 'Not available yet'
                      : sample == null
                      ? loading
                            ? 'Loading…'
                            : 'No reading in this period'
                      : '${metric == WellnessMetric.skinTemperature ? 'Received' : 'Latest'} · ${wellnessLocalTime(sample!.recordedAt)} MUT',
                  style: TextStyle(fontSize: 12, color: colors.textSecondary),
                ),
                if (available && sample != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    wellnessAge(sample!.recordedAt, now),
                    style: TextStyle(fontSize: 12, color: colors.textSecondary),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({
    required this.label,
    required this.color,
    this.square = false,
  });
  final String label;
  final Color color;
  final bool square;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Container(
        width: 9,
        height: 9,
        decoration: BoxDecoration(
          color: color,
          shape: square ? BoxShape.rectangle : BoxShape.circle,
        ),
      ),
      const SizedBox(width: 6),
      Text(label, style: const TextStyle(fontSize: 12)),
    ],
  );
}

class _ReadingLog extends StatefulWidget {
  const _ReadingLog({
    super.key,
    required this.samples,
    required this.now,
    required this.metric,
  });
  final List<WellnessSample> samples;
  final DateTime now;
  final WellnessMetric metric;
  @override
  State<_ReadingLog> createState() => _ReadingLogState();
}

class _ReadingLogState extends State<_ReadingLog> {
  int _visible = 20;
  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final shown = widget.samples.take(_visible).toList();
    final dates = shown.map((s) => wellnessDateKey(s.recordedAt)).toSet();
    return WellnessSurface(
      child: _HistoryDisclosure(
        title: const Text(
          'Reading log',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        subtitle: Text(
          '${widget.samples.length} ${widget.metric.label.toLowerCase()} readings',
        ),
        children: [
          for (final date in dates) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                date == wellnessDateKey(widget.now) ? 'Today · $date' : date,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
            for (final sample in shown.where(
              (s) => wellnessDateKey(s.recordedAt) == date,
            ))
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      spacing: 16,
                      runSpacing: 4,
                      children: [
                        Text(
                          '${widget.metric == WellnessMetric.skinTemperature ? 'Received ' : ''}${DateFormat('HH:mm').format(sample.recordedAt.toUtc().add(const Duration(hours: 4)))} MUT',
                          style: TextStyle(color: colors.textSecondary),
                        ),
                        Text(
                          sample.value,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      wellnessAge(sample.recordedAt, widget.now),
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            Divider(color: colors.border),
          ],
          if (widget.samples.length > _visible)
            TextButton(
              onPressed: () => setState(() => _visible += 20),
              child: Text(
                'Show more readings (${widget.samples.length - _visible} remaining)',
              ),
            ),
        ],
      ),
    );
  }
}

/// Keeps disclosure ink above both the card decoration and the page background.
class _HistoryDisclosure extends StatelessWidget {
  const _HistoryDisclosure({
    super.key,
    required this.title,
    required this.children,
    this.subtitle,
    this.childrenPadding = EdgeInsets.zero,
  });
  final Widget title;
  final Widget? subtitle;
  final List<Widget> children;
  final EdgeInsetsGeometry childrenPadding;

  @override
  Widget build(BuildContext context) => Material(
    type: MaterialType.transparency,
    child: ExpansionTile(
      title: title,
      subtitle: subtitle,
      tilePadding: EdgeInsets.zero,
      childrenPadding: childrenPadding,
      children: children,
    ),
  );
}
