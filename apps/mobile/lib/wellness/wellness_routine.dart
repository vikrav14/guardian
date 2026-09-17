import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'linked_wellness_stream.dart';
import 'wellness_card.dart';
import 'wellness_pilot_access.dart';
import '../services/guardian_entitlements.dart';
import '../widgets/layout/guardian_page_frame.dart';

const wellnessPilotPreview = bool.fromEnvironment(
  'GUARDIAN_WELLNESS_PILOT',
  defaultValue: false,
);

const wellnessRoutines = <String, (String, String)>{
  'manual': ('Manual', 'Automatic readings off'),
  'gentle': ('Gentle rhythm', 'Twice daily · choose your times'),
  'balanced': ('Balanced rhythm', 'Three times daily · choose your times'),
};

const wellnessRoutineTimeZone = 'Indian/Mauritius';
const wellnessRoutineDefaultTimes = <String, List<String>>{
  'manual': [],
  'gentle': ['08:00', '20:00'],
  'balanced': ['08:00', '14:00', '20:00'],
};

String? wellnessRoutineTimeError(String routine, List<String> times) {
  final count = wellnessRoutineDefaultTimes[routine]?.length;
  if (count == null || times.length != count) {
    return 'Choose the required number of reading times.';
  }
  final format = RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$');
  if (times.any((time) => time.length != 5 || !format.hasMatch(time))) {
    return 'Use a valid time in 24-hour format.';
  }
  if (times.toSet().length != times.length) {
    return 'Choose a different time for each reading.';
  }
  final minutes = times.map((time) {
    final parts = time.split(':');
    return int.parse(parts[0]) * 60 + int.parse(parts[1]);
  }).toList()..sort();
  for (var index = 0; index < minutes.length; index++) {
    final next = index + 1 < minutes.length
        ? minutes[index + 1]
        : minutes.first + 1440;
    if (next - minutes[index] < 5) {
      return 'Leave at least five minutes between readings.';
    }
  }
  return null;
}

class WellnessRoutineSelection {
  WellnessRoutineSelection({required this.routine, required List<String> times})
    : times = List<String>.unmodifiable([...times]..sort()) {
    final error = wellnessRoutineTimeError(routine, this.times);
    if (error != null) throw ArgumentError(error);
  }

  final String routine;
  final List<String> times;

  Map<String, dynamic> toRequest(String uid) => {
    'version': 2,
    'routine': routine,
    'times': times,
    'timeZone': wellnessRoutineTimeZone,
    'requestedBy': uid,
    'updatedAt': FieldValue.serverTimestamp(),
  };
}

DateTime? _routineDate(dynamic value) => switch (value) {
  Timestamp timestamp => timestamp.toDate(),
  DateTime date => date,
  String text => DateTime.tryParse(text),
  _ => null,
};

String _routineMoment(DateTime value, DateTime now) {
  final local = value.toUtc().add(const Duration(hours: 4));
  final today = now.toUtc().add(const Duration(hours: 4));
  final day = DateTime.utc(local.year, local.month, local.day);
  final currentDay = DateTime.utc(today.year, today.month, today.day);
  final difference = day.difference(currentDay).inDays;
  final hour = local.hour.toString().padLeft(2, '0');
  final minute = local.minute.toString().padLeft(2, '0');
  final dateLabel = switch (difference) {
    0 => 'today',
    1 => 'tomorrow',
    -1 => 'yesterday',
    _ => '${local.day}/${local.month}',
  };
  return '$dateLabel, $hour:$minute';
}

