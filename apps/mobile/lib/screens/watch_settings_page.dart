import 'package:flutter/material.dart';

import '../models/device.dart';
import '../services/device_avatar_service.dart';
import '../services/guardian_services.dart';
import '../services/guardian_entitlements_scope.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/guardian_widgets.dart';
import '../widgets/layout/guardian_page_frame.dart';
import 'care_settings_page.dart';
import 'emergency_contacts_page.dart';

class WatchSettingsPage extends StatefulWidget {
  const WatchSettingsPage({super.key, required this.device});

  final Device device;

  @override
  State<WatchSettingsPage> createState() => _WatchSettingsPageState();
}

class _WatchSettingsPageState extends State<WatchSettingsPage> {
  late final TextEditingController _nickname;
  late final TextEditingController _relationship;
  late final TextEditingController _sim;

  bool _savingPerson = false;
  bool _savingSim = false;
  bool _sendingSos = false;
  bool _advancedOpen = false;

  @override
  void initState() {
    super.initState();
    _nickname = TextEditingController(text: widget.device.nickname ?? '');
    _relationship = TextEditingController(
      text: widget.device.relationship ?? widget.device.relationshipLabel,
    );
    _sim = TextEditingController(text: widget.device.simNumber ?? '');
  }

  @override
  void dispose() {
    _nickname.dispose();
    _relationship.dispose();
    _sim.dispose();
    super.dispose();
  }

  Future<void> _savePerson() async {
    setState(() => _savingPerson = true);
    try {
      await DeviceService().updatePersonIdentity(
        widget.device.imei,
        nickname: _nickname.text,
        relationship: _relationship.text,
      );
      _show('Person details saved');
    } catch (error) {
      _show('Could not save person details: $error');
    } finally {
      if (mounted) setState(() => _savingPerson = false);
    }
  }

  Future<void> _saveSim() async {
    setState(() => _savingSim = true);
    try {
      await DeviceService().setSimNumber(widget.device.imei, _sim.text);
      _show('Watch SIM number saved');
    } catch (error) {
      _show('Could not save SIM number: $error');
    } finally {
      if (mounted) setState(() => _savingSim = false);
    }
  }

  Future<void> _configurePrimarySos(EmergencyContact contact) async {
    setState(() => _sendingSos = true);
    try {
      await DeviceCommandService().setSosNumber(
        widget.device.imei,
        1,
        contact.phone,
      );
      _show('Primary SOS contact sent to the watch');
    } catch (error) {
      _show('$error');
    } finally {
      if (mounted) setState(() => _sendingSos = false);
    }
  }

  Future<void> _changePhoto() async {
    try {
      final changed = await DeviceAvatarService().chooseAndUpload(
        widget.device.imei,
      );
      if (changed) _show('Photo updated');
    } catch (error) {
      _show('Could not update photo: $error');
    }
  }

  Future<void> _removePhoto() async {
    try {
      await DeviceAvatarService().remove(widget.device.imei);
      _show('Photo removed');
    } catch (error) {
      _show('Could not remove photo: $error');
    }
  }

