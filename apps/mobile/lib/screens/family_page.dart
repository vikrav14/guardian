import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../services/family_sharing_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

class FamilyPage extends StatefulWidget {
  const FamilyPage({super.key, this.client});
  final FamilySharingClient? client;
  @override
  State<FamilyPage> createState() => _FamilyPageState();
}

class _FamilyPageState extends State<FamilyPage> {
  late final FamilySharingClient _client;
  FamilySharingSnapshot? _data;
  Object? _error;
  String? _imei;
  int _section = 0;
  bool _busy = false, _loading = true;
  @override
  void initState() {
    super.initState();
    _client = widget.client ?? FamilySharingService();
    _load();
  }

  @override
  void dispose() {
    if (widget.client == null) _client.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final value = await _client.load();
      if (!mounted) return;
      setState(() {
        _data = value;
        _error = null;
        _loading = false;
        if (!value.circles.any((c) => c.imei == _imei)) {
          _imei = value.circles.firstOrNull?.imei;
        }
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = error;
          _loading = false;
        });
      }
    }
  }

  void _message(String message) {
    if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _change(
    String action,
    Map<String, dynamic> value, {
    String? imei,
    bool showCode = false,
  }) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final result = await _client.change(action, value, imei: imei);
      await _load();
      if (!mounted) return;
      if (showCode) {
        setState(() => _busy = false);
        final code = result['code'] as String;
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(
              action == 'link' ? 'Link your WhatsApp' : 'Personal invitation',
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    action == 'link'
                        ? 'Send this exact message from your own WhatsApp number to Guardian within 10 minutes. Then refresh this page.'
                        : 'Share this code privately with the invited person. They must sign in with the email you selected and accept it in Family. The code expires in 7 days.',
                  ),
                  const SizedBox(height: 16),
                  Semantics(
                    label: code,
                    child: ExcludeSemantics(child: SelectableText(code)),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: code));
                  _message('Code copied');
                },
                child: const Text('Copy code'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('Done'),
              ),
            ],
          ),
        );
      } else {
        _message(action == 'accept' ? 'Invitation accepted' : 'Saved');
      }
    } catch (error) {
      _message(error.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _join() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Accept a personal invitation'),
        content: TextField(
          controller: controller,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'Invitation code',
            helperText: 'Use the account email the owner invited.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Accept'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (code != null && code.isNotEmpty) {
      await _change('accept', {'code': code});
    }
  }

  Future<void> _edit(
    FamilyCircle circle, [
    Map<String, dynamic>? member,
  ]) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (_) => _AccessDialog(member: member, wearer: circle.name),
    );
    if (result != null) {
      await _change(
        member == null ? 'invite' : 'member',
        {
          ...result,
          if (member != null) 'action': 'permissions',
          if (member != null) 'uid': member['uid'],
        },
        imei: circle.imei,
        showCode: member == null,
      );
    }
  }

  Future<void> _revoke(FamilyCircle circle, Map<String, dynamic> member) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Remove ${member['name']}?'),
        content: Text(
          'Their access to ${circle.name} and selected WhatsApp safety messages will stop. Other wearers are unaffected.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep access'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Remove access'),
          ),
        ],
      ),
    );
    if (yes == true) {
      await _change('member', {
        'action': 'revoke',
        'uid': member['uid'],
      }, imei: circle.imei);
    }
  }

  @override
  Widget build(BuildContext context) {
    final circle = _data?.circles.where((c) => c.imei == _imei).firstOrNull;
    final owner = circle?.ownerUid == _client.uid;
    return Scaffold(
      backgroundColor: context.guardianColors.canvas,
      body: GuardianPageFrame(
        maxWidth: 760,
        child: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(20, 24, 20, 40),
            children: [
              GuardianPageHeader(
                eyebrow: 'YOUR TRUSTED CIRCLE',
                title: 'Family',
                subtitle: 'Choose who can help, and what they can see.',
                action: IconButton(
                  tooltip: 'Refresh family',
                  onPressed: _busy || _loading ? null : _load,
                  icon: const Icon(Icons.refresh),
                ),
              ),
              const SizedBox(height: 20),
              if (_loading) const Center(child: CircularProgressIndicator()),
              if (_error != null)
                GuardianCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _error is FamilySharingException
                            ? (_error as FamilySharingException).message
                            : 'Could not load your family. Check your connection and refresh.',
                      ),
                      TextButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Refresh'),
                      ),
                    ],
                  ),
                ),
              if (!_loading && _error == null && circle == null)
                const GuardianCard(
                  child: Text(
                    'Your wearer’s sharing service is not set up yet. Existing family access is unchanged. You can accept a personal invitation here.',
                  ),
                ),
              if (circle != null && _error == null) ...[
                DropdownButtonFormField<String>(
                  initialValue: circle.imei,
                  decoration: const InputDecoration(labelText: 'Access for'),
                  isExpanded: true,
                  items: _data!.circles
                      .map(
                        (c) => DropdownMenuItem(
                          value: c.imei,
                          child: Text(c.name),
                        ),
                      )
                      .toList(),
                  onChanged: _busy
                      ? null
                      : (value) => setState(() => _imei = value),
                ),
                const SizedBox(height: 16),
                if (MediaQuery.textScalerOf(context).scale(16) > 21)
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final item in [
                        (0, 'People'),
                        (1, 'WhatsApp'),
                        (2, 'Plan'),
                      ])
                        ChoiceChip(
                          label: Text(item.$2),
                          selected: _section == item.$1,
                          showCheckmark: false,
                          onSelected: (_) => setState(() => _section = item.$1),
                        ),
                    ],
                  )
                else
                  SegmentedButton<int>(
                    showSelectedIcon: false,
                    segments: const [
                      ButtonSegment(value: 0, label: Text('People')),
                      ButtonSegment(value: 1, label: Text('WhatsApp')),
                      ButtonSegment(value: 2, label: Text('Plan')),
                    ],
                    selected: {_section},
                    onSelectionChanged: (value) =>
                        setState(() => _section = value.first),
                  ),
                const SizedBox(height: 18),
                if (_section == 0) ...[
                  Text(
                    '${circle.activeMembers.length} of ${circle.limits['people']} people · owner included',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  if (circle.overLimit)
                    const GuardianCard(
                      child: Text(
                        'Your existing circle exceeds the new limit. Nobody has been removed. Review access before inviting anyone else.',
                      ),
                    ),
                  for (final member in circle.activeMembers)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: GuardianCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: CircleAvatar(
                                child: Text(
                                  (member['name'] as String? ?? '?')
                                          .characters
                                          .firstOrNull ??
                                      '?',
                                ),
                              ),
                              title: Text(
                                '${member['name']}${member['uid'] == _client.uid ? ' (you)' : ''}',
                              ),
                              subtitle: Text(
                                member['uid'] == circle.ownerUid
                                    ? 'Owner'
                                    : familyRoleLabels[member['role']] ??
                                          'Custom access',
                              ),
                              trailing:
                                  owner && member['uid'] != circle.ownerUid
                                  ? IconButton(
                                      tooltip: 'Edit access',
                                      icon: const Icon(Icons.tune),
                                      onPressed: _busy
                                          ? null
                                          : () => _edit(circle, member),
                                    )
                                  : null,
                            ),
                            if (member['untilMs'] != null)
                              Text(
                                'Access until ${DateTime.fromMillisecondsSinceEpoch(member['untilMs'] as int).toLocal().toString().split(' ').first}',
                              ),
                            if (owner && member['uid'] != circle.ownerUid)
                              TextButton(
                                onPressed: _busy
                                    ? null
                                    : () => _revoke(circle, member),
                                child: const Text('Remove access'),
                              ),
                          ],
                        ),
                      ),
                    ),
                  for (final invite in circle.pending)
                    ListTile(
                      title: Text(invite['email'] as String),
                      subtitle: const Text('Invitation waiting to be accepted'),
                      trailing: TextButton(
                        onPressed: _busy
                            ? null
                            : () => _change('member', {
                                'action': 'cancelInvite',
                                'id': invite['id'],
                              }, imei: circle.imei),
                        child: const Text('Cancel'),
                      ),
                    ),
                  if (owner)
                    Padding(
                      padding: const EdgeInsets.only(top: 16),
                      child: FilledButton.icon(
                        onPressed:
                            _busy ||
                                circle.activeMembers.length +
                                        circle.pending.length >=
                                    (circle.limits['people'] as int)
                            ? null
                            : () => _edit(circle),
                        icon: const Icon(Icons.person_add_alt),
                        label: const Text('Invite a family member'),
                      ),
                    ),
                ],
                if (_section == 1) ...[
                  GuardianCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${circle.limits['whatsappRecipients']} WhatsApp safety recipients',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'Choose who receives SOS and fall alerts. Routine updates stay in the app. Each person links their own number and agrees first.',
                        ),
                        const SizedBox(height: 12),
                        Text(
                          _data!.phone == null
                              ? 'Your WhatsApp is not linked yet.'
                              : 'Your linked number: ${_data!.phone}',
                        ),
                        TextButton.icon(
                          onPressed: _busy
                              ? null
                              : () => _change('link', {}, showCode: true),
                          icon: const Icon(Icons.link),
                          label: const Text('Link my WhatsApp'),
                        ),
                        for (final self in circle.members.where(
                          (m) => m['uid'] == _client.uid,
                        ))
                          SwitchListTile.adaptive(
                            contentPadding: EdgeInsets.zero,
                            title: Text(
                              'I agree to WhatsApp safety messages for ${circle.name}',
                            ),
                            value: self['whatsappConsent'] == true,
                            onChanged: _busy
                                ? null
                                : (value) => _change('whatsapp', {
                                    'action': 'consent',
                                    'enabled': value,
                                  }, imei: circle.imei),
                          ),
                      ],
                    ),
                  ),
                  for (final member in circle.activeMembers)
                    SwitchListTile.adaptive(
                      title: Text(member['name'] as String),
                      subtitle: Text(
                        member['whatsappConsent'] == true
                            ? 'Consent given · number must also be linked'
                            : 'Waiting for their consent',
                      ),
                      value: member['whatsapp'] == true,
                      onChanged: !owner || _busy
                          ? null
                          : (value) => _change('whatsapp', {
                              'action': 'select',
                              'uid': member['uid'],
                              'enabled': value,
                            }, imei: circle.imei),
                    ),
                  const Text(
                    'An alert being delivered or read does not mean someone has responded. A response does not automatically resolve the alert.',
                  ),
                ],
                if (_section == 2)
                  GuardianCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Guardian ${circle.plan == 'care' ? 'Care' : 'Family'}',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        Text(
                          'New-plan price: Rs${circle.limits['monthlyMur']} / month',
                        ),
                        const Text(
                          'One watch service · 12-month minimum commitment for the free-watch offer. Your existing billing agreement remains unchanged.',
                        ),
                        const SizedBox(height: 24),
                        Text(
                          '${circle.usage['used']} of ${circle.limits['answers']} everyday WhatsApp answers used',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 12),
                        LinearProgressIndicator(
                          value:
                              ((circle.usage['used'] as num) /
                                      (circle.limits['answers'] as num))
                                  .clamp(0, 1)
                                  .toDouble(),
                        ),
                        if ((circle.usage['reserved'] as num) > 0)
                          Text(
                            '${circle.usage['reserved']} answers are being processed or awaiting confirmation.',
                          ),
                        const SizedBox(height: 16),
                        const Text(
                          'Shared by everyone with access to this wearer. Resets on the first of each month in Mauritius. At the limit, use the app. No automatic paid overages.',
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'SOS, fall alerts and response acknowledgements do not use this allowance.',
                        ),
                      ],
                    ),
                  ),
              ],
              const SizedBox(height: 24),
              OutlinedButton.icon(
                onPressed: _busy ? null : _join,
                icon: const Icon(Icons.group_add_outlined),
                label: const Text('I have an invitation code'),
              ),
              if (_busy)
                const Padding(
                  padding: EdgeInsets.all(12),
                  child: LinearProgressIndicator(),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AccessDialog extends StatefulWidget {
  const _AccessDialog({this.member, required this.wearer});
  final Map<String, dynamic>? member;
  final String wearer;
  @override
  State<_AccessDialog> createState() => _AccessDialogState();
}

class _AccessDialogState extends State<_AccessDialog> {
  final _email = TextEditingController();
  late String _role;
  late Map<String, bool> _permissions;
  int _duration = 0;
  @override
  void initState() {
    super.initState();
    _role = widget.member?['role'] as String? ?? 'viewer';
    _permissions = widget.member == null
        ? familyPreset(_role)
        : Map<String, bool>.from(widget.member!['permissions'] as Map);
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Text(
      widget.member == null
          ? 'Invite someone for ${widget.wearer}'
          : 'Access for ${widget.member!['name']}',
    ),
    content: SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (widget.member == null)
              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Their Guardian account email',
                ),
              ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _role,
              decoration: const InputDecoration(labelText: 'Start with a role'),
              items: familyRoleLabels.entries
                  .map(
                    (v) => DropdownMenuItem(value: v.key, child: Text(v.value)),
                  )
                  .toList(),
              onChanged: (v) {
                if (v != null) {
                  setState(() {
                    _role = v;
                    _permissions = familyPreset(v);
                  });
                }
              },
            ),
            const SizedBox(height: 12),
            const Text(
              'Fine-tune access. Watch features still depend on the plan, availability and wearer consent.',
            ),
            for (final entry in familyPermissionLabels.entries)
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: Text(entry.value),
                value: _permissions[entry.key] == true,
                onChanged: (value) => setState(() {
                  _permissions[entry.key] = value;
                  if (entry.key == 'location' && !value) {
                    _permissions['history'] = false;
                    _permissions['zones'] = false;
                  }
                  if (['history', 'zones'].contains(entry.key) && value) {
                    _permissions['location'] = true;
                  }
                }),
              ),
            DropdownButtonFormField<int>(
              initialValue: _duration,
              decoration: const InputDecoration(labelText: 'Access duration'),
              items: [
                DropdownMenuItem(
                  value: 0,
                  child: Text(
                    widget.member?['untilMs'] != null
                        ? 'Keep current expiry'
                        : 'Ongoing',
                  ),
                ),
                const DropdownMenuItem(value: 7, child: Text('7 days')),
                const DropdownMenuItem(value: 30, child: Text('30 days')),
                if (widget.member?['untilMs'] != null)
                  const DropdownMenuItem(
                    value: -1,
                    child: Text('Make ongoing'),
                  ),
              ],
              onChanged: (v) => setState(() => _duration = v ?? 0),
            ),
            const SizedBox(height: 12),
            const Text(
              'Joining does not subscribe this person to WhatsApp messages.',
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, {
          if (widget.member == null) 'email': _email.text.trim(),
          'role': _role,
          'permissions': _permissions,
          'untilMs': _duration > 0
              ? DateTime.now()
                    .add(Duration(days: _duration))
                    .millisecondsSinceEpoch
              : _duration < 0
              ? null
              : widget.member?['untilMs'],
        }),
        child: Text(
          widget.member == null ? 'Create invitation' : 'Save access',
        ),
      ),
    ],
  );
}