String wellnessRoutineMessage(Map<String, dynamic> status, DateTime now) {
  final updated = _routineDate(status['updatedAt']);
  if (updated == null ||
      updated.isAfter(now) ||
      now.difference(updated) > const Duration(minutes: 2)) {
    return 'Waiting for an update from the gateway.';
  }
  if (status['phase'] == 'stop_pending_offline') {
    return 'Stop pending · watch offline. Its previous schedule may still be running.';
  }
  if (status['phase'] == 'stop_sent') {
    return status['reason'] == 'temperature_mode_unconfirmed'
        ? 'Heart and oxygen stop sent. Temperature control is not confirmed.'
        : 'Stop commands sent. Check the watch to confirm measurements have stopped.';
  }
  return switch (status['reason']) {
    'routine_pilot_disabled' || 'pilot_disabled' =>
      'Automatic readings are not enabled on this gateway.',
    'native_schedule_stop_pending' =>
      'Preparing your routine · waiting for the previous watch schedule to stop.',
    'legacy_routine_requires_times' =>
      'Choose your daily times and apply the routine to continue.',
    'diagnostic_quarantine_active' =>
      'Finish the current watch test before starting automatic readings.',
    'measurement_busy' => 'Another reading check is in progress.',
    'attempt_in_progress' => 'Checking readings now…',
    'previous_attempt_reserved' => 'The previous check will not be repeated.',
    'daily_attempt_limit' => 'Today’s reading checks are complete.',
    'schedule_invalid' => 'Choose valid daily times and apply the routine again.',
    'access_or_consent_unavailable' =>
      'Paused · current access and wearer consent are required.',
    'watch_offline' => 'Waiting for the watch to connect.',
    'temperature_mode_unconfirmed' =>
      'Waiting to confirm this watch supports automatic temperature.',
    'watch_removed' => 'Paused · watch removed.',
    'wearing_unconfirmed' => 'Paused · wearing status is unconfirmed.',
    'previous_handoff_failed' =>
      'The previous change could not be completed. Review the watch before trying again.',
    'no_routine_selected' => 'Choose a routine below.',
    _ => switch (status['phase']) {
      'scheduled' => 'Your daily reading times are set.',
      'manual' => 'Automatic readings are off.',
      'running' => 'Checking readings now…',
      'sending' => 'Sending settings to the watch…',
      'awaiting_readings' =>
        'Schedule commands sent · automatic readings are not yet verified.',
      'handoff_failed' =>
        'The change may be incomplete. Guardian will attempt to stop both cycles.',
      _ => 'Waiting for confirmation from the gateway.',
    },
  };
}

String? wellnessRoutineNextCheck(Map<String, dynamic> status, DateTime now) {
  if (status['phase'] != 'scheduled') return null;
  final next = _routineDate(status['nextCheckAt']);
  if (next == null || next.isBefore(now)) return null;
  final updated = _routineDate(status['updatedAt']);
  if (updated == null || updated.isAfter(now) ||
      now.difference(updated) > const Duration(minutes: 2)) return null;
  return 'Next check · ${_routineMoment(next, now)}';
}

String? wellnessRoutineLastResult(Map<String, dynamic> status, DateTime now) {
  final attempt = status['lastAttempt'];
  if (attempt is! Map) return null;
  final at = _routineDate(attempt['finishedAt']) ??
      _routineDate(attempt['completedAt']) ??
      _routineDate(attempt['scheduledAt']);
  if (at == null || at.isAfter(now)) return null;
  final outcome = attempt['outcome'];
  final reason = attempt['reason'];
  final message = switch ((outcome, reason)) {
    ('temperature_upload_observed', _) => 'Readings received',
    (_, 'watch_offline') || ('watch_offline', _) => 'Skipped · watch offline',
    (_, 'unusable_heart_bp') || (_, 'unusable_oxygen') =>
      'No usable readings · temperature skipped',
    (_, 'optical_timeout') => 'Readings incomplete · temperature skipped',
    (_, 'removal_reported') => 'Skipped · removal reported',
    ('temperature_skipped', _) => 'Temperature skipped',
    ('temperature_capture_ended', _) => 'Temperature result unavailable',
    (_, 'access_or_consent_unavailable') => 'Skipped · access unavailable',
    (_, 'slot_missed') || (_, 'missed') => 'Skipped · scheduled time passed',
    (_, 'daily_limit_reached') || (_, 'daily_attempt_limit') =>
      'Skipped · today’s checks are complete',
    (_, 'previous_attempt_reserved') => 'Check not repeated',
    (_, 'attempt_in_progress') => 'Skipped · another check was in progress',
    (_, 'measurement_busy') => 'Skipped · another check was in progress',
    ('interrupted', _) || (_, 'interrupted') || ('interrupted_unknown', _) =>
      'Check interrupted',
    ('optical_handoff_unknown', _) || ('temperature_handoff_unknown', _) =>
      'Result unavailable',
    ('handoff_unknown', _) => 'Result unavailable',
    ('optical_request_handed_off', _) || ('dispatch_pending', _) ||
    ('running', _) || ('started', _) => 'Check started',
    _ => 'Check not completed',
  };
  return 'Last check · ${_routineMoment(at, now)}\n$message';
}

