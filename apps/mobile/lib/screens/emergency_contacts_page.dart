import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/guardian_widgets.dart';

/// Mauritius national emergency numbers (Police, SAMU ambulance, Fire).
List<({String label, String number, IconData icon})> _mauritiusEmergencyNumbers(
  AppLocalizations t,
) => [
  (label: t.emergencyPolice, number: '999', icon: Icons.local_police_rounded),
  (label: t.emergencySamu, number: '114', icon: Icons.medical_services_rounded),
  (
    label: t.emergencyFire,
    number: '995',
    icon: Icons.local_fire_department_rounded,
  ),
];

class EmergencyContactsPage extends StatelessWidget {
  const EmergencyContactsPage({super.key});

  Future<void> _call(BuildContext context, String number) async {
    final uri = Uri(scheme: 'tel', path: number);
    if (!await launchUrl(uri) && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not start a call to $number')),
      );
    }
  }

  Future<void> _addContact(
    BuildContext context,
    UserProfileService service,
    List<EmergencyContact> existing,
  ) async {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController(text: '+230');
    final waCtrl = TextEditingController();

    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Add contact'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: phoneCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(labelText: 'Phone'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: waCtrl,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                labelText: 'WhatsApp (optional)',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (ok == true && context.mounted) {
      if (nameCtrl.text.trim().isEmpty || phoneCtrl.text.trim().isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Name and phone are required')),
        );
      } else {
        await service.saveContacts([
          ...existing,
          EmergencyContact(
            name: nameCtrl.text.trim(),
            phone: phoneCtrl.text.trim(),
            whatsapp: waCtrl.text.trim().isEmpty ? null : waCtrl.text.trim(),
          ),
        ]);
      }
    }

    nameCtrl.dispose();
    phoneCtrl.dispose();
    waCtrl.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final service = UserProfileService();
    final t = AppLocalizations.of(context)!;
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final emergencyNumbers = _mauritiusEmergencyNumbers(t);

    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        title: Text(t.emergencyContactsTitle),
        backgroundColor: colors.surface,
        foregroundColor: colors.textPrimary,
        elevation: 0,
      ),
      body: StreamBuilder<List<EmergencyContact>>(
        stream: service.watchContacts(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return Center(
              child: CircularProgressIndicator(color: colors.accent),
            );
          }
          final contacts = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.fromLTRB(
              GuardianSpacing.md,
              GuardianSpacing.lg,
              GuardianSpacing.md,
              GuardianSpacing.md,
            ),
            children: [
              GuardianSectionTitle(t.emergencyNumbersHeading),
              const SizedBox(height: GuardianSpacing.sm),
              Row(
                children: [
                  for (final e in emergencyNumbers) ...[
                    Expanded(
                      child: _EmergencyNumberChip(
                        icon: e.icon,
                        label: e.label,
                        number: e.number,
                        onTap: () => _call(context, e.number),
                      ),
                    ),
                    if (e != emergencyNumbers.last)
                      const SizedBox(width: GuardianSpacing.xs),
                  ],
                ],
              ),
              const SizedBox(height: GuardianSpacing.lg),
              const GuardianSectionTitle('Your contacts'),
              const SizedBox(height: GuardianSpacing.sm),
              if (contacts.isEmpty)
                GuardianCard(
                  child: Text(
                    'No contacts yet. These people can receive SOS and alert notifications later.',
                    style: textTheme.bodyMedium,
                  ),
                )
              else
                GuardianListGroup(
                  children: [
                    for (var i = 0; i < contacts.length; i++)
                      _ContactRow(
                        contact: contacts[i],
                        showDivider: i < contacts.length - 1,
                        onRemove: () async {
                          final next = [...contacts]..removeAt(i);
                          await service.saveContacts(next);
                        },
                      ),
                  ],
                ),
              const SizedBox(height: GuardianSpacing.sm),
              GuardianListGroup(
                children: [
                  GuardianSettingsRow(
                    icon: Icons.person_add_rounded,
                    label: t.addContact,
                    showDivider: false,
                    onTap: () => _addContact(context, service, contacts),
                  ),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
}

class _EmergencyNumberChip extends StatelessWidget {
  const _EmergencyNumberChip({
    required this.icon,
    required this.label,
    required this.number,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String number;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(GuardianRadius.medium),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(GuardianRadius.medium),
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: GuardianSpacing.xs,
            vertical: GuardianSpacing.sm,
          ),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(GuardianRadius.medium),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20, color: colors.accent),
              const SizedBox(height: GuardianSpacing.xxs),
              Text(
                label,
                style: textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              Text(number, style: textTheme.labelSmall),
            ],
          ),
        ),
      ),
    );
  }
}

class _ContactRow extends StatelessWidget {
  const _ContactRow({
    required this.contact,
    required this.showDivider,
    required this.onRemove,
  });

  final EmergencyContact contact;
  final bool showDivider;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: GuardianSpacing.sm,
        vertical: GuardianSpacing.sm,
      ),
      decoration: BoxDecoration(
        border: showDivider
            ? Border(bottom: BorderSide(color: colors.border))
            : null,
      ),
      child: Row(
        children: [
          AvatarBubble(
            initials: initialsFor(contact.name),
            color: avatarColorForKey(contact.phone),
            size: 30,
          ),
          const SizedBox(width: GuardianSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  contact.name,
                  style: textTheme.titleMedium?.copyWith(fontSize: 13),
                ),
                Text(
                  '${contact.phone}${contact.whatsapp != null ? ' · WhatsApp ${contact.whatsapp}' : ''}',
                  style: textTheme.labelSmall,
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onRemove,
            style: TextButton.styleFrom(foregroundColor: GuardianColors.danger),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }
}
