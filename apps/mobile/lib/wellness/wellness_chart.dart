import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart' show DateFormat, NumberFormat;
import '../theme/app_theme.dart';
import 'wellness_window.dart';

class WellnessPlotPoint {
  const WellnessPlotPoint({
    required this.at,
    required this.label,
    this.value,
    this.secondary,
  });
  final DateTime at;
  final String label;
  final double? value, secondary;
}

/// Plots only supplied observations. Missing activity days stay null; reading
/// points are deliberately not interpolated across unobserved intervals.
class WellnessChart extends StatefulWidget {
  const WellnessChart({
    super.key,
    required this.points,
    required this.window,
    required this.unit,
    required this.color,
    this.activity = false,
  });
  final List<WellnessPlotPoint> points;
  final WellnessWindow window;
  final String unit;
  final Color color;
  final bool activity;

  @override
  State<WellnessChart> createState() => _WellnessChartState();
}

class _WellnessChartState extends State<WellnessChart> {
  DateTime? _selectedAt;
  double? _selectedValue, _selectedSecondary;
  bool _focused = false;

  int? get _selected {
    final index = widget.points.indexWhere(
      (p) =>
          p.at == _selectedAt &&
          p.value == _selectedValue &&
          p.secondary == _selectedSecondary,
    );
    return index < 0 ? null : index;
  }

