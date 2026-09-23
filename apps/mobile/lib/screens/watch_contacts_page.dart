import 'dart:async';

import 'package:flutter/material.dart';

import '../services/watch_phonebook_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

class WatchContactsPage extends StatefulWidget {
  const WatchContactsPage({super.key, required this.imei, required this.wearerName, this.service});
  final String imei;
  final String wearerName;
  final WatchPhonebookService? service;
  @override
  State<WatchContactsPage> createState() => _WatchContactsPageState();
}

class _WatchContactsPageState extends State<WatchContactsPage> {
  late final WatchPhonebookService _service;
  late final Stream<Map<String, dynamic>?> _settings;
  late final Stream<Map<String, dynamic>?> _requests;
  Timer? _timer;
  bool _submitting = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? WatchPhonebookService();
    _settings = _service.watchSettings(widget.imei);
    _requests = _service.watchLatestRequest(widget.imei);
    _timer = Timer.periodic(const Duration(seconds: 2), (_) { if (mounted) setState(() {}); });
  }
  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  Future<void> _add(Map<String, dynamic> settings, {Map<String, dynamic>? retry}) async {
    final name = TextEditingController(text: retry?['name'] as String? ?? '');
    final phone = TextEditingController(text: retry?['phone'] as String? ?? '+230');
    final form = GlobalKey<FormState>();
    final approved = await showDialog<bool>(context: context, builder: (dialogContext) => AlertDialog(
      title: Text(retry == null ? 'Add watch contact' : 'Retry contact addition'),
      content: SingleChildScrollView(child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Text('This person will be able to ring the watch. This does not subscribe them to alerts or enable Auto-answer. Removal from the watch is not available in Guardian yet.'),
        const SizedBox(height: 16),
        TextFormField(controller: name, readOnly: retry != null, maxLength: 20,
          decoration: const InputDecoration(labelText: 'Name'),
          validator: (value) => value == null || value.trim().isEmpty ? 'Enter a name.' : null),
        TextFormField(controller: phone, readOnly: retry != null, keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Phone number', helperText: 'Include the country code, starting with +'),
          validator: (value) { try { normalizeWatchContactPhone(value ?? ''); return null; } catch (_) { return 'Enter a valid international number.'; } }),
      ]))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
        FilledButton(onPressed: () { if (form.currentState!.validate()) Navigator.pop(dialogContext, true); }, child: const Text('Send to watch')),
      ],
    ));
    final contactName = name.text, contactPhone = phone.text;
    // Dialog animation may still reference its controllers; dispose after it.
    await Future<void>.delayed(const Duration(milliseconds: 300));
    name.dispose(); phone.dispose();
    if (approved != true || !mounted) return;
    setState(() => _submitting = true);
    try {
      await _service.addContact(widget.imei, name: contactName, phone: contactPhone,
        policyRevision: settings['policyRevision'] as String);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:
        Text('Could not confirm the request. Check the latest status before trying again.')));
    } finally { if (mounted) setState(() => _submitting = false); }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(title: Text('${widget.wearerName} · Watch contacts')),
      body: SafeArea(child: SingleChildScrollView(padding: const EdgeInsets.all(20),
        child: GuardianPageFrame(maxWidth: 760, child: StreamBuilder<Map<String, dynamic>?>(
          stream: _settings, builder: (context, snapshot) {
            if (snapshot.hasError) return const Text('Could not load watch contacts. Check your connection and access.');
            if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
            final settings = snapshot.data;
            final configured = settings?['configured'] == true;
            final canManage = configured && settings?['managerUid'] == _service.currentUid;
            final rows = (settings?['contacts'] as List? ?? []).map((row) => Map<String, dynamic>.from(row as Map)).toList();
            return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              GuardianCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Who can ring the watch?', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                const Text('Add approved callers to this watch’s phonebook. Emergency notification contacts are managed separately.'),
                const SizedBox(height: 12),
                const Text('Editing or removing watch contacts is not available yet. Changing a notification contact does not remove their number from the watch.'),
              ])),
              const SizedBox(height: 16),
              if (!configured) const Text('Watch contacts need a one-time setup. Support must check existing entries and available space before additions are enabled.'),
              if (configured && !canManage) const Text('Only the designated contact manager can add callers. You can view their status here.'),
              StreamBuilder<Map<String, dynamic>?>(stream: _requests, builder: (context, request) {
                if (request.hasError) return const Text('Latest request status is unavailable. Check before sending another request.');
                if (request.data == null) return const SizedBox.shrink();
                return Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Text(
                  'Latest request: ${watchContactMessage(request.data!, DateTime.now())}', key: const Key('contact-request-status')));
              }),
              for (final row in rows) Padding(padding: const EdgeInsets.only(bottom: 12), child: GuardianCard(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(row['name'] as String, style: Theme.of(context).textTheme.titleMedium),
                  Text(row['phone'] as String),
                  const SizedBox(height: 8),
                  Text(watchContactMessage(row, DateTime.now())),
                  if (canManage && row['status'] == 'not_sent') TextButton(
                    onPressed: _submitting ? null : () => _add(settings!, retry: row), child: const Text('Retry addition')),
                ]),
              )),
              if (configured && rows.isEmpty) const Padding(padding: EdgeInsets.only(bottom: 16), child: Text('No watch contacts recorded yet.')),
              if (canManage) FilledButton.icon(
                onPressed: _submitting || (settings?['availableSlots'] as int? ?? 0) == 0 ? null : () => _add(settings!),
                icon: const Icon(Icons.person_add_alt_1), label: Text(_submitting ? 'Requesting…' : 'Add watch contact')),
              if (canManage && (settings?['availableSlots'] as int? ?? 0) == 0) const Padding(
                padding: EdgeInsets.only(top: 8), child: Text('No verified contact space remains. Contact support to review the watch.')),
            ]);
          },
        )),
      )),
    );
  }
}
