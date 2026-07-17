import 'package:flutter/material.dart';

import '../services/guardian_services.dart';
import '../theme/app_theme.dart';

class EmergencyContactsPage extends StatelessWidget {
  const EmergencyContactsPage({super.key});

  Future<void> _addContact(
    BuildContext context,
    UserProfileService service,
    List<EmergencyContact> existing,
  ) async {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
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

    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      appBar: AppBar(
        title: const Text('Emergency contacts'),
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
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _addContact(context, service, contacts),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Add contact'),
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
