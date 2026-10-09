import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../navigation/home_shell_scope.dart';
import '../main.dart';
import '../models/device.dart';
import '../services/auth_service.dart';
import '../services/device_avatar_service.dart';
import '../services/guardian_avatar_service.dart';
import '../services/guardian_entitlements_scope.dart';
import '../services/guardian_services.dart';
import '../services/family_sharing_service.dart';
import '../services/locale_service.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/guardian_widgets.dart';
import '../widgets/layout/guardian_page_frame.dart';
import '../widgets/theme/theme_picker.dart';
import 'watch_settings_page.dart';
import 'emergency_contacts_page.dart';
import 'family_page.dart';

class AccountPage extends StatelessWidget {
  const AccountPage({super.key, this.watchOnly = false});

  final bool watchOnly;

  Future<void> _linkPendant(BuildContext context) async {
    var imei = '';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Link a watch'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter the 15-digit IMEI printed on the watch or returned '
              'by the status SMS (ts#).',
            ),
            const SizedBox(height: 12),
            TextFormField(
              onChanged: (value) => imei = value,
              keyboardType: TextInputType.number,
              maxLength: 15,
              decoration: const InputDecoration(
                labelText: 'IMEI',
                hintText: '15-digit IMEI on the watch',
                counterText: '',
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
            child: const Text('Link watch'),
          ),
        ],
      ),
    );
    if (ok != true || !context.mounted) {
      return;
    }
    try {
      await DeviceService().linkPendant(imei);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Watch linked — waiting for its first update'),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('$e')));
      }
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
    final t = AppLocalizations.of(context)!;
    final colors = context.guardianColors;
    final entitlementScope = GuardianEntitlementsScope.of(context);
    final subscription = entitlementScope.subscription;
    final subscriptionPresentation = GuardianSubscriptionPresentation.resolve(
      subscription: subscription,
      checking: entitlementScope.checking,
      error: entitlementScope.error,
    );
    final whatsappAlertsDecision = entitlementScope.decision(
      GuardianFeature.whatsappSafetyAlerts,
    );
    final sosWhatsappDecision = entitlementScope.decision(
      GuardianFeature.sosWhatsappAlerts,
    );
    final alertDeliveryLabel = whatsappAlertsDecision.allowed
        ? 'WhatsApp / SMS alerts'
        : sosWhatsappDecision.allowed
        ? 'SOS app & WhatsApp alerts'
        : 'App / SMS alerts';
    final alertDeliveryDescription = whatsappAlertsDecision.allowed
        ? 'Guardian safety alerts can use app notifications, configured SMS, and WhatsApp. Delivery still depends on an active provider configuration and approved WhatsApp templates.'
        : sosWhatsappDecision.allowed
        ? 'Guardian Essential sends a physical watch SOS to the app and to one primary emergency contact on WhatsApp. WhatsApp questions, routine alerts, fall alerts, AI, and watch commands require Guardian Family or Guardian Care. Delivery still depends on notification permission, active provider configuration, and approved Meta templates.'
        : 'Core safety alerts use the configured app and SMS channels. WhatsApp safety alerts require an active eligible Guardian plan.';
    final accountRole = subscription?.serviceActive == true
        ? subscription!.ownerUid == user?.uid
              ? 'Family account owner'
              : 'Family caregiver'
        : 'Guardian account';

    final textTheme = Theme.of(context).textTheme;

    return Scaffold(
      backgroundColor: colors.canvas,
      body: GuardianPageFrame(
        maxWidth: 920,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            GuardianSpacing.md,
            GuardianSpacing.lg,
            GuardianSpacing.md,
            118,
          ),
          children: [
            GuardianPageHeader(
              eyebrow: watchOnly ? 'YOUR WATCH' : 'YOUR ACCOUNT',
              title: watchOnly ? 'Watch' : 'Account & family',
              subtitle: watchOnly
                  ? 'Settings and care routines for each wearer.'
                  : 'Your profile, plan and personal preferences.',
            ),
            const SizedBox(height: GuardianSpacing.lg),
            if (!watchOnly) ...[
              GuardianCard(
                child: ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.people_outline),
                  title: const Text('Family & access'),
                  subtitle: const Text(
                    'Your family, shared watches and invitations.',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    final shell = HomeShellScope.maybeOf(context);
                    if (shell != null) {
                      shell.goToTab(2);
                    } else {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => const FamilyPage(),
                        ),
                      );
                    }
                  },
                ),
              ),
              const SizedBox(height: GuardianSpacing.md),
            ],
            if (!watchOnly)
              GuardianCard(
                child: Column(
                  children: [
                    AccountAvatarEditor(initials: initials),
                    const SizedBox(height: GuardianSpacing.xs),
                    Text(name, style: textTheme.titleMedium),
                    Text(
                      email.isEmpty ? accountRole : '$accountRole - $email',
                      style: textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            const SizedBox(height: GuardianSpacing.lg),
            if (watchOnly) const GuardianSectionTitle('Watches'),
            const SizedBox(height: GuardianSpacing.sm),
            if (watchOnly)
              StreamBuilder<List<Device>>(
                stream: DeviceService().watchLinkedDevices(),
                builder: (context, snapshot) {
                  final devices = snapshot.data ?? <Device>[];

                  return GuardianListGroup(
                    children: [
                      if (devices.isEmpty)
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(GuardianSpacing.md),
                          decoration: BoxDecoration(
                            border: Border(
                              bottom: BorderSide(color: colors.border),
                            ),
                          ),
                          child: Text(
                            'No watches linked yet. Add the 15-digit IMEI from '
                            'the device label.',
                            style: textTheme.bodyMedium,
                          ),
                        ),
                      for (var i = 0; i < devices.length; i++)
                        _DeviceRow(
                          device: devices[i],
                          subscription: subscription,
                          showDivider: i < devices.length - 1,
                          onUnlink: () =>
                              _confirmUnlinkPendant(context, devices[i]),
                        ),
                      GuardianSettingsRow(
                        icon: Icons.link_rounded,
                        label: 'Link a watch',
                        showDivider: devices.isNotEmpty,
                        onTap: () => _linkPendant(context),
                      ),
                    ],
                  );
                },
              ),
            const SizedBox(height: GuardianSpacing.lg),
            if (!watchOnly) GuardianSectionTitle(t.settingsHeading),
            const SizedBox(height: GuardianSpacing.sm),
            if (!watchOnly)
              GuardianListGroup(
                children: [
                  GuardianSettingsRow(
                    icon: Icons.sms_rounded,
                    label: alertDeliveryLabel,
                    onTap: () {
                      showDialog<void>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: const Text('Alert delivery'),
                          content: Text(alertDeliveryDescription),
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
                  GuardianSettingsRow(
                    icon: Icons.contact_phone_rounded,
                    label: 'Emergency contacts',
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          settings: const RouteSettings(name: '/contacts'),
                          builder: (_) => const EmergencyContactsPage(),
                        ),
                      );
                    },
                  ),
                  GuardianSettingsRow(
                    icon: Icons.workspace_premium_rounded,
                    label: t.subscriptionLabel,
                    trailing: subscriptionPresentation.trailingLabel,
                    onTap: () {
                      showDialog<void>(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: Text(t.subscriptionLabel),
                          content: Text(subscriptionPresentation.message),
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
                  GuardianSettingsRow(
                    icon: Icons.translate_rounded,
                    label: t.languageSettingLabel,
                    onTap: () => _showLanguagePicker(context),
                  ),
                  GuardianSettingsRow(
                    icon: Icons.palette_rounded,
                    label: 'Theme',
                    trailing:
                        (GuardianApp.themeOf(context) ??
                                GuardianThemeId.defaultTheme)
                            .displayName,
                    onTap: () => showThemePickerDialog(context),
                  ),
                  GuardianSettingsRow(
                    icon: Icons.logout_rounded,
                    label: t.signOut,
                    danger: true,
                    showDivider: false,
                    onTap: () => AuthService().signOut(),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

@visibleForTesting
class AccountAvatarEditor extends StatefulWidget {
  const AccountAvatarEditor({
    super.key,
    required this.initials,
    this.service,
    this.avatarUrls,
  });

  final String initials;
  final GuardianAvatarService? service;
  final Stream<String?>? avatarUrls;

  @override
  State<AccountAvatarEditor> createState() => _AccountAvatarEditorState();
}

class _AccountAvatarEditorState extends State<AccountAvatarEditor> {
  late final GuardianAvatarService _service;
  bool _busy = false;
  AvatarUpdateStage? _stage;
  double? _uploadFraction;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? GuardianAvatarService();
  }

  Future<void> _run(Future<dynamic> Function() action, String message) async {
    setState(() => _busy = true);
    try {
      final result = await action();
      if (result == false || !mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(message)));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Photo update failed: $error')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _choosePhoto() async {
    setState(() {
      _busy = true;
      _stage = AvatarUpdateStage.selection;
      _uploadFraction = null;
    });
    try {
      final updated = await _service.chooseAndUpload(
        onProgress: (progress) {
          if (!mounted) return;
          setState(() {
            _stage = progress.stage;
            _uploadFraction = progress.fraction;
          });
        },
      );
      if (!updated || !mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Profile photo updated')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Photo update failed: $error')));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _stage = null;
          _uploadFraction = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    return StreamBuilder<String?>(
      stream: widget.avatarUrls ?? UserProfileService().watchAvatarUrl(),
      builder: (context, snapshot) {
        final avatarUrl = snapshot.data;
        return Column(
          children: [
            AvatarBubble(
              initials: widget.initials,
              color: colors.accent,
              size: 64,
              ringWidth: 2,
              imageUrl: avatarUrl,
            ),
            const SizedBox(height: GuardianSpacing.xs),
            PhotoManagementControls(
              subjectName: 'guardian profile',
              hasPhoto: avatarUrl != null,
              busy: _busy,
              onChange: _choosePhoto,
              onRemove: () => _run(_service.remove, 'Profile photo removed'),
            ),
            if (_busy && _stage == AvatarUpdateStage.selection)
              Text(
                'Photo chooser open Ã¢â‚¬â€ choose an image or cancel.',
                style: textTheme.labelSmall,
              )
            else if (_busy)
              Column(
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      value: _stage == AvatarUpdateStage.upload
                          ? _uploadFraction
                          : null,
                    ),
                  ),
                  const SizedBox(height: GuardianSpacing.xxs),
                  Text(
                    _stage == AvatarUpdateStage.profileSave
                        ? 'Saving profile photoÃ¢â‚¬Â¦'
                        : _uploadFraction == null
                        ? 'Uploading photoÃ¢â‚¬Â¦'
                        : 'Uploading photoÃ¢â‚¬Â¦ ${(_uploadFraction! * 100).round()}%',
                    style: textTheme.labelSmall,
                  ),
                ],
              )
            else if (snapshot.hasError)
              Text(
                'Could not load profile photo',
                style: textTheme.labelSmall?.copyWith(
                  color: GuardianColors.danger,
                ),
              ),
          ],
        );
      },
    );
  }
}

class _DeviceRow extends StatelessWidget {
  const _DeviceRow({
    required this.device,
    required this.subscription,
    required this.showDivider,
    required this.onUnlink,
  });

  final Device device;
  final GuardianSubscription? subscription;
  final bool showDivider;
  final VoidCallback onUnlink;

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
            initials: initialsFor(device.displayName),
            color: avatarColorForKey(device.imei),
            size: 34,
            imageUrl: device.avatarUrl,
          ),
          const SizedBox(width: GuardianSpacing.sm),
          Expanded(
            child: Text(
              device.displayName,
              style: textTheme.titleMedium?.copyWith(fontSize: 13),
            ),
          ),
          Text(
            device.online ? 'Online' : 'Offline',
            style: textTheme.labelSmall,
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, size: 18),
            tooltip: 'Watch options',
            onSelected: (value) {
              if (value == 'unlink') onUnlink();
            },
            itemBuilder: (ctx) => [
              const PopupMenuItem(value: 'unlink', child: Text('Unlink watch')),
            ],
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, size: 18),
            tooltip: device.allowsShared('settings')
                ? 'Watch settings'
                : 'Watch settings are not shared',
            onPressed: !device.allowsShared('settings')
                ? null
                : () async {
                    final verifiedSubscription =
                        device.sharedSubscription ?? subscription;
                    if (verifiedSubscription == null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                            'Guardian is still verifying this family account.',
                          ),
                        ),
                      );
                      return;
                    }
                    var settingsDevice = device;
                    if (device.sharedPermissions != null) {
                      final sharing = FamilySharingService();
                      try {
                        settingsDevice = await sharing.loadWatchSettings(
                          device,
                        );
                      } catch (error) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                'Could not load watch settings: $error',
                              ),
                            ),
                          );
                        }
                        return;
                      } finally {
                        sharing.close();
                      }
                    }
                    if (!context.mounted) return;
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        settings: const RouteSettings(name: '/watch'),
                        builder: (_) => WatchSettingsPage(
                          device: settingsDevice,
                          subscription: verifiedSubscription,
                        ),
                      ),
                    );
                  },
          ),
        ],
      ),
    );
  }
}

