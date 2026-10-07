import 'package:flutter/material.dart';

import '../services/family_sharing_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_surface.dart';
import '../widgets/layout/guardian_page_frame.dart';

/// Keeps the complete access draft on screen until the server accepts it.
class FamilyAccessPage extends StatefulWidget {
  const FamilyAccessPage({
    super.key,
    required this.wearer,
    required this.onSave,
    this.member,
  });

  final String wearer;
  final Map<String, dynamic>? member;
  final Future<void> Function(Map<String, dynamic> value) onSave;

  @override
  State<FamilyAccessPage> createState() => _FamilyAccessPageState();
}

class _FamilyAccessPageState extends State<FamilyAccessPage> {
  final _email = TextEditingController();
  final _emailKey = GlobalKey<FormFieldState<String>>();
  late String _role;
  late Map<String, bool> _permissions;
  int _duration = 0;
  bool _saving = false;
  String? _error;

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

  Future<void> _save() async {
    if (_saving) return;
    if (widget.member == null && !_emailKey.currentState!.validate()) {
      await Scrollable.ensureVisible(
        _emailKey.currentContext!,
        duration: const Duration(milliseconds: 200),
        alignment: 0.2,
      );
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave({
        if (widget.member == null) 'email': _email.text.trim(),
        'role': _role,
        'permissions': Map<String, bool>.from(_permissions),
        'untilMs': _duration > 0
            ? DateTime.now()
                  .add(Duration(days: _duration))
                  .millisecondsSinceEpoch
            : _duration < 0
            ? null
            : widget.member?['untilMs'],
      });
      if (!mounted) return;
      setState(() => _saving = false);
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = error is FamilySharingException
            ? error.toString()
            : 'Could not save access. Your choices are kept. Please try again.';
      });
    }
  }

  Widget _heading(String title) => Text(
    title,
    style: Theme.of(
      context,
    ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
  );

  Widget _personCard() => GuardianSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading(
          widget.member == null
              ? 'Who would you like to invite?'
              : 'Family member',
        ),
        const SizedBox(height: 8),
        Text('Access to ${widget.wearer} only. Other wearers are unaffected.'),
        const SizedBox(height: 24),
        if (widget.member == null)
          TextFormField(
            key: _emailKey,
            controller: _email,
            enabled: !_saving,
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.done,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Their account email',
              hintText: 'name@example.com',
              helperText: 'They will use this email to sign in to Guardian.',
              helperMaxLines: 3,
            ),
            validator: (value) =>
                RegExp(
                  r'^[^\s@]+@[^\s@]+\.[^\s@]+$',
                ).hasMatch(value?.trim() ?? '')
                ? null
                : 'Enter a valid email address.',
          )
        else
          Text(
            widget.member!['name'] as String? ?? 'Family member',
            style: Theme.of(context).textTheme.titleLarge,
          ),
        const SizedBox(height: 24),
        DropdownButtonFormField<String>(
          initialValue: _role,
          isExpanded: true,
          decoration: const InputDecoration(labelText: 'Start with a role'),
          items: [
            for (final entry in familyRoleLabels.entries)
              DropdownMenuItem(value: entry.key, child: Text(entry.value)),
          ],
          onChanged: _saving
              ? null
              : (value) {
                  if (value == null) return;
                  setState(() {
                    _role = value;
                    _permissions = familyPreset(value);
                  });
                },
        ),
        const SizedBox(height: 12),
        const Text(
          'A role sets the starting permissions. Adjust each switch below to choose their access.',
        ),
      ],
    ),
  );

  Widget _permissionsCard() => GuardianSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading('What they can see and do'),
        const SizedBox(height: 8),
        const Text(
          'Watch features still depend on your plan, availability and wearer consent.',
        ),
        const SizedBox(height: 12),
        for (final entry in familyPermissionLabels.entries)
          SwitchListTile.adaptive(
            key: ValueKey('access-${entry.key}'),
            contentPadding: EdgeInsets.zero,
            title: Text(entry.value),
            value: _permissions[entry.key] == true,
            onChanged: _saving
                ? null
                : (value) => setState(() {
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
        const SizedBox(height: 8),
        const Text(
          'Journey history and safe zones also need current location access.',
        ),
      ],
    ),
  );

  Widget _durationCard() => GuardianSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _heading('How long can they help?'),
        const SizedBox(height: 24),
        DropdownButtonFormField<int>(
          initialValue: _duration,
          isExpanded: true,
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
              const DropdownMenuItem(value: -1, child: Text('Make ongoing')),
          ],
          onChanged: _saving
              ? null
              : (value) => setState(() => _duration = value ?? 0),
        ),
        const SizedBox(height: 12),
        const Text(
          'Useful for a relative helping during the school holidays, or a temporary caregiver. You can remove access at any time.',
        ),
        const Divider(height: 32),
        _heading('WhatsApp is a separate choice'),
        const SizedBox(height: 8),
        const Text(
          'Joining does not subscribe this person to WhatsApp messages. After they join, choose recipients in Family → WhatsApp, within your plan allowance. Each person must link their number and give consent.',
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: Scaffold(
      backgroundColor: context.guardianColors.canvas,
      appBar: AppBar(
        title: Text(widget.member == null ? 'Invite someone' : 'Edit access'),
      ),
      body: GuardianPageFrame(
        maxWidth: 1040,
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final introduction = Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'For ${widget.wearer}',
                          style: Theme.of(context).textTheme.headlineSmall,
                        ),
                        const SizedBox(height: 20),
                        _personCard(),
                        const SizedBox(height: 16),
                      ],
                    );
                    if (constraints.maxWidth >= 760) {
                      return Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              children: [introduction, _durationCard()],
                            ),
                          ),
                          const SizedBox(width: 20),
                          Expanded(child: _permissionsCard()),
                        ],
                      );
                    }
                    return Column(
                      children: [
                        introduction,
                        _permissionsCard(),
                        const SizedBox(height: 16),
                        _durationCard(),
                      ],
                    );
                  },
                ),
              ),
            ),
            Material(
              color: context.guardianColors.surface,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_error != null) ...[
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            _error!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                      ],
                      FilledButton(
                        onPressed: _saving ? null : _save,
                        child: Text(
                          _saving
                              ? 'Saving…'
                              : widget.member == null
                              ? 'Create invitation'
                              : 'Save access',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
}
