import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'linked_wellness_stream.dart';
import 'wellness_card.dart';
import 'wellness_pilot_access.dart';

const wellnessRoutines = <String, (String, String)>{
  'manual': ('Manual', 'Automatic readings off'),
  'gentle': ('Gentle rhythm', 'Every 12 hours · about twice daily'),
  'balanced': ('Balanced rhythm', 'Every 8 hours · about three times daily'),
};

String wellnessRoutineMessage(Map<String, dynamic> status, DateTime now) {
  final updated = status['updatedAt'];
  if (updated is! Timestamp ||
      updated.toDate().isAfter(now) ||
      now.difference(updated.toDate()) > const Duration(minutes: 2)) {
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
    'routine_pilot_disabled' => 'Automatic readings are not enabled on this gateway.',
    'access_or_consent_unavailable' => 'Paused · current access and wearer consent are required.',
    'watch_offline' => 'Waiting for the watch to connect.',
    'temperature_mode_unconfirmed' => 'Waiting to confirm this watch supports automatic temperature.',
    'watch_removed' => 'Paused · watch removed.',
    'wearing_unconfirmed' => 'Paused · wearing status is unconfirmed.',
    'previous_handoff_failed' => 'The previous change could not be completed. Review the watch before trying again.',
    'no_routine_selected' => 'Choose a routine below.',
    _ => switch (status['phase']) {
      'sending' => 'Sending settings to the watch…',
      'awaiting_readings' => 'Schedule commands sent · automatic readings are not yet verified.',
      'handoff_failed' => 'The change may be incomplete. Guardian will attempt to stop both cycles.',
      _ => 'Waiting for confirmation from the gateway.',
    },
  };
}

class WellnessRoutinePage extends StatelessWidget {
  const WellnessRoutinePage({super.key, required this.imei});
  final String imei;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Wellness routine')),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: WellnessPilotAccess(
        imei: imei,
        child: _ConnectedRoutine(imei: imei),
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
  late final Stream<List<Map<String, dynamic>>> _status = watchLinkedWellnessData(
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
  @override
  Widget build(BuildContext context) => StreamBuilder<List<Map<String, dynamic>>>(
    stream: _status,
    builder: (context, snapshot) => WellnessRoutineControls(
      status: snapshot.hasError ? const {} : snapshot.data?.firstOrNull ?? const {},
      onSave: (routine) async {
        final uid = FirebaseAuth.instance.currentUser?.uid;
        if (uid == null) throw StateError('Sign in again.');
        await FirebaseFirestore.instance
            .collection('wellnessRoutineRequests')
            .doc(widget.imei)
            .set({
              'version': 1,
              'routine': routine,
              'requestedBy': uid,
              'updatedAt': FieldValue.serverTimestamp(),
            });
      },
    ),
  );
}

class WellnessRoutineControls extends StatefulWidget {
  const WellnessRoutineControls({super.key, required this.status, required this.onSave});
  final Map<String, dynamic> status;
  final Future<void> Function(String) onSave;
  @override
  State<WellnessRoutineControls> createState() => _WellnessRoutineControlsState();
}

class _WellnessRoutineControlsState extends State<WellnessRoutineControls> {
  String? _selected, _feedback;
  bool _saving = false;
  late final Timer _timer;
  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) {
      if (mounted) setState(() {});
    });
  }
  @override
  void dispose() {
    _timer.cancel();
    super.dispose();
  }
  Future<void> _save() async {
    setState(() { _saving = true; _feedback = null; });
    try {
      await widget.onSave(_selected ?? widget.status['routine'] as String? ?? 'manual');
      if (mounted) setState(() => _feedback = 'Choice saved. Waiting for the gateway to apply it.');
    } catch (_) {
      if (mounted) setState(() => _feedback = 'Could not save the routine. Check your connection and preview access.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
  @override
  Widget build(BuildContext context) => WellnessSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const WellnessHeading(title: 'Automatic readings', subtitle: 'Private watch trial'),
        const SizedBox(height: 12),
        Text(wellnessRoutineMessage(widget.status, DateTime.now())),
        const SizedBox(height: 16),
        for (final option in wellnessRoutines.entries)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: OutlinedButton(
              onPressed: _saving ? null : () => setState(() => _selected = option.key),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Row(children: [
                  Icon((_selected ?? widget.status['routine'] ?? 'manual') == option.key
                      ? Icons.radio_button_checked : Icons.radio_button_off),
                  const SizedBox(width: 12),
                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(option.value.$1), Text(option.value.$2),
                  ])),
                ]),
              ),
            ),
          ),
        const SizedBox(height: 8),
        const Text('Covers heart rate, blood-pressure estimates, blood oxygen and skin temperature when supported. Intervals can include overnight readings.'),
        const SizedBox(height: 8),
        const Text('Automatic start requires confirmed wearing and temperature support. If the watch disconnects, an existing schedule may continue until a stop reaches it. Steps continue independently.'),
        const SizedBox(height: 16),
        FilledButton(onPressed: _saving ? null : _save,
          child: Text(_saving ? 'Saving…' : 'Apply routine')),
        if (_feedback != null) ...[const SizedBox(height: 12), Text(_feedback!)],
      ],
    ),
  );
}
