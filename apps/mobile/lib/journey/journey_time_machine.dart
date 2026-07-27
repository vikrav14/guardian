import 'package:intl/intl.dart';

/// A quick-pick or memory entry for the Time Machine date picker.
class JourneyDateOption {
  const JourneyDateOption({
    required this.label,
    required this.date,
    this.subtitle,
  });

  final String label;
  final DateTime date;
  final String? subtitle;
}

DateTime _dayOnly(DateTime d) => DateTime(d.year, d.month, d.day);

bool _isWeekday(DateTime d) {
  final w = d.weekday;
  return w >= DateTime.monday && w <= DateTime.friday;
}

bool _isWeekend(DateTime d) {
  final w = d.weekday;
  return w == DateTime.saturday || w == DateTime.sunday;
}

/// Builds quick picks and memory heuristics from days that have journey data.
List<JourneyDateOption> buildTimeMachineOptions({
  required DateTime selectedDay,
  required Set<DateTime> daysWithData,
  DateTime? referenceNow,
}) {
  final now = referenceNow ?? DateTime.now();
  final today = _dayOnly(now);
  final yesterday = today.subtract(const Duration(days: 1));
  final sortedDays = daysWithData.map(_dayOnly).toSet().toList()
    ..sort((a, b) => b.compareTo(a));

  final options = <JourneyDateOption>[];

  if (sortedDays.contains(today)) {
    options.add(JourneyDateOption(label: 'Today', date: today));
  }
  if (sortedDays.contains(yesterday)) {
    options.add(JourneyDateOption(label: 'Yesterday', date: yesterday));
  }

  // Last 7 calendar days with data (excluding today if already listed).
  final last7 = sortedDays.where((d) {
    final diff = today.difference(d).inDays;
    return diff >= 0 && diff < 7;
  }).take(7).toList();

  for (final d in last7) {
    if (d == today || d == yesterday) continue;
    options.add(
      JourneyDateOption(
        label: DateFormat.E().format(d),
        date: d,
        subtitle: DateFormat.MMMd().format(d),
      ),
    );
  }

  // Memories — last weekday matching today's weekday (e.g. "Last Monday").
  final weekdayName = DateFormat.EEEE().format(selectedDay);
  final lastSameWeekday = sortedDays.firstWhere(
    (d) => d.weekday == selectedDay.weekday && d.isBefore(selectedDay),
    orElse: () => DateTime(1970),
  );
  if (lastSameWeekday.year > 1970 && _isWeekday(lastSameWeekday)) {
    options.add(
      JourneyDateOption(
        label: 'Last $weekdayName',
        date: lastSameWeekday,
        subtitle: 'Last school day pattern',
      ),
    );
  }

  final lastSchoolDay = sortedDays.firstWhere(
    (d) => _isWeekday(d) && d.isBefore(today),
    orElse: () => DateTime(1970),
  );
  if (lastSchoolDay.year > 1970 &&
      !options.any((o) => _dayOnly(o.date) == lastSchoolDay)) {
    options.add(
      JourneyDateOption(
        label: 'Last School Day',
        date: lastSchoolDay,
        subtitle: DateFormat.EEEE().format(lastSchoolDay),
      ),
    );
  }

  final lastWeekend = sortedDays.firstWhere(
    (d) => _isWeekend(d) && d.isBefore(today),
    orElse: () => DateTime(1970),
  );
  if (lastWeekend.year > 1970) {
    options.add(
      JourneyDateOption(
        label: 'Last Weekend',
        date: lastWeekend,
        subtitle: DateFormat.EEEE().format(lastWeekend),
      ),
    );
  }

  return options;
}