Future<void> _confirmUnlinkPendant(BuildContext context, Device device) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Unlink watch?'),
      content: Text(
        '${device.displayName} will disappear from your account. '
        'The watch itself is not reset Ã¢â‚¬â€ you can link it again with the IMEI.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          style: GuardianControlStyles.destructive(ctx),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Unlink'),
        ),
      ],
    ),
  );
  if (ok != true || !context.mounted) return;

  try {
    await DeviceService().unlinkPendant(device.imei);
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('${device.displayName} unlinked')));
    }
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Could not unlink watch: $e')));
    }
  }
}

Future<void> _showLanguagePicker(BuildContext context) async {
  final current = Localizations.localeOf(context);
  final accent = context.guardianColors.accent;
  final picked = await showDialog<Locale>(
    context: context,
    builder: (ctx) => SimpleDialog(
      title: const Text('Language'),
      children: [
        for (final locale in LocaleService.supportedLocales)
          SimpleDialogOption(
            onPressed: () => Navigator.pop(ctx, locale),
            child: Row(
              children: [
                if (locale.languageCode == current.languageCode)
                  Icon(Icons.check, size: 18, color: accent)
                else
                  const SizedBox(width: 18),
                const SizedBox(width: 8),
                Text(
                  LocaleService.localeNames[locale.languageCode] ??
                      locale.languageCode,
                ),
              ],
            ),
          ),
      ],
    ),
  );
  if (picked != null && context.mounted) {
    GuardianApp.setLocale(context, picked);
  }
}

