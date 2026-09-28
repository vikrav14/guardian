import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

import '../services/guardian_entitlements.dart';
import '../services/movement_reminders_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

class MovementRemindersPage extends StatefulWidget {
  const MovementRemindersPage({
    super.key,
    required this.imei,
    required this.name,
    required this.subscription,
    this.client,
    this.pilotImei = guardianMovementReminderPilotImei,
  });
  final String imei;
  final String name;
  final GuardianSubscription subscription;
  final MovementReminderClient? client;
  final String pilotImei;

  @override
  State<MovementRemindersPage> createState() => _MovementRemindersPageState();
}

class _MovementRemindersPageState extends State<MovementRemindersPage> {
  MovementReminderClient? _client;
  MovementState? _state;
  bool _busy = false;
  bool _refreshRequired = false;
  bool _enabled = false;
  String _start = '08:00';
  String _end = '20:00';
  String? _error;

  bool get _allowed => canUseMovementPilot(
    widget.subscription,
    widget.imei,
    pilotImei: widget.pilotImei,
  );

  @override
  void initState() {
    super.initState();
    if (_allowed) {
      _client = widget.client ?? MovementRemindersService();
      _load();
    }
  }

  @override
  void dispose() {
    if (widget.client == null && _client is MovementRemindersService) {
      (_client as MovementRemindersService).close();
    }
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy || !_allowed) return;
    setState(() { _busy = true; _error = null; });
    try {
      final state = await _client!.load(widget.imei);
      if (!mounted) return;
      setState(() {
        _state = state;
        _refreshRequired = false;
        // This is the last request, never a readback of the physical watch.
        _enabled = state.desired?.enabled ?? false;
        _start = state.desired?.start ?? '08:00';
        _end = state.desired?.end ?? '20:00';
      });
    } catch (error) {
      if (mounted) setState(() { _error = _message(error); _refreshRequired = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _message(Object error) {
    final code = error is MovementRequestException ? error.code : '';
    return switch (code) {
      'sign_in_required' => 'Sign in again, then refresh.',
      'pilot_not_available' => 'This account and watch are not enabled for the supervised trial.',
      'device_not_linked' || 'active_service_required' => 'Access changed. Check the linked watch and service, then refresh.',
      'gateway_not_configured' => 'The gateway address is missing or invalid. Restart the app with its current address.',
      'settings_changed' || 'change_in_progress' => 'Another change was made. Refresh before saving again.',
      'turn_off_before_retry' => 'The previous change is unconfirmed. Refresh, then send Off and check the watch.',
      _ => 'The result could not be confirmed. Refresh to check the last request before sending anything else.',
    };
  }

  Future<void> _save() async {
    if (_busy || _refreshRequired || _state == null || !_allowed) return;
    final settings = MovementSettings(enabled: _enabled, start: _start, end: _end);
    setState(() { _busy = true; _error = null; });
    try {
      final result = await _client!.save(widget.imei,
        requestId: const Uuid().v4(), expectedVersion: _state!.version, settings: settings);
      if (mounted) setState(() => _state = result);
    } catch (error) {
      if (mounted) setState(() { _error = _message(error); _refreshRequired = true; });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  int _minutes(String clock) {
    final parts = clock.split(':').map(int.parse).toList();
    return parts[0] * 60 + parts[1];
  }

  Future<void> _pickTime(bool start) async {
    final minutes = _minutes(start ? _start : _end);
    final value = await showTimePicker(context: context,
      initialTime: TimeOfDay(hour: minutes ~/ 60, minute: minutes % 60),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true), child: child!),
    );
    if (value == null || !mounted) return;
    final clock = '${value.hour.toString().padLeft(2, '0')}:${value.minute.toString().padLeft(2, '0')}';
    final from = start ? clock : _start;
    final until = start ? _end : clock;
    if (_minutes(until) - _minutes(from) < 25) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('Choose one daytime window of at least 25 minutes. Overnight windows are not supported.'),
      ));
      return;
    }
    setState(() { _start = from; _end = until; });
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final status = switch (state?.status) {
      'sending' => 'Sending settings…',
      'replies_observed' => 'Watch replied — check the watch',
      'unconfirmed' => 'Change unconfirmed',
      'not_sent' => 'Not sent',
      _ => 'Not checked',
    };
    final awaiting = state?.status == 'sending';
    final requiresOff = state?.status == 'unconfirmed';
    final alreadyRequested = state?.status == 'replies_observed' &&
        state?.desired?.enabled == _enabled &&
        (!_enabled || (state?.desired?.start == _start && state?.desired?.end == _end));
    final canSave = !_busy && !_refreshRequired && state != null &&
        state.connected && !awaiting && !alreadyRequested && (!requiresOff || !_enabled);
    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      appBar: AppBar(title: const Text('Movement reminders')),
      body: !_allowed ? const Center(child: Text('Movement reminders are not available yet.'))
        : SafeArea(child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: GuardianPageFrame(maxWidth: 640, child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Align(alignment: Alignment.centerLeft, child: Chip(label: Text('Supervised trial'))),
              Text('A gentle nudge to move', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text('Movement reminders for ${widget.name}.'),
              const SizedBox(height: 8),
              const Text('Save sends these settings to the watch. Check its menu and observe the reminder during this trial.'),
              const SizedBox(height: 20),
              GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                SwitchListTile.adaptive(
                  key: const ValueKey('movement-switch'), contentPadding: EdgeInsets.zero,
                  title: const Text('Movement reminder'),
                  subtitle: Text(_enabled ? 'Selected: On' : 'Selected: Off'),
                  value: _enabled, onChanged: _busy || awaiting ? null : (value) => setState(() => _enabled = value),
                ),
                const Divider(height: 24),
                const Text('20-minute inactivity interval', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 16),
                const Text('Active hours · Mauritius time'),
                const SizedBox(height: 8),
                Wrap(spacing: 12, runSpacing: 8, children: [
                  OutlinedButton(onPressed: _busy || awaiting ? null : () => _pickTime(true), child: Text('From $_start')),
                  OutlinedButton(onPressed: _busy || awaiting ? null : () => _pickTime(false), child: Text('Until $_end')),
                ]),
                const SizedBox(height: 8),
                const Text('Check that the watch clock matches Mauritius time. Off keeps the saved active hours.'),
              ])),
              const SizedBox(height: 16),
              GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Last request', style: TextStyle(fontWeight: FontWeight.w700)),
                const SizedBox(height: 6), Text(status),
                if (state?.desired != null) Text('Requested: ${state!.desired!.enabled ? 'On' : 'Off'}'),
                const SizedBox(height: 8),
                const Text('The watch setting and reminder behaviour are not automatically verified.'),
                if (state != null && !state.connected) const Text('Watch connection unavailable. No change will be queued.'),
                if (requiresOff) const Text('Some settings may have reached the watch. Select Off, save, and check its menu before another On attempt.'),
                if (state?.reason == 'reply_timeout') const Text('The watch did not reply to every step. Guardian stopped without retrying.'),
                if (awaiting) const Text('Refresh to check progress. Nothing is resent.'),
              ])),
              if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!)),
              const SizedBox(height: 20),
              FilledButton(onPressed: canSave ? _save : null, child: Text(_busy ? 'Please wait…' : 'Save to watch')),
              TextButton(onPressed: _busy ? null : _load, child: const Text('Refresh status')),
            ],
          )),
        )),
    );
  }
}
