import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/contacts_service.dart';
import '../services/watch_phonebook_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

class ContactsPage extends StatefulWidget {
  const ContactsPage({super.key, this.imei, this.wearerName, this.service});
  final String? imei;
  final String? wearerName;
  final ContactsService? service;
  @override
  State<ContactsPage> createState() => _ContactsPageState();
}

class _ContactsPageState extends State<ContactsPage> {
  late final ContactsService _service;
  late final Stream<Map<String, dynamic>> _profile;
  late final Stream<List<({String imei, String name})>> _watches;
  String? _selected;
  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ContactsService();
    _profile = _service.watchProfile();
    _watches = widget.imei == null ? _service.watchWatches()
        : Stream.value([(imei: widget.imei!, name: widget.wearerName ?? 'Watch')]);
    _selected = widget.imei;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: context.guardianColors.canvas,
    appBar: AppBar(title: const Text('Contacts')),
    body: SafeArea(child: StreamBuilder<Map<String, dynamic>>(
      stream: _profile, builder: (context, profile) {
        if (profile.hasError) return const Center(child: Text('Could not load contacts. Check your connection and access.'));
        if (!profile.hasData) return const Center(child: CircularProgressIndicator());
        return StreamBuilder<List<({String imei, String name})>>(
          stream: _watches, builder: (context, watches) {
            if (watches.hasError) return const Center(child: Text('Could not load your watches. Try again when connected.'));
            if (!watches.hasData) return const Center(child: CircularProgressIndicator());
            final devices = watches.data!;
            final matches = devices.where((watch) => watch.imei == _selected);
            final selected = matches.isNotEmpty ? matches.first : devices.firstOrNull;
            return SingleChildScrollView(padding: const EdgeInsets.all(20), child: GuardianPageFrame(
              maxWidth: 760, child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Text('Your people, in one place', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 8),
                const Text('Choose who receives safety alerts and who can call the watch. Each person appears once.'),
                const SizedBox(height: 16),
                if (devices.length > 1) DropdownButtonFormField<String>(
                  initialValue: selected?.imei,
                  decoration: const InputDecoration(labelText: 'Call access for'),
                  items: devices.map((watch) => DropdownMenuItem(value: watch.imei, child: Text(watch.name))).toList(),
                  onChanged: (value) => setState(() => _selected = value)),
                if (selected != null) Padding(padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text('Call access: ${selected.name}. Safety alert choices apply to watches linked to your account.')),
                _ContactsBody(key: ValueKey(selected?.imei), imei: selected?.imei, wearer: selected?.name ?? 'the watch',
                  service: _service, profile: profile.data!),
                const SizedBox(height: 20),
                const _EmergencyServices(),
              ]),
            ));
          },
        );
      },
    )),
  );
}

class _ContactsBody extends StatefulWidget {
  const _ContactsBody({super.key, required this.imei, required this.wearer,
    required this.service, required this.profile});
  final String? imei;
  final String wearer;
  final ContactsService service;
  final Map<String, dynamic> profile;
  @override
  State<_ContactsBody> createState() => _ContactsBodyState();
}

class _ContactsBodyState extends State<_ContactsBody> {
  late final Stream<Map<String, dynamic>?> _settings;
  late final Stream<Map<String, dynamic>?> _requests;
  Timer? _timer;
  bool _saving = false;
  @override
  void initState() {
    super.initState();
    _settings = widget.imei == null ? Stream.value(null) : widget.service.phonebook.watchSettings(widget.imei!);
    _requests = widget.imei == null ? Stream.value(null) : widget.service.phonebook.watchLatestRequest(widget.imei!);
    _timer = Timer.periodic(const Duration(seconds: 2), (_) { if (mounted) setState(() {}); });
  }
  @override
  void dispose() { _timer?.cancel(); super.dispose(); }