// ignore: unused_element
Future<void> _showDeviceSettingsDialog(
  BuildContext context,
  Device device,
  GuardianSubscription subscription,
) async {
  var nickname = device.nickname ?? '';
  var relationship = device.relationship ?? device.relationshipLabel;
  var sim = device.simNumber ?? '';
  var center = '';
  var sos = '';
  var monitor = '';
  var busy = false;

  await showDialog<void>(
    context: context,
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setLocal) {
          Future<void> run(
            Future<dynamic> Function() action,
            String successMessage,
          ) async {
            setLocal(() => busy = true);
            try {
              final result = await action();
              if (result == false) return;
              if (ctx.mounted) {
                ScaffoldMessenger.of(
                  ctx,
                ).showSnackBar(SnackBar(content: Text(successMessage)));
              }
            } catch (e) {
              if (ctx.mounted) {
                ScaffoldMessenger.of(
                  ctx,
                ).showSnackBar(SnackBar(content: Text('Failed: $e')));
              }
            } finally {
              setLocal(() => busy = false);
            }
          }

          final colors = ctx.guardianColors;

          return AlertDialog(
            title: Text('${device.displayName} settings'),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Person',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      AvatarBubble(
                        initials: initialsFor(device.displayName),
                        color: avatarColorForKey(device.imei),
                        size: 52,
                        imageUrl: device.avatarUrl,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: PhotoManagementControls(
                          subjectName: device.displayName,
                          hasPhoto: device.avatarUrl != null,
                          busy: busy,
                          onChange: () => run(
                            () => DeviceAvatarService().chooseAndUpload(
                              device.imei,
                            ),
                            'Photo updated',
                          ),
                          onRemove: () => run(
                            () => DeviceAvatarService().remove(device.imei),
                            'Photo removed',
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: nickname,
                    onChanged: (value) => nickname = value,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Nickname (optional)',
                      hintText: 'e.g. Mimi',
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: relationship,
                    onChanged: (value) => relationship = value,
                    textCapitalization: TextCapitalization.words,
                    decoration: const InputDecoration(
                      labelText: 'Relationship',
                      hintText: 'e.g. Mum, Dad, Grandad',
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceService().updatePersonIdentity(
                                device.imei,
                                nickname: nickname,
                                relationship: relationship,
                              ),
                              'Person details saved',
                            ),
                      child: const Text('Save person'),
                    ),
                  ),
                  const Divider(height: 24),
                  TextFormField(
                    initialValue: sim,
                    onChanged: (value) => sim = value,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: "Watch's SIM number",
                      hintText: '+230Ã¢â‚¬Â¦',
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceService().setSimNumber(
                                device.imei,
                                sim,
                              ),
                              'SIM number saved',
                            ),
                      child: const Text('Save SIM number'),
                    ),
                  ),
                  const Divider(height: 24),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.favorite_outline),
                    title: const Text('Watch settings'),
                    subtitle: const Text(
                      'Wellness routine, location, safety and watch details',
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(ctx).pop();
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          settings: const RouteSettings(name: '/watch'),
                          builder: (_) => WatchSettingsPage(
                            device: device,
                            subscription: subscription,
                          ),
                        ),
                      );
                    },
                  ),
                  const Divider(height: 24),
                  Text(
                    'Send SMS commands to the watch (see docs/reference/Switch-Server-SMS-Commands.pdf)',
                    style: TextStyle(fontSize: 12, color: colors.textSecondary),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: center,
                    onChanged: (value) => center = value,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Set center number',
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceCommandService().setCenterNumber(
                                device.imei,
                                center,
                              ),
                              'Command queued',
                            ),
                      child: const Text('Send'),
                    ),
                  ),
                  TextFormField(
                    initialValue: sos,
                    onChanged: (value) => sos = value,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Set SOS number 1',
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceCommandService().setSosNumber(
                                device.imei,
                                1,
                                sos,
                              ),
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
                              () => DeviceCommandService().checkStatus(
                                device.imei,
                              ),
                              'Status check queued',
                            ),
                      icon: const Icon(Icons.info_outline, size: 16),
                      label: const Text('Check status'),
                    ),
                  ),
                  const Divider(height: 24),
                  Text(
                    'Voice monitoring uses the V52 live watch connection. Use it only with '
                    'the wearer\'s knowledge and consent; availability can vary by firmware.',
                    style: TextStyle(fontSize: 12, color: colors.textSecondary),
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    initialValue: monitor,
                    onChanged: (value) => monitor = value,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Your number to receive the silent call',
                      hintText: '+230Ã¢â‚¬Â¦',
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceCommandService().startVoiceMonitor(
                                device.imei,
                                monitor,
                              ),
                              'Listen-in command queued',
                            ),
                      icon: const Icon(Icons.hearing, size: 16),
                      label: const Text('Listen in'),
                    ),
                  ),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: busy
                          ? null
                          : () => run(
                              () => DeviceCommandService().ringToFind(
                                device.imei,
                              ),
                              'Ring command queued',
                            ),
                      icon: const Icon(
                        Icons.notifications_active_outlined,
                        size: 16,
                      ),
                      label: const Text('Ring to find'),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: busy
                    ? null
                    : () async {
                        final confirmed = await showDialog<bool>(
                          context: ctx,
                          builder: (confirmCtx) => AlertDialog(
                            title: const Text('Unlink watch?'),
                            content: Text(
                              '${device.displayName} will disappear from your account. '
                              'The watch itself is not reset Ã¢â‚¬â€ you can link it again with the IMEI.',
                            ),
                            actions: [
                              TextButton(
                                onPressed: () =>
                                    Navigator.pop(confirmCtx, false),
                                child: const Text('Cancel'),
                              ),
                              FilledButton(
                                style: GuardianControlStyles.destructive(
                                  confirmCtx,
                                ),
                                onPressed: () =>
                                    Navigator.pop(confirmCtx, true),
                                child: const Text('Unlink'),
                              ),
                            ],
                          ),
                        );
                        if (confirmed != true || !ctx.mounted) return;
                        await run(
                          () => DeviceService().unlinkPendant(device.imei),
                          '${device.displayName} unlinked',
                        );
                        if (ctx.mounted) Navigator.pop(ctx);
                      },
                style: GuardianControlStyles.destructiveLink(ctx),
                child: const Text('Unlink watch'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('Close'),
              ),
            ],
          );
        },
      );
    },
  );
}
