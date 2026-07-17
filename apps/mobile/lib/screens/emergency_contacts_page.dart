import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';

/// Mauritius national emergency numbers (Police, SAMU ambulance, Fire).
List<({String label, String number})> _mauritiusEmergencyNumbers(AppLocalizations t) => [
      (label: t.emergencyPolice, number: '999'),
      (label: t.emergencySamu, number: '114'),
      (label: t.emergencyFire, number: '995'),
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
            TextField(controller: nameCtrl, decoration: const InputDecoration(labelText: 'Name')),
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
              decoration: const InputDecoration(labelText: 'WhatsApp (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Save')),
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
    final emergencyNumbers = _mauritiusEmergencyNumbers(t);

    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      appBar: AppBar(
        title: Text(t.emergencyContactsTitle),
        backgroundColor: GuardianColors.surface,
        foregroundColor: GuardianColors.textPrimary,
        elevation: 0,
      ),
      body: StreamBuilder<List<EmergencyContact>>(
        stream: service.watchContacts(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final contacts = snapshot.data!;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                t.emergencyNumbersHeading,
                style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: GuardianColors.textSecondary),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  for (final e in emergencyNumbers) ...[
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => _call(context, e.number),
                        icon: const Icon(Icons.call, size: 16),
                        label: Text('${e.label} · ${e.number}'),
                      ),
                    ),
                    if (e != emergencyNumbers.last) const SizedBox(width: 8),
                  ],
                ],
              ),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _addContact(context, service, contacts),
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(t.addContact),
                ),
              ),
              const SizedBox(height: 16),
              if (contacts.isEmpty)
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(
                    color: GuardianColors.surface,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Text(
                    'No contacts yet. These people can receive SOS and alert notifications later.',
                    style: TextStyle(color: GuardianColors.textSecondary),
                  ),
                )
              else
                ...contacts.asMap().entries.map((entry) {
                  final i = entry.key;
                  final c = entry.value;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: GuardianColors.surface,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                c.name,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${c.phone}${c.whatsapp != null ? ' · WhatsApp ${c.whatsapp}' : ''}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: GuardianColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        TextButton(
                          onPressed: () async {
                            final next = [...contacts]..removeAt(i);
                            await service.saveContacts(next);
                          },
                          style: TextButton.styleFrom(foregroundColor: GuardianColors.danger),
                          child: const Text('Remove'),
                        ),
                      ],
                    ),
                  );
                }),
            ],
          );
        },
      ),
    );
  }
}