  void _show(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        elevation: 0,
        title: Text('${widget.device.displayName} settings'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 48),
          child: GuardianPageFrame(
            maxWidth: 760,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SectionHeading(
                  eyebrow: 'PERSON',
                  title: 'Who wears this watch?',
                  subtitle:
                      'Identity and care context belong to the person, not the hardware.',
                ),
                const SizedBox(height: 14),
                _personCard(colors),
                const SizedBox(height: 24),
                _SectionHeading(
                  eyebrow: 'SAFETY & CARE',
                  title: 'What Guardian should do',
                  subtitle:
                      'Emergency calling, care profile, fall detection and reminders.',
                ),
                const SizedBox(height: 14),
                _safetyCard(colors),
                const SizedBox(height: 24),
                _SectionHeading(
                  eyebrow: 'WATCH',
                  title: 'Device essentials',
                  subtitle:
                      'Only settings a family should normally need to touch.',
                ),
                const SizedBox(height: 14),
                _watchCard(colors),
                const SizedBox(height: 24),
                _advancedCard(colors),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _personCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarBubble(
                initials: initialsFor(widget.device.displayName),
                color: avatarColorForKey(widget.device.imei),
                size: 58,
                imageUrl: widget.device.avatarUrl,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: PhotoManagementControls(
                  subjectName: widget.device.displayName,
                  hasPhoto: widget.device.avatarUrl != null,
                  busy: false,
                  onChange: _changePhoto,
                  onRemove: _removePhoto,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nickname,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Nickname',
              hintText: 'e.g. Jesh, Mum, Dad',
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _relationship,
            textCapitalization: TextCapitalization.words,
            decoration: const InputDecoration(
              labelText: 'Relationship',
              hintText: 'e.g. Daughter, Mum, Grandad',
            ),
          ),
          const SizedBox(height: 14),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: _savingPerson ? null : _savePerson,
              icon: const Icon(Icons.save_rounded, size: 17),
              label: const Text('Save person'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _safetyCard(GuardianThemeColors colors) {
    final careDecision = GuardianEntitlementsScope.of(
      context,
    ).decision(GuardianFeature.wellbeingActivitySummaries);
    return GuardianCard(
      child: Column(
        children: [
          _SettingsTile(
            icon: careDecision.allowed
                ? Icons.volunteer_activism_rounded
                : Icons.lock_outline_rounded,
            title: careDecision.allowed ? 'Care profile' : 'Care services',
            subtitle: careDecision.allowed
                ? 'Person profile, wellbeing priorities and medication reminders'
                : 'Guardian Care is required for wellbeing and medication services',
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CareSettingsPage(device: widget.device),
                ),
              );
            },
          ),
          const Divider(height: 1),
          _SettingsTile(
            icon: Icons.contact_phone_rounded,
            title: 'Emergency contacts',
            subtitle: 'People Guardian can contact when something matters',
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const EmergencyContactsPage(),
                ),
              );
            },
          ),
          const Divider(height: 1),
          StreamBuilder<List<EmergencyContact>>(
            stream: UserProfileService().watchContacts(),
            builder: (context, snapshot) {
              final contacts = snapshot.data ?? const <EmergencyContact>[];
              if (contacts.isEmpty) {
                return _SettingsTile(
                  icon: Icons.sos_rounded,
                  title: 'Primary SOS contact',
                  subtitle: 'Add an emergency contact first',
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => const EmergencyContactsPage(),
                      ),
                    );
                  },
                );
              }

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    _RoundIcon(
                      icon: Icons.sos_rounded,
                      color: GuardianColors.danger,
                      background: GuardianColors.dangerBg,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: DropdownButtonFormField<int>(
                        initialValue: 0,
                        decoration: const InputDecoration(
                          labelText: 'Primary SOS contact',
                          helperText:
                              'Holding SOS on the watch calls this person.',
                        ),
                        items: [
                          for (var i = 0; i < contacts.length; i++)
                            DropdownMenuItem(
                              value: i,
                              child: Text(
                                '${contacts[i].name} · ${contacts[i].phone}',
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                        ],
                        onChanged: _sendingSos
                            ? null
                            : (index) {
                                if (index == null) return;
                                _configurePrimarySos(contacts[index]);
                              },
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _watchCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _sim,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(
              labelText: "Watch's SIM number",
              helperText:
                  'This is the watch itself. It must never also be the SOS contact.',
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: _savingSim ? null : _saveSim,
              icon: const Icon(Icons.sim_card_rounded, size: 17),
              label: const Text('Save SIM number'),
            ),
          ),
          const Divider(height: 28),
          _SettingsTile(
            icon: Icons.location_on_outlined,
            title: 'Location update frequency',
            subtitle: 'Manage core location reporting for this watch',
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => CareSettingsPage(device: widget.device),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _advancedCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: Column(
        children: [
          InkWell(
            onTap: () => setState(() => _advancedOpen = !_advancedOpen),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  const Icon(Icons.build_circle_outlined, size: 20),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Advanced diagnostics',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          'Technical tools · not needed for everyday care',
                          style: TextStyle(
                            color: colors.textMuted,
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    _advancedOpen
                        ? Icons.expand_less_rounded
                        : Icons.expand_more_rounded,
                  ),
                ],
              ),
            ),
          ),
          if (_advancedOpen) ...[
            const Divider(height: 24),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      try {
                        await DeviceCommandService().checkStatus(
                          widget.device.imei,
                        );
                        _show('Status check queued');
                      } catch (error) {
                        _show('Could not queue status check: $error');
                      }
                    },
                    icon: const Icon(Icons.info_outline_rounded),
                    label: const Text('Check status'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      try {
                        await DeviceCommandService().ringToFind(
                          widget.device.imei,
                        );
                        _show('Ring-to-find queued');
                      } catch (error) {
                        _show('Could not queue ring command: $error');
                      }
                    },
                    icon: const Icon(Icons.notifications_active_outlined),
                    label: const Text('Ring to find'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'Raw center-number, SMS and experimental listen-in controls are intentionally hidden from the normal family experience.',
              style: TextStyle(
                color: colors.textMuted,
                fontSize: 11,
                height: 1.35,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _SectionHeading extends StatelessWidget {
  const _SectionHeading({
    required this.eyebrow,
    required this.title,
    required this.subtitle,
  });

  final String eyebrow;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          eyebrow,
          style: TextStyle(
            color: colors.textMuted,
            fontSize: 10,
            fontWeight: FontWeight.w800,
            letterSpacing: 1,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        Text(
          subtitle,
          style: TextStyle(
            color: colors.textSecondary,
            fontSize: 12,
            height: 1.35,
          ),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  const _SettingsTile({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: _RoundIcon(
        icon: icon,
        color: GuardianColors.safe,
        background: GuardianColors.safeBg,
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(
        subtitle,
        style: TextStyle(color: colors.textMuted, fontSize: 11),
      ),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}

class _RoundIcon extends StatelessWidget {
  const _RoundIcon({
    required this.icon,
    required this.color,
    required this.background,
  });

  final IconData icon;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(color: background, shape: BoxShape.circle),
      child: Icon(icon, size: 18, color: color),
    );
  }
}