  Future<void> _save(ContactEntry entry, {required bool alerts, bool primary = false}) async {
    setState(() => _saving = true);
    try {
      await widget.service.saveContact(name: entry.name, phone: entry.phone, whatsapp: entry.whatsapp,
        receivesAlerts: alerts, makePrimary: primary);
    } catch (_) { _error(); }
    finally { if (mounted) setState(() => _saving = false); }
  }

  void _error() {
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:
        Text('Save could not be confirmed. Check the contact and request status before trying again.')));
    }
  }

  Future<void> _edit(Map<String, dynamic>? settings, List<ContactEntry> entries,
      {ContactEntry? entry, bool requestCall = false}) async {
    final name = TextEditingController(text: requestCall
        ? entry?.watch?['name'] as String? ?? entry?.name ?? '' : entry?.name ?? '');
    final phone = TextEditingController(text: entry?.phone ?? '+230');
    final whatsapp = TextEditingController(text: entry?.whatsapp ?? '');
    var alerts = entry?.receivesAlerts ?? true;
    var allowCalls = requestCall;
    final canManage = settings?['configured'] == true && settings?['managerUid'] == widget.service.currentUid;
    final canRequest = canManage && (entry?.watch?['status'] == 'not_sent' ||
        (entry?.watch == null && (settings?['availableSlots'] as int? ?? 0) > 0));
    final form = GlobalKey<FormState>();
    final confirmed = await showDialog<bool>(context: context, builder: (dialogContext) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: Text(entry == null ? 'Add contact' : entry.name),
        content: SingleChildScrollView(child: Form(key: form, child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextFormField(controller: name, readOnly: entry?.watch != null, maxLength: allowCalls ? 20 : 80,
            decoration: const InputDecoration(labelText: 'Name'),
            validator: (value) => value == null || value.trim().isEmpty || value.trim().length > (allowCalls ? 20 : 80) ? 'Enter a shorter contact name.' : null),
          TextFormField(controller: phone, readOnly: entry != null, keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Phone number', helperText: 'Include the country code, starting with +'),
            validator: (value) {
              try { normalizeWatchContactPhone(contactKey(value ?? '')); } catch (_) { return 'Enter a valid international number.'; }
              if (entry == null && entries.any((row) => contactKey(row.phone) == contactKey(value!))) return 'This number is already in Contacts.';
              return null;
            }),
          CheckboxListTile(contentPadding: EdgeInsets.zero, title: const Text('Receive safety alerts'),
            subtitle: const Text('Guardian’s emergency notifications'), value: alerts,
            onChanged: (value) => update(() => alerts = value == true)),
          if (alerts) TextFormField(controller: whatsapp, keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'WhatsApp number (if different)'),
            validator: (value) {
              if (value == null || value.trim().isEmpty) return null;
              try { normalizeWatchContactPhone(contactKey(value)); return null; } catch (_) { return 'Enter a valid international number.'; }
            }),
          if (entry?.watch == null || entry?.watch?['status'] == 'not_sent') CheckboxListTile(
            contentPadding: EdgeInsets.zero, title: Text('Call ${widget.wearer}'),
            subtitle: Text(canRequest ? 'Add this number to the watch. Auto-answer is configured separately.'
                : 'Call access needs watch setup, available space and the designated contact manager.'),
            value: allowCalls, onChanged: canRequest ? (value) => update(() => allowCalls = value == true) : null),
          if (allowCalls) const Text('Removing a number from the watch is not available in Guardian yet. The watch must be connected for this addition.'),
          if (entry?.watch != null && entry?.watch?['status'] != 'not_sent') const Text('Call access is already recorded. Turning alerts off leaves watch access unchanged. Removal from the watch is not available yet.'),
        ]))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('Cancel')),
          FilledButton(onPressed: () { if (form.currentState!.validate()) Navigator.pop(dialogContext, true); },
            child: Text(allowCalls ? 'Save and send to watch' : 'Save contact')),
        ],
      ),
    ));
    final label = name.text, number = phone.text, wa = whatsapp.text;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    name.dispose(); phone.dispose(); whatsapp.dispose();
    if (confirmed != true || !mounted) return;
    setState(() => _saving = true);
    try {
      await widget.service.saveContact(name: label, phone: number, whatsapp: wa, receivesAlerts: alerts,
        callImei: allowCalls ? widget.imei : null,
        policyRevision: allowCalls ? settings?['policyRevision'] as String? : null);
    } catch (_) { _error(); }
    finally { if (mounted) setState(() => _saving = false); }
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<Map<String, dynamic>?>(
    stream: _settings, builder: (context, snapshot) {
      final settings = snapshot.data;
      final contacts = mergeContacts(widget.profile, settings);
      final canManage = !snapshot.hasError && settings?['configured'] == true && settings?['managerUid'] == widget.service.currentUid;
      return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (snapshot.hasError) const Text('Call access status is unavailable. Alert contacts are still shown.'),
        if (widget.imei != null && !snapshot.hasError && snapshot.connectionState != ConnectionState.waiting && settings?['configured'] != true)
          const Padding(padding: EdgeInsets.only(bottom: 12), child: Text('The watch supports up to 15 family numbers. Its existing contacts need a one-time setup before call access can be added here. Alert contacts can be managed now.')),
        StreamBuilder<Map<String, dynamic>?>(stream: _requests, builder: (context, request) {
          if (request.hasError) return const Text('Latest call access request is unavailable. Check before sending another.');
          if (request.data == null) return const SizedBox.shrink();
          return Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(
            'Latest call access request: ${watchContactMessage(request.data!, DateTime.now())}', key: const Key('contact-request-status')));
        }),
        for (final entry in contacts) Padding(padding: const EdgeInsets.only(bottom: 14), child: GuardianCard(
          key: ValueKey('contact-${contactKey(entry.phone)}'),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(entry.name, style: Theme.of(context).textTheme.titleMedium),
            Text(entry.phone),
            if (entry.primary && entry.receivesAlerts) const Padding(padding: EdgeInsets.only(top: 4), child: Text('Primary alert recipient')),
            SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('Receive safety alerts'),
              value: entry.receivesAlerts, onChanged: _saving ? null : (value) => _save(entry, alerts: value)),
            const Divider(),
            Text('Call ${widget.wearer}', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(entry.watch == null ? 'Not added to this watch.' : watchContactMessage(entry.watch!, DateTime.now())),
            Wrap(spacing: 8, children: [
              if (canManage && (entry.watch?['status'] == 'not_sent' ||
                  (entry.watch == null && (settings?['availableSlots'] as int? ?? 0) > 0))) TextButton(
                onPressed: _saving ? null : () => _edit(settings, contacts, entry: entry, requestCall: true),
                child: Text(entry.watch == null ? 'Allow calls' : 'Retry call access')),
              TextButton(onPressed: _saving ? null : () => _edit(settings, contacts, entry: entry), child: const Text('Contact details')),
              if (entry.receivesAlerts && !entry.primary) TextButton(
                onPressed: _saving ? null : () => _save(entry, alerts: true, primary: true), child: const Text('Make primary alert recipient')),
            ]),
          ]),
        )),
        if (contacts.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('Add your first contact and choose how they can help.')),
        FilledButton.icon(onPressed: _saving ? null : () => _edit(settings, contacts),
          icon: const Icon(Icons.person_add_alt_1), label: Text(_saving ? 'Saving…' : 'Add contact')),
      ]);
    },
  );
}

class _EmergencyServices extends StatelessWidget {
  const _EmergencyServices();
  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return ExpansionTile(title: Text(t?.emergencyNumbersHeading ?? 'Emergency services'), children: [
      for (final contact in [(t?.emergencyPolice ?? 'Police', '999'), (t?.emergencySamu ?? 'SAMU', '114'), (t?.emergencyFire ?? 'Fire', '995')])
        ListTile(title: Text(contact.$1), trailing: Text(contact.$2), onTap: () async {
          final opened = await launchUrl(Uri(scheme: 'tel', path: contact.$2));
          if (!opened && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not open the phone dialler.')));
          }
        }),
    ]);
  }
}
