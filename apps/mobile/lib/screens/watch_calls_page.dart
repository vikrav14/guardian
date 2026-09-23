import 'dart:async';

import 'package:flutter/material.dart';

import '../services/guardian_entitlements.dart';
import '../services/watch_calls_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

class WatchCallsPage extends StatefulWidget {
  const WatchCallsPage({super.key, required this.imei, required this.wearerName,
    required this.subscription, this.service});

  final String imei;
  final String wearerName;
  final GuardianSubscription subscription;
  final WatchCallsService? service;

  @override
  State<WatchCallsPage> createState() => _WatchCallsPageState();
}

class _WatchCallsPageState extends State<WatchCallsPage> {
  late final WatchCallsService _service;
  late final Stream<Map<String, dynamic>?> _settings;
  late final Stream<Map<String, dynamic>?> _requests;
  late final Timer _clock;
  WatchAnswerMode _selected = WatchAnswerMode.manual;
  bool _saving = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? WatchCallsService();
    _settings = _service.watchSettings(widget.imei);
    _requests = _service.watchLatestRequest(widget.imei);
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock.cancel();
    super.dispose();
  }

  Future<void> _apply(Map<String, dynamic> settings) async {
    final mode = _selected;
    setState(() { _saving = true; _message = null; });
    try {
      if (mode == WatchAnswerMode.auto) {
        final consent = await showDialog<bool>(context: context, builder: (context) => AlertDialog(
          scrollable: true,
          title: const Text('Enable handsfree answering?'),
          content: const Text('The watch may answer eligible incoming calls without a tap. '
            'Make sure the wearer knows and agrees. This applies to everyday calls too, '
            'and stays on until you send Manual and check that it works. '
            'Changing the setting requires the watch to be connected.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Enable Auto')),
          ],
        ));
        if (consent != true || !mounted) return;
      }
      await _service.requestMode(widget.imei, mode,
        policyRevision: settings['policyRevision'] as String,
        consentAccepted: mode == WatchAnswerMode.auto);
    } catch (_) {
      if (mounted) setState(() => _message = 'Could not confirm the request. '
        'Check the request status and watch before trying again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final familyAccess = widget.subscription.serviceActive &&
        [GuardianPlan.family, GuardianPlan.care].contains(widget.subscription.plan);
    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(title: Text('${widget.wearerName} · Calls')),
      body: SafeArea(child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        child: GuardianPageFrame(maxWidth: 680, child: StreamBuilder<Map<String, dynamic>?>(
          stream: _settings,
          builder: (context, settingsSnapshot) {
            final settings = settingsSnapshot.data;
            final configured = !settingsSnapshot.hasError && settings?['configured'] == true &&
                settings?['policyRevision'] is String;
            final autoAvailable = configured && settings?['autoAvailable'] == true && familyAccess;
            final lease = watchCallDate(settings?['leaseUntil']);
            final changing = lease != null && lease.isAfter(DateTime.now());
            return StreamBuilder<Map<String, dynamic>?>(stream: _requests, builder: (context, requestSnapshot) {
              final request = requestSnapshot.data;
              final expiry = watchCallDate(request?['expiresAt']);
              final pending = request?['status'] == 'pending' && expiry != null && expiry.isAfter(DateTime.now());
              final busy = _saving || changing || pending;
              return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('How should the watch answer?', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                const Text('Manual is the default choice. Opening this screen does not change the watch.'),
                const SizedBox(height: 20),
                GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  for (final mode in WatchAnswerMode.values) ...[
                    Semantics(selected: _selected == mode, inMutuallyExclusiveGroup: true,
                      child: ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(_selected == mode ? Icons.radio_button_checked : Icons.radio_button_off),
                        title: Text(mode.label),
                        subtitle: Text(mode.description),
                        enabled: !busy && configured && (mode == WatchAnswerMode.manual || autoAvailable),
                        onTap: busy || !configured || (mode == WatchAnswerMode.auto && !autoAvailable)
                            ? null : () => setState(() => _selected = mode),
                      ),
                    ),
                    if (mode == WatchAnswerMode.manual) const Divider(),
                  ],
                  if (configured && settings?['callerHint'] is String) ...[
                    const SizedBox(height: 8),
                    Text(settings!['callerHint'] as String, style: TextStyle(color: colors.textSecondary)),
                  ],
                  const SizedBox(height: 12),
                  const Text('Auto is not limited to SOS situations. It does not switch off automatically.'),
                  if (!familyAccess) ...[
                    const SizedBox(height: 12),
                    const Text('Auto requires an active Family or Care service. You can still request Manual.'),
                  ],
                  if (!configured) ...[
                    const SizedBox(height: 12),
                    Text(settingsSnapshot.hasError
                        ? 'Call settings could not be loaded. Check your connection and access.'
                        : settingsSnapshot.connectionState == ConnectionState.waiting
                            ? 'Loading call settings…'
                            : 'Answer controls are not set up for this watch yet.'),
                  ],
                  const SizedBox(height: 18),
                  FilledButton.icon(
                    onPressed: busy || !configured || (_selected == WatchAnswerMode.auto && !autoAvailable)
                        ? null : () => _apply(settings!),
                    icon: const Icon(Icons.phone_in_talk_outlined),
                    label: Text(_saving ? 'Requesting…' : 'Send ${_selected.label} setting'),
                  ),
                ])),
                const SizedBox(height: 20),
                GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Request status', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(requestSnapshot.hasError
                    ? 'Request status is unavailable. Check the watch before making another change.'
                    : requestSnapshot.connectionState == ConnectionState.waiting
                        ? 'Loading request status…'
                        : watchCallRequestMessage(request, DateTime.now())),
                  if (settings?['lastHandoffMode'] == 'auto' || settings?['lastHandoffMode'] == 'manual') ...[
                    const SizedBox(height: 10),
                    Text('Last setting sent: ${settings!['lastHandoffMode'] == 'auto' ? 'Auto' : 'Manual'}. '
                      'This is not a confirmation from the watch.'),
                  ],
                  if (_message != null) ...[const SizedBox(height: 10), Text(_message!)],
                ])),
              ]);
            });
          },
        )),
      )),
    );
  }
}