class WellnessRoutinePage extends StatelessWidget {
  const WellnessRoutinePage({
    super.key,
    required this.imei,
    required this.subscription,
    this.pilotPreview = wellnessPilotPreview,
    this.grants,
  });
  final String imei;
  final GuardianSubscription subscription;
  final bool pilotPreview;
  final Stream<List<WellnessPilotGrant>>? grants;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Wellness routine')),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: GuardianPageFrame(
        maxWidth: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            WellnessSurface(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    subscription.planLabel,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  Text(subscription.wellnessHistoryDescription),
                  const SizedBox(height: 8),
                  const Text(
                    'Your routine controls when supported readings are requested. Your plan controls how much history you can view.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (pilotPreview &&
                subscription.has(GuardianFeature.wellnessReadings))
              WellnessPilotAccess(
                imei: imei,
                grants: grants,
                unavailableChild: const WellnessRoutineControls(
                  status: {},
                  unavailableReason:
                      'Routine changes need current preview access. Automatic readings remain unconfirmed.',
                ),
                child: _ConnectedRoutine(imei: imei),
              )
            else
              WellnessRoutineControls(
                status: const {},
                unavailableReason:
                    subscription.has(GuardianFeature.wellnessReadings)
                    ? 'Automatic readings are not available for this watch yet. Available manual readings can still be taken on the watch.'
                    : 'An active Guardian plan is needed to manage Wellness.',
              ),
          ],
        ),
      ),
    ),
  );
}

class _ConnectedRoutine extends StatefulWidget {
  const _ConnectedRoutine({required this.imei});
  final String imei;
  @override
  State<_ConnectedRoutine> createState() => _ConnectedRoutineState();
}

class _ConnectedRoutineState extends State<_ConnectedRoutine> {
  late final Stream<List<Map<String, dynamic>>> _status =
      watchLinkedWellnessData(
        FirebaseFirestore.instance,
        FirebaseAuth.instance,
        widget.imei,
        () => FirebaseFirestore.instance
            .collection('devices')
            .doc(widget.imei)
            .collection('wellnessRoutine')
            .doc('current')
            .snapshots()
            .map((doc) => [doc.data() ?? <String, dynamic>{}]),
      );
  late final Stream<List<Map<String, dynamic>>> _request =
      watchLinkedWellnessData(
        FirebaseFirestore.instance,
        FirebaseAuth.instance,
        widget.imei,
        () => FirebaseFirestore.instance
            .collection('wellnessRoutineRequests')
            .doc(widget.imei)
            .snapshots()
            .map((doc) => [doc.data() ?? <String, dynamic>{}]),
      );
  @override
  Widget build(
    BuildContext context,
  ) => StreamBuilder<List<Map<String, dynamic>>>(
    stream: _status,
    builder: (context, snapshot) => StreamBuilder<List<Map<String, dynamic>>>(
      stream: _request,
      builder: (context, requestSnapshot) => WellnessRoutineControls(
        status: snapshot.hasError
            ? const {}
            : snapshot.data?.firstOrNull ?? const {},
        request: requestSnapshot.data?.firstOrNull ?? const {},
        unavailableReason: snapshot.hasError || requestSnapshot.hasError
            ? 'Could not load your routine. Check your connection and preview access.'
            : !snapshot.hasData || !requestSnapshot.hasData
            ? 'Loading your saved routine…'
            : null,
        onSave: (selection) async {
          final uid = FirebaseAuth.instance.currentUser?.uid;
          if (uid == null) throw StateError('Sign in again.');
          await FirebaseFirestore.instance
              .collection('wellnessRoutineRequests')
              .doc(widget.imei)
              .set(selection.toRequest(uid));
        },
      ),
    ),
  );
}

class WellnessRoutineControls extends StatefulWidget {
  const WellnessRoutineControls({
    super.key,
    required this.status,
    this.request = const {},
    this.onSave,
    this.unavailableReason,
  });
  final Map<String, dynamic> status;
  final Map<String, dynamic> request;
  final Future<void> Function(WellnessRoutineSelection)? onSave;
  final String? unavailableReason;
  @override
  State<WellnessRoutineControls> createState() =>
      _WellnessRoutineControlsState();
}

