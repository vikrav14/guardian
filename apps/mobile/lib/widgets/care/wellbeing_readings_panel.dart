import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../models/wellbeing_reading.dart';
import '../../theme/app_theme.dart';

class WellbeingReadingsPanel extends StatelessWidget {
  const WellbeingReadingsPanel({
    super.key,
    required this.allowed,
    required this.readings,
    this.now,
  });

  final bool allowed;
  final Stream<List<WellbeingReading>> readings;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.favorite_outline, size: 21),
              SizedBox(width: 10),
              Text(
                'Latest wellbeing',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            allowed
                ? 'Automatic watch estimates, normally updated hourly when a measurement succeeds.'
                : 'Wellbeing insights are available with Guardian Care.',
            style: TextStyle(color: colors.textSecondary),
          ),
          if (allowed) ...[
            const SizedBox(height: 16),
            StreamBuilder<List<WellbeingReading>>(
              stream: readings,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return const Text('Readings are temporarily unavailable.');
                }
                if (!snapshot.hasData) {
                  return const LinearProgressIndicator();
                }
                final values = snapshot.data!;
                if (values.isEmpty) {
                  return const Text(
                    'No wellbeing reading has been received yet.',
                  );
                }
                final latest = values.reduce(
                  (a, b) => a.observedAt.isAfter(b.observedAt) ? a : b,
                );
                final latestAge = (now ?? DateTime.now()).difference(latest.observedAt);
                final recent = !latestAge.isNegative && latestAge.inMinutes <= 90;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      recent
                          ? 'Updated ${_ageLabel(latestAge)}'
                          : 'No recent reading · last update ${_ageLabel(latestAge)}',
                      style: TextStyle(
                        color: recent ? colors.accent : colors.textSecondary,
                        fontWeight: FontWeight.w700,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 12),
                    for (final reading in values.take(4))
                      _ReadingRow(reading: reading, now: now ?? DateTime.now()),
                  ],
                );
              },
            ),
            const SizedBox(height: 14),
            Text(
              'Watch estimates only—not medical measurements. A missing or old reading does not mean the wearer is safe or unwell. If symptoms or concerns exist, check on the wearer and seek appropriate medical help.',
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ReadingRow extends StatelessWidget {
  const _ReadingRow({required this.reading, required this.now});

  final WellbeingReading reading;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final received = DateFormat('d MMM, HH:mm').format(reading.observedAt.toLocal());
    final age = _ageLabel(now.difference(reading.observedAt));
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            reading.metricSet == WellbeingMetricSet.spo2
                ? Icons.air
                : Icons.monitor_heart_outlined,
            color: colors.accent,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reading.measurementLabel,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 2),
                Text(
                  'Received $received · $age',
                  style: TextStyle(color: colors.textSecondary, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _ageLabel(Duration age) {
  if (age.isNegative || age.inMinutes < 1) return 'just now';
  if (age.inMinutes < 60) return '${age.inMinutes} min ago';
  if (age.inHours < 24) return '${age.inHours} h ago';
  return '${age.inDays} d ago';
}
