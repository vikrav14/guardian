import 'package:flutter/material.dart';

import '../services/watch_calls_service.dart';
import 'cards/guardian_card.dart';

String emergencyCallStatus(Map<String, dynamic>? settings, DateTime now) {
  final expiry = watchCallDate(settings?['windowEndsAt']);
  switch (settings?['status']) {
    case 'restoration_pending':
      return 'Returning to Manual. Auto may remain on until the watch reconnects and replies.';
    case 'preparing':
      return 'Requesting handsfree answering for the primary contact. You can still call normally.';
    case 'auto_replied':
      if (expiry == null || !expiry.isAfter(now)) {
        return 'Callback window ended. Waiting for the watch to reply to Manual; Auto may still be on.';
      }
      final seconds = expiry.difference(now).inSeconds;
      return 'Watch replied to Auto. Returning to Manual in ${seconds ~/ 60}m ${seconds % 60}s. Call to check the wearer.';
    case 'manual_replied':
      if (settings?['ready'] == false) {
        return 'Watch replied to Manual. Emergency answering is paused; review the primary contact, service and call setup.';
      }
      return 'Watch replied to Manual. Ready for the next SOS or fall. Make a test call to confirm normal answering.';
    case 'disabled':
      return 'Emergency answering is off.';
    default:
      return 'Emergency answering is not set up for this watch yet.';
  }
}

class WatchEmergencyCallsCard extends StatefulWidget {
  const WatchEmergencyCallsCard({super.key, required this.imei, required this.service, required this.familyAccess});
  final String imei;
  final WatchCallsService service;
  final bool familyAccess;

  @override
  State<WatchEmergencyCallsCard> createState() => _WatchEmergencyCallsCardState();
}

class _WatchEmergencyCallsCardState extends State<WatchEmergencyCallsCard> {
  late final Stream<Map<String, dynamic>?> _settings;
  late final Stream<Map<String, dynamic>?> _requests;
  bool _saving = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _settings = widget.service.watchEmergencySettings(widget.imei);
    _requests = widget.service.watchEmergencyRequest(widget.imei);
  }

  Future<void> _change(Map<String, dynamic> settings, bool enabled) async {
    if (enabled) {
      final agreed = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
        scrollable: true,
        title: const Text('Allow emergency handsfree calls?'),
        content: Text('${settings['callerHint'] ?? 'Your primary contact'} can call handsfree for five minutes after '
          'a fresh SOS or fall reaches Guardian. During that time, any call from this number may auto-answer. '
          'Other approved callers should ring normally. '
          'Make sure the wearer agrees. Guardian needs a connection to turn Auto off; '
          'a lost connection can leave it on for longer.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Enable emergency answering')),
        ],
      ));
      if (agreed != true || !mounted) return;
    }
    setState(() { _saving = true; _error = null; });
    try {
      await widget.service.requestEmergency(widget.imei, enabled: enabled,
        revision: settings['revision'] as String, consentAccepted: enabled);
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not confirm the change. Check the status before trying again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<Map<String, dynamic>?>(stream: _settings, builder: (context, snapshot) {
    final settings = snapshot.data;
    final enabled = settings?['enabled'] == true;
    final canManage = !snapshot.hasError && settings?['configured'] == true &&
      settings?['managerUid'] == widget.service.currentUid && settings?['revision'] is String;
    return StreamBuilder<Map<String, dynamic>?>(stream: _requests, builder: (context, requestSnapshot) {
      final request = requestSnapshot.data;
      final expiry = watchCallDate(request?['expiresAt']);
      final pending = request?['status'] == 'pending' && expiry != null && expiry.isAfter(DateTime.now());
      return GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Handsfree after SOS or fall', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        const Text('Normal calls use Manual. After an SOS or fall, the primary contact gets a five-minute handsfree callback window.'),
        if (settings?['callerHint'] is String) ...[const SizedBox(height: 8), Text(settings!['callerHint'] as String)],
        const SizedBox(height: 8),
        Text(snapshot.hasError ? 'Emergency call status is unavailable.' : emergencyCallStatus(settings, DateTime.now())),
        if (settings?['reason'] == 'primary_contact_mismatch' || settings?['reason'] == 'call_settings_changed') ...[
          const SizedBox(height: 8),
          const Text('The primary contact and the configured callback number must match. Update call setup before enabling another window.'),
        ],
        if (requestSnapshot.hasError) const Text('Preference request status is unavailable.'),
        if (request?['status'] == 'not_applied') const Text('The preference was not applied. Check your primary contact, service and call setup.'),
        if (request?['status'] == 'pending') Text(pending ? 'Saving preference…' : 'Preference request expired. Review the status before trying again.'),
        const SizedBox(height: 12),
        FilledButton.tonal(
          onPressed: !canManage || _saving || pending || (!enabled && !widget.familyAccess)
            ? null : () => _change(settings!, !enabled),
          child: Text(enabled ? 'Turn off emergency answering' : 'Set up emergency answering'),
        ),
        const SizedBox(height: 8),
        const Text('Guardian restores Manual when the window ends. If the watch is offline, restoration stays pending until it can reply.'),
        if (_error != null) ...[const SizedBox(height: 8), Text(_error!)],
      ]));
    });
  });
}