class _WellnessRoutineControlsState extends State<WellnessRoutineControls> {
  String _selected = 'manual';
  String? _feedback;
  bool _locallyEdited = false;
  final Map<String, List<String>> _times = {
    for (final entry in wellnessRoutineDefaultTimes.entries)
      entry.key: List<String>.of(entry.value),
  };
  bool _saving = false;
  late final Timer _timer;
  @override
  void initState() {
    super.initState();
    _initializeSelection();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted) setState(() {});
    });
  }

  void _initializeSelection() {
    if (_locallyEdited) return;
    final source = wellnessRoutines.containsKey(widget.request['routine'])
        ? widget.request
        : widget.status;
    final routine = source['routine'];
    if (routine is! String || !wellnessRoutines.containsKey(routine)) return;
    _selected = routine;
    final times = source['times'];
    if (source['timeZone'] == wellnessRoutineTimeZone && times is List &&
        times.every((time) => time is String)) {
      final parsed = times.cast<String>().toList();
      if (wellnessRoutineTimeError(routine, parsed) == null) {
        _times[routine] = parsed..sort();
      }
    }
  }

  @override
  void didUpdateWidget(covariant WellnessRoutineControls oldWidget) {
    super.didUpdateWidget(oldWidget);
    _initializeSelection();
  }

  Future<void> _pickTime(int index) async {
    final routine = _selected;
    final parts = _times[routine]![index].split(':');
    final value = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1])),
      initialEntryMode: TimePickerEntryMode.input,
      helpText: 'Reading ${index + 1} · Mauritius',
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (!mounted || value == null || _saving) return;
    setState(() {
      _times[routine]![index] = '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
      _locallyEdited = true;
      _feedback = null;
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }

  Future<void> _save() async {
    if (widget.onSave == null || widget.unavailableReason != null) return;
    final error = wellnessRoutineTimeError(_selected, _times[_selected]!);
    if (error != null) {
      setState(() => _feedback = error);
      return;
    }
    final selection = WellnessRoutineSelection(routine: _selected, times: _times[_selected]!);
    setState(() {
      _saving = true;
      _feedback = null;
    });
    try {
      await widget.onSave!(selection);
      if (mounted) {
        setState(
          () =>
              _feedback = 'Choice saved. Waiting for the gateway to apply it.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _feedback =
              'Could not save the routine. Check your connection and preview access.',
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final nextCheck = wellnessRoutineNextCheck(widget.status, now);
    final lastResult = wellnessRoutineLastResult(widget.status, now);
    final timeError = wellnessRoutineTimeError(_selected, _times[_selected]!);
    final editable = !_saving && widget.onSave != null && widget.unavailableReason == null;
    return WellnessSurface(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          WellnessHeading(
            title: 'Automatic readings',
            subtitle: widget.onSave == null
                ? 'Manual, Gentle or Balanced'
                : 'Private watch trial',
          ),
          const SizedBox(height: 12),
          Text(
            widget.unavailableReason ??
                wellnessRoutineMessage(widget.status, now),
          ),
          if (widget.unavailableReason == null && nextCheck != null) ...[
            const SizedBox(height: 8),
            Text(nextCheck, style: Theme.of(context).textTheme.titleSmall),
          ],
          if (widget.unavailableReason == null && lastResult != null) ...[
            const SizedBox(height: 8),
            Text(lastResult),
          ],
          const SizedBox(height: 16),
          for (final option in wellnessRoutines.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: OutlinedButton(
                onPressed: !editable ? null : () => setState(() {
                  _selected = option.key;
                  _locallyEdited = true;
                  _feedback = null;
                }),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      Icon(
                        _selected == option.key
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(option.value.$1),
                            Text(option.value.$2),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          if (_selected != 'manual') ...[
            const SizedBox(height: 8),
            Text('Times in Mauritius', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var index = 0; index < _times[_selected]!.length; index++)
                  Semantics(
                    label: 'Reading ${index + 1}, Mauritius time',
                    child: OutlinedButton.icon(
                      key: ValueKey('routine-time-$index'),
                      onPressed: editable ? () => _pickTime(index) : null,
                      icon: const Icon(Icons.schedule, size: 20),
                      label: Text(_times[_selected]![index]),
                    ),
                  ),
              ],
            ),
            if (timeError != null) ...[
              const SizedBox(height: 8),
              Text(timeError, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
          const SizedBox(height: 12),
          const Text(
            'At each time, Guardian checks for usable heart, blood-pressure and oxygen readings before requesting skin temperature. If the watch is unavailable, that check is skipped. Steps continue independently.',
          ),
          const SizedBox(height: 16),
          if (widget.onSave != null)
            FilledButton(
              onPressed: !editable || timeError != null
                  ? null
                  : _save,
              child: Text(_saving ? 'Saving…' : 'Apply routine'),
            ),
          if (_feedback != null) ...[
            const SizedBox(height: 12),
            Text(_feedback!),
          ],
        ],
      ),
    );
  }
}
