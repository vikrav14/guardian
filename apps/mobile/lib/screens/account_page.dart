import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../models/device.dart';
import '../services/auth_service.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/guardian_widgets.dart';
import 'emergency_contacts_page.dart';

class AccountPage extends StatelessWidget {
  const AccountPage({super.key});

  Future<void> _createInvite(BuildContext context) async {
    try {
      final code = await FamilyService().createInviteCode();
      if (!context.mounted) return;
      await Clipboard.setData(ClipboardData(text: code));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Invite code $code copied. Share it with family.')),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not create invite: $e')),
      );
    }
  }

  Future<void> _acceptInvite(BuildContext context) async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Join a family'),
        content: TextField(
          controller: ctrl,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'Invite code',
            hintText: 'e.g. AB12CD',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Join')),
        ],
      ),
    );
    if (ok != true || !context.mounted) {
      ctrl.dispose();
      return;
    }
    try {
      await FamilyService().acceptInviteCode(ctrl.text);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Joined family — pendants linked')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$e')),
        );
      }
    } finally {
      ctrl.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final name = user?.displayName?.trim().isNotEmpty == true
        ? user!.displayName!
        : 'Guardian user';
    final email = user?.email ?? '';
    final initials = initialsFor(name);
    final family = FamilyService();

    return Scaffold(
      backgroundColor: GuardianColors.surfaceMuted,
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 24),
              color: GuardianColors.safeBg,
              child: Column(
                children: [
                  AvatarBubble(
                    initials: initials,
                    color: GuardianColors.safe,
                    size: 56,
                    ringWidth: 0,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    name,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
                  ),
                  Text(
                    email.isEmpty ? 'Family admin' : 'Family admin · $email',
                    style: const TextStyle(
                      fontSize: 12,
                      color: GuardianColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Pendants',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: GuardianColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  StreamBuilder<List<Device>>(
                    stream: DeviceService().watchLinkedDevices(),
                    builder: (context, snapshot) {
                      final devices = snapshot.data ?? <Device>[];

                      if (devices.isEmpty) {
                        return Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: GuardianColors.surface,
                            borderRadius: BorderRadius.circular(14),
                          ),
                          child: const Text(
                            'No pendants linked yet.',
                            style: TextStyle(color: GuardianColors.textSecondary),
                          ),
                        );
                      }

                      return Container(
                        decoration: BoxDecoration(
                          color: GuardianColors.surface,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Column(
                          children: [
                            for (var i = 0; i < devices.length; i++)
                              _DeviceRow(
                                device: devices[i],
                                showDivider: i < devices.length - 1,
                              ),
                          ],
                        ),
                      );
                    },
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Family circle',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: GuardianColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  StreamBuilder<List<FamilyMember>>(
                    stream: family.watchFamilyMembers(),
                    builder: (context, memberSnap) {
                      return StreamBuilder<List<FamilyInvite>>(
                        stream: family.watchMyInvites(),
                        builder: (context, inviteSnap) {
                          final members = memberSnap.data ?? const <FamilyMember>[];
                          final invites = inviteSnap.data ?? const <FamilyInvite>[];
                          final accepted = invites
                              .where((i) => i.status == 'accepted')
                              .toList();
                          final pending = invites
                              .where((i) => i.status == 'pending')
                              .toList();

                          return Container(
                            decoration: BoxDecoration(
                              color: GuardianColors.surface,
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Column(
                              children: [
                                if (members.isEmpty && accepted.isEmpty)
                                  const Padding(
                                    padding: EdgeInsets.all(16),
                                    child: Text(
                                      'Invite a spouse or relative so they can watch the same pendants.',
                                      style: TextStyle(color: GuardianColors.textSecondary),
                                    ),
                                  ),
                                for (var i = 0; i < members.length; i++)
                                  _PersonRow(
                                    name: members[i].displayName,
                                    subtitle: members[i].email ?? 'Family member',
                                    showDivider: i < members.length - 1 || accepted.isNotEmpty,
                                  ),
                                for (var i = 0; i < accepted.length; i++)
                                  _PersonRow(
                                    name: accepted[i].acceptedByName ?? 'Family member',
                                    subtitle: 'Joined with code ${accepted[i].code}',
                                    showDivider: i < accepted.length - 1 || pending.isNotEmpty,
                                  ),
                                for (final invite in pending)
                                  _PersonRow(
                                    name: 'Invite ${invite.code}',
                                    subtitle: 'Waiting to be accepted · tap to copy',
                                    showDivider: false,
                                    onTap: () async {
                                      await Clipboard.setData(ClipboardData(text: invite.code));
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          SnackBar(content: Text('Copied ${invite.code}')),
                                        );
                                      }
                                    },
                                  ),
                              ],
                            ),
                          );
                        },
                      );
                    },
                  ),
                  TextButton(
                    onPressed: () => _createInvite(context),
                    style: TextButton.styleFrom(
                      foregroundColor: GuardianColors.safeText,
                      alignment: Alignment.centerLeft,
                    ),
                    child: const Text('+ Invite a family member'),
                  ),
                  TextButton(
                    onPressed: () => _acceptInvite(context),
                    style: TextButton.styleFrom(
                      foregroundColor: GuardianColors.safeText,
                      alignment: Alignment.centerLeft,
                    ),
                    child: const Text('Have a code? Join a family'),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Settings',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: GuardianColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Container(
                    decoration: BoxDecoration(
                      color: GuardianColors.surface,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: Column(
                      children: [
                        _SettingRow(
                          icon: Icons.chat_bubble_outline,
                          label: 'WhatsApp / SMS alerts',
                          onTap: () {
                            showDialog<void>(
                              context: context,
                              builder: (ctx) => AlertDialog(
                                title: const Text('Alert delivery'),
                                content: const Text(
                                  'SOS, fall, and safe-zone exit alerts notify your emergency contacts '
                                  'through the gateway. Add Twilio keys in gateway/.env to send real '
                                  'SMS/WhatsApp. Until then, deliveries are logged in notificationLogs.',
                                ),
                                actions: [
                                  TextButton(
                                    onPressed: () => Navigator.pop(ctx),
                                    child: const Text('OK'),
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                        _SettingRow(
                          icon: Icons.phone_outlined,
                          label: 'Emergency contacts',
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) => const EmergencyContactsPage(),
                              ),
                            );
                          },
                        ),
                        _SettingRow(
                          icon: Icons.credit_card,
                          label: 'Subscription',
                          trailing: 'Rs 200/mo',
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('Subscription coming soon')),
                            );
                          },
                        ),
                        _SettingRow(
                          icon: Icons.logout,
                          label: 'Sign out',
                          danger: true,
                          last: true,
                          onTap: () => AuthService().signOut(),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceRow extends StatelessWidget {
  const _DeviceRow({required this.device, required this.showDivider});

  final Device device;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        border: showDivider
            ? const Border(bottom: BorderSide(color: GuardianColors.border))
            : null,
      ),
      child: Row(
        children: [
          AvatarBubble(
            initials: initialsFor(device.displayName),
            color: avatarColorForKey(device.imei),
            size: 30,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              device.displayName,
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
          Text(
            device.online ? 'Online' : 'Pendant linked',
            style: const TextStyle(fontSize: 11, color: GuardianColors.textSecondary),
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 18),
            tooltip: 'Pendant settings',
            onPressed: () => _showDeviceSettingsDialog(context, device),
          ),
        ],
      ),
    );
  }
}

Future<void> _showDeviceSettingsDialog(BuildContext context, Device device) async {
  final simCtrl = TextEditingController(text: device.simNumber ?? '');
  final centerCtrl = TextEditingController();
  final sosCtrl = TextEditingController();
  var busy = false;

  await showDialog<void>(
    context: context,
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setLocal) {
          Future<void> run(Future<void> Function() action, String successMessage) async {
            setLocal(() => busy = true);
            try {
              await action();
              if (ctx.mounted) {
                ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(successMessage)));
              }
            } catch (e) {
              if (ctx.mounted) {
                ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text('Failed: $e')));
              }
            } finally {
              setLocal(() => busy = false);
            }
          }

          return AlertDialog(
            title: Text('${device.displayName} settings'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: simCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: "Pendant's SIM number",
                      hintText: '+230…',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                                () => DeviceService().setSimNumber(device.imei, simCtrl.text),
                                'SIM number saved',
                              ),
                      child: const Text('Save SIM number'),
                    ),
                  ),
                  const Divider(height: 24),
                  const Text(
                    'Send SMS commands to the pendant (see docs/reference/Switch-Server-SMS-Commands.pdf)',
                    style: TextStyle(fontSize: 12, color: GuardianColors.textSecondary),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: centerCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Set center number'),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                                () => DeviceCommandService()
                                    .setCenterNumber(device.imei, centerCtrl.text),
                                'Command queued',
                              ),
                      child: const Text('Send'),
                    ),
                  ),
                  TextField(
                    controller: sosCtrl,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(labelText: 'Set SOS number 1'),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                                () => DeviceCommandService()
                                    .setSosNumber(device.imei, 1, sosCtrl.text),
                                'Command queued',
                              ),
                      child: const Text('Send'),
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: busy
                          ? null
                          : () => run(
                                () => DeviceCommandService().checkStatus(device.imei),
                                'Status check queued',
                              ),
                      icon: const Icon(Icons.info_outline, size: 16),
                      label: const Text('Check status'),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close')),
            ],
          );
        },
      );
    },
  );

  simCtrl.dispose();
  centerCtrl.dispose();
  sosCtrl.dispose();
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({
    required this.name,
    required this.subtitle,
    required this.showDivider,
    this.onTap,
  });

  final String name;
  final String subtitle;
  final bool showDivider;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          border: showDivider
              ? const Border(bottom: BorderSide(color: GuardianColors.border))
              : null,
        ),
        child: Row(
          children: [
            AvatarBubble(
              initials: initialsFor(name),
              color: GuardianColors.safe,
              size: 30,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  Text(
                    subtitle,
                    style: const TextStyle(fontSize: 11, color: GuardianColors.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SettingRow extends StatelessWidget {
  const _SettingRow({
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.danger = false,
    this.last = false,
  });

  final IconData icon;
  final String label;
  final String? trailing;
  final bool danger;
  final bool last;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = danger ? GuardianColors.danger : GuardianColors.textSecondary;
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          border: last
              ? null
              : const Border(bottom: BorderSide(color: GuardianColors.border)),
        ),
        child: Row(
          children: [
            Icon(icon, size: 17, color: color),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  color: danger ? GuardianColors.danger : GuardianColors.textPrimary,
                ),
              ),
            ),
            if (trailing != null)
              Text(
                trailing!,
                style: const TextStyle(
                  fontSize: 11,
                  color: GuardianColors.safeText,
                  fontWeight: FontWeight.w600,
                ),
              )
            else if (!danger)
              const Icon(Icons.chevron_right, size: 16, color: GuardianColors.textMuted),
          ],
        ),
      ),
    );
  }
}
