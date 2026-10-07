import 'package:flutter/material.dart';

import '../services/care_reminders_service.dart';
import '../services/guardian_entitlements.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

bool canPreviewMovementReminders(
  GuardianSubscription subscription, {
  bool enabled = guardianCareRemindersEnabled,
  DateTime? now,
}) =>
    enabled &&
    subscription.serviceActive &&
    subscription.plan == GuardianPlan.care &&
    (subscription.accessUntil == null ||
        subscription.accessUntil!.isAfter(now ?? DateTime.now()));

/// Product preview only. There is intentionally no watch service or save path.
class MovementReminderPreviewPage extends StatelessWidget {
  const MovementReminderPreviewPage({
    super.key,
    required this.name,
    required this.subscription,
  });

  final String name;
  final GuardianSubscription subscription;

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: context.guardianColors.canvas,
    appBar: AppBar(title: const Text('Movement reminders')),
    body: !canPreviewMovementReminders(subscription)
        ? const Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text('Movement reminders are not available yet.'),
            ),
          )
        : SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: GuardianPageFrame(
                maxWidth: 640,
                child: MovementReminderPreviewContent(name: name),
              ),
            ),
          ),
  );
}

/// Local example values never represent the watch's requested or applied state.
class MovementReminderPreviewContent extends StatefulWidget {
  const MovementReminderPreviewContent({super.key, required this.name});
  final String name;

  @override
  State<MovementReminderPreviewContent> createState() =>
      _MovementReminderPreviewContentState();
}

class _MovementReminderPreviewContentState
    extends State<MovementReminderPreviewContent> {
  bool _enabled = false;
  TimeOfDay _start = const TimeOfDay(hour: 8, minute: 0);
  TimeOfDay _end = const TimeOfDay(hour: 20, minute: 0);

  String _clock(TimeOfDay value) =>
      '${value.hour.toString().padLeft(2, '0')}:'
      '${value.minute.toString().padLeft(2, '0')}';

  Future<void> _chooseTime({required bool start}) async {
    final selected = await showTimePicker(
      context: context,
      initialTime: start ? _start : _end,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (selected == null || !mounted) return;
    final from = start ? selected : _start;
    final until = start ? _end : selected;
    if (from.hour * 60 + from.minute >= until.hour * 60 + until.minute) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose an end time after the start time.')),
      );
      return;
    }
    setState(() {
      _start = from;
      _end = until;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Align(
          alignment: Alignment.centerLeft,
          child: Chip(label: Text('Preview')),
        ),
        const SizedBox(height: 8),
        Text(
          'A gentle nudge to move',
          style: Theme.of(context).textTheme.headlineSmall,
        ),
        const SizedBox(height: 8),
        Text('Movement reminders for ${widget.name}.'),
        const SizedBox(height: 8),
        const Text(
          'Try these example settings. They stay on this screen and do not change the watch.',
        ),
        const SizedBox(height: 20),
        GuardianCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              SwitchListTile.adaptive(
                key: const ValueKey('movement-preview-switch'),
                contentPadding: EdgeInsets.zero,
                title: const Text('Movement reminder'),
                subtitle: Text(_enabled ? 'Example: On' : 'Example: Off'),
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
              ),
              const Divider(height: 24),
              const Text(
                'After 20 minutes without movement',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                'The first version is being prepared with a 20-minute interval.',
                style: TextStyle(color: colors.textSecondary),
              ),
              const SizedBox(height: 24),
              const Text(
                'Active hours',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              const Text('Example daytime window · Mauritius time'),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _chooseTime(start: true),
                    icon: const Icon(Icons.schedule),
                    label: Text('From ${_clock(_start)}'),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => _chooseTime(start: false),
                    icon: const Icon(Icons.schedule),
                    label: Text('Until ${_clock(_end)}'),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const GuardianCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Watch setting', style: TextStyle(fontWeight: FontWeight.w700)),
              SizedBox(height: 6),
              Text('Not checked'),
              SizedBox(height: 8),
              Text('This preview does not read the current watch setting.'),
            ],
          ),
        ),
        const SizedBox(height: 20),
        const FilledButton(onPressed: null, child: Text('Save to watch')),
        const SizedBox(height: 8),
        const Text(
          'Saving to the watch is not available in this preview.',
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