  void _select(int index) {
    if (index != _selected) {
      setState(() {
        _selectedAt = widget.points[index].at;
        _selectedValue = widget.points[index].value;
        _selectedSecondary = widget.points[index].secondary;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final scale = MediaQuery.textScalerOf(context).scale(12) / 12;
    final labelStyle = TextStyle(
      fontFamily: Theme.of(context).textTheme.bodySmall?.fontFamily,
      fontSize: 12 * scale,
      color: colors.textSecondary,
    );
    final selected = _selected;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Focus(
          onFocusChange: (value) => setState(() => _focused = value),
          onKeyEvent: (_, event) {
            if (event is! KeyDownEvent || widget.points.isEmpty) {
              return KeyEventResult.ignored;
            }
            final direction = event.logicalKey == LogicalKeyboardKey.arrowRight
                ? 1
                : event.logicalKey == LogicalKeyboardKey.arrowLeft
                ? -1
                : 0;
            if (direction == 0) return KeyEventResult.ignored;
            _select(
              ((selected ?? (direction > 0 ? -1 : widget.points.length)) +
                      direction)
                  .clamp(0, widget.points.length - 1)
                  .toInt(),
            );
            return KeyEventResult.handled;
          },
          child: Semantics(
            label: widget.activity
                ? 'Daily recorded steps. Missing days are gaps, not zero steps.'
                : '${widget.unit} chart of saved readings. Each point is one record.',
            hint:
                'Use left and right arrow keys to inspect records, or open the log below.',
            child: LayoutBuilder(
              builder: (context, constraints) {
                final size = Size(constraints.maxWidth, 250 + 65 * (scale - 1));
                final layout = _PlotLayout(
                  size: size,
                  style: labelStyle,
                  window: widget.window,
                  points: widget.points,
                  activity: widget.activity,
                );
                void inspect(Offset offset) {
                  if (widget.points.isEmpty) return;
                  var nearest = 0;
                  var distance = double.infinity;
                  for (var i = 0; i < widget.points.length; i++) {
                    final delta = (layout.x(widget.points[i].at) - offset.dx)
                        .abs();
                    if (delta < distance) {
                      nearest = i;
                      distance = delta;
                    }
                  }
                  _select(nearest);
                }

                return MouseRegion(
                  cursor: SystemMouseCursors.click,
                  onHover: (event) => inspect(event.localPosition),
                  child: GestureDetector(
                    key: const ValueKey('wellness-chart-plot'),
                    behavior: HitTestBehavior.opaque,
                    onTapDown: (event) => inspect(event.localPosition),
                    child: CustomPaint(
                      size: size,
                      painter: _WellnessPainter(
                        layout: layout,
                        points: widget.points,
                        selected: selected,
                        color: widget.color,
                        colors: colors,
                        unit: widget.unit,
                        activity: widget.activity,
                        focused: _focused,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 8),
        Semantics(
          liveRegion: true,
          child: Text(
            selected == null
                ? widget.activity
                      ? 'Select a day to see its recorded total.'
                      : 'Select a point to see its saved reading.'
                : widget.points[selected].label,
            key: const ValueKey('wellness-chart-selection'),
            style: TextStyle(fontSize: 12, color: colors.textSecondary),
          ),
        ),
      ],
    );
  }
}

class _PlotLayout {
  _PlotLayout({
    required this.size,
    required this.style,
    required this.window,
    required List<WellnessPlotPoint> points,
    required bool activity,
  }) {
    final values = points
        .expand((p) => [p.value, p.secondary])
        .whereType<double>()
        .where((v) => v.isFinite)
        .toList();
    final minimum = values.isEmpty ? 0.0 : values.reduce(math.min);
    final maximum = values.isEmpty ? 1.0 : values.reduce(math.max);
    final padding = activity
        ? 0.0
        : math.max((maximum - minimum) * .15, maximum.abs() < 60 ? .1 : 1.0);
    final lower = activity ? 0.0 : minimum - padding;
    final upper = math.max(lower + .01, maximum + padding);
    final rough = (upper - lower) / 4;
    final magnitude = math
        .pow(10, (math.log(rough) / math.ln10).floor())
        .toDouble();
    final fraction = rough / magnitude;
    step =
        (fraction <= 1
            ? 1
            : fraction <= 2
            ? 2
            : fraction <= 5
            ? 5
            : 10) *
        magnitude;
    if (activity) step = math.max(1.0, step);
    low = (lower / step).floor() * step;
    high = math.max(low + step, (upper / step).ceil() * step);
    digits = step < 1 ? math.min(2, -(math.log(step) / math.ln10).floor()) : 0;
    ticks = [
      for (var i = 0; i <= ((high - low) / step).round(); i++) low + i * step,
    ];
    final widest = ticks
        .map((v) => measure(number(v)).width)
        .fold<double>(0, math.max);
    final fontHeight = measure('12 Sep').height;
    plot = Rect.fromLTRB(
      widest + 12,
      fontHeight + 12,
      math.max(widest + 32, size.width - 14),
      size.height - fontHeight * 2 - 18,
    );
  }

  final Size size;
  final TextStyle style;
  final WellnessWindow window;
  late final double low, high;
  late double step;
  late final int digits;
  late final List<double> ticks;
  late final Rect plot;

  TextPainter measure(String value) => TextPainter(
    text: TextSpan(text: value, style: style),
    textDirection: TextDirection.ltr,
  )..layout();
  String number(double value) =>
      NumberFormat.decimalPatternDigits(decimalDigits: digits).format(value);
  double x(DateTime at) =>
      plot.left +
      at.difference(window.start).inMilliseconds /
          window.end.difference(window.start).inMilliseconds *
          plot.width;
  double y(double value) =>
      plot.bottom - (value - low) / (high - low) * plot.height;
}

class _WellnessPainter extends CustomPainter {
  const _WellnessPainter({
    required this.layout,
    required this.points,
    required this.selected,
    required this.color,
    required this.colors,
    required this.unit,
    required this.activity,
    required this.focused,
  });
  final _PlotLayout layout;
  final List<WellnessPlotPoint> points;
  final int? selected;
  final Color color;
  final GuardianThemeColors colors;
  final String unit;
  final bool activity, focused;

  void label(Canvas canvas, String value, Offset at, {double align = 0}) {
    final text = layout.measure(value);
    final dx = (at.dx - text.width * align)
        .clamp(0.0, math.max(0.0, layout.size.width - text.width))
        .toDouble();
    text.paint(canvas, Offset(dx, at.dy));
  }

  @override
  void paint(Canvas canvas, Size size) {
    final plot = layout.plot;
    final grid = Paint()
      ..color = colors.border
      ..strokeWidth = 1;
    label(canvas, unit, Offset(plot.left, 0));
    for (final tick in layout.ticks) {
      final y = layout.y(tick);
      canvas.drawLine(Offset(plot.left, y), Offset(plot.right, y), grid);
      label(
        canvas,
        layout.number(tick),
        Offset(plot.left - 9, y - layout.measure('1').height / 2),
        align: 1,
      );
    }
    final days = layout.window.end.difference(layout.window.start).inDays;
    final labelWidth =
        layout.measure(days == 1 ? '24:00' : '30 Sep').width + 20;
    final count = (plot.width / labelWidth).floor().clamp(1, days == 1 ? 4 : 7);
    for (var i = 0; i < count; i++) {
      final ratio = count == 1 ? .5 : i / (count - 1);
      if (days == 1 && !activity) {
        final hour = (ratio * 24).round();
        label(
          canvas,
          '${hour.toString().padLeft(2, '0')}:00',
          Offset(plot.left + plot.width * ratio, plot.bottom + 12),
          align: ratio,
        );
      } else {
        final day = count == 1
            ? (days / 2).floor()
            : (ratio * (days - 1)).round();
        final at = layout.window.start.add(Duration(days: day, hours: 12));
        label(
          canvas,
          DateFormat('d MMM').format(at.toUtc().add(const Duration(hours: 4))),
          Offset(layout.x(at), plot.bottom + 12),
          align: .5,
        );
      }
    }
    label(
      canvas,
      'Mauritius time',
      Offset(plot.center.dx, size.height - layout.measure('MUT').height),
      align: .5,
    );
    if (selected != null) {
      final x = layout.x(points[selected!].at);
      canvas.drawLine(
        Offset(x, plot.top),
        Offset(x, plot.bottom),
        Paint()
          ..color = colors.textMuted.withValues(alpha: .55)
          ..strokeWidth = 1,
      );
    }
    canvas.save();
    canvas.clipRect(plot.inflate(5));
    final primary = Paint()..color = color;
    final secondary = Paint()..color = colors.textPrimary;
    for (var i = 0; i < points.length; i++) {
      final p = points[i];
      final x = layout.x(p.at);
      if (p.value == null) {
        if (activity)
          label(canvas, '—', Offset(x, plot.bottom - 24), align: .5);
        continue;
      }
      final y = layout.y(p.value!);
      if (activity && p.value! > 0) {
        final width = math.min(48.0, plot.width / math.max(1, days) * .58);
        canvas.drawRRect(
          RRect.fromRectAndRadius(
            Rect.fromLTRB(x - width / 2, y, x + width / 2, plot.bottom),
            const Radius.circular(5),
          ),
          primary,
        );
      } else {
        canvas.drawCircle(Offset(x, y), selected == i ? 6 : 4, primary);
      }
      if (p.secondary != null) {
        final sy = layout.y(p.secondary!);
        canvas.drawLine(
          Offset(x, y),
          Offset(x, sy),
          Paint()
            ..color = color.withValues(alpha: .3)
            ..strokeWidth = 1.5,
        );
        canvas.drawRect(
          Rect.fromCenter(center: Offset(x, sy), width: 7, height: 7),
          secondary,
        );
      }
    }
    canvas.restore();
    if (focused) {
      canvas.drawRect(
        plot,
        Paint()
          ..color = colors.accent
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _WellnessPainter oldDelegate) => true;
}
