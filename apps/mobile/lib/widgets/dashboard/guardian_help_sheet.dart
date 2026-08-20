import 'package:flutter/material.dart';

Future<void> showGuardianHelpSheet(
  BuildContext context, {
  required String deviceName,
  required VoidCallback onLocation,
  required VoidCallback onWatchStatus,
  required VoidCallback onAlerts,
  required VoidCallback onJourney,
  required VoidCallback onWhatsApp,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => GuardianHelpSheet(
      deviceName: deviceName,
      onLocation: onLocation,
      onWatchStatus: onWatchStatus,
      onAlerts: onAlerts,
      onJourney: onJourney,
      onWhatsApp: onWhatsApp,
    ),
  );
}

class GuardianHelpSheet extends StatelessWidget {
  const GuardianHelpSheet({
    required this.deviceName,
    required this.onLocation,
    required this.onWatchStatus,
    required this.onAlerts,
    required this.onJourney,
    required this.onWhatsApp,
    super.key,
  });

  final String deviceName;
  final VoidCallback onLocation;
  final VoidCallback onWatchStatus;
  final VoidCallback onAlerts;
  final VoidCallback onJourney;
  final VoidCallback onWhatsApp;

  void _run(BuildContext context, VoidCallback action) {
    Navigator.pop(context);
    action();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Center(
        heightFactor: 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 620),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
            children: [
              Text(
                'Guardian help for $deviceName',
                style: theme.textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Quick checks use verified Guardian data and do not call an AI service. Continue to WhatsApp only when you choose.',
                style: theme.textTheme.bodyMedium,
              ),
              const SizedBox(height: 14),
              _HelpAction(
                key: const Key('guardian-help-location'),
                icon: Icons.location_on_outlined,
                title: 'Location check',
                subtitle: 'See source, precision and when it was recorded',
                onTap: () => _run(context, onLocation),
              ),
              _HelpAction(
                key: const Key('guardian-help-status'),
                icon: Icons.watch_outlined,
                title: 'Battery and watch status',
                subtitle: 'Check connection, battery and last update',
                onTap: () => _run(context, onWatchStatus),
              ),
              _HelpAction(
                key: const Key('guardian-help-alerts'),
                icon: Icons.notifications_outlined,
                title: 'Recent alerts',
                subtitle: 'Open the verified Guardian alert timeline',
                onTap: () => _run(context, onAlerts),
              ),
              _HelpAction(
                key: const Key('guardian-help-journey'),
                icon: Icons.route_outlined,
                title: 'Recent journey',
                subtitle: 'Open confirmed movement history',
                onTap: () => _run(context, onJourney),
              ),
              const Divider(height: 28),
              _HelpAction(
                key: const Key('guardian-help-whatsapp'),
                icon: Icons.chat_bubble_outline_rounded,
                title: 'Continue on WhatsApp',
                subtitle: 'Optional—opens only after you confirm',
                onTap: () => _run(context, onWhatsApp),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HelpAction extends StatelessWidget {
  const _HelpAction({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
    super.key,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 3),
      leading: CircleAvatar(child: Icon(icon)),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right_rounded),
      onTap: onTap,
    );
  }
}
