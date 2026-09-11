import 'package:flutter/material.dart';

import '../../dashboard/device_connectivity.dart';
import '../../dashboard/device_formatters.dart';
import '../../models/care_profile.dart';
import '../../models/device.dart';
import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';

/// A person-first overview. Connection status describes the watch connection;
/// location provenance and freshness belong to the separate location card.
class GuardianOverviewHeader extends StatelessWidget {
  const GuardianOverviewHeader({
    super.key,
    required this.device,
    required this.helpEnabled,
    this.onCall,
    this.onJourney,
    this.onHelp,
    this.onWatchStatus,
  });

  final Device device;
  final bool helpEnabled;
  final VoidCallback? onCall;
  final VoidCallback? onJourney;
  final VoidCallback? onHelp;
  final VoidCallback? onWatchStatus;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 760 && textScale <= 1.3;
        final identity = _OverviewIdentity(
          device: device,
          onWatchStatus: onWatchStatus,
        );
        final actions = _OverviewActions(
          helpEnabled: helpEnabled,
          onCall: onCall,
          onJourney: onJourney,
          onHelp: onHelp,
        );

        return Container(
          padding: EdgeInsets.all(desktop ? 24 : 20),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: colors.border),
          ),
          child: desktop
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: identity),
                    const SizedBox(width: 28),
                    SizedBox(width: 320, child: actions),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    identity,
                    const SizedBox(height: 20),
                    actions,
                  ],
                ),
        );
      },
    );
  }
}

class _OverviewIdentity extends StatelessWidget {
  const _OverviewIdentity({required this.device, this.onWatchStatus});

  final Device device;
  final VoidCallback? onWatchStatus;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final phase = device.connectivityPhase();
    final connectionLabel = switch (phase) {
      DeviceConnectivityPhase.live => 'Watch connected',
      DeviceConnectivityPhase.reconnecting => 'Watch reconnecting',
      DeviceConnectivityPhase.offline => 'Watch offline',
    };
    final connectionIcon = switch (phase) {
      DeviceConnectivityPhase.live => Icons.sensors_rounded,
      DeviceConnectivityPhase.reconnecting => Icons.sync_rounded,
      DeviceConnectivityPhase.offline => Icons.sensors_off_rounded,
    };
    final connectionColor = switch (phase) {
      DeviceConnectivityPhase.live =>
        dark ? colors.accent : GuardianColors.safeText,
      DeviceConnectivityPhase.reconnecting =>
        dark ? GuardianColors.warning : GuardianColors.warningText,
      DeviceConnectivityPhase.offline => colors.textSecondary,
    };
    final careProfile = device.careProfile?.trim();
    final profileLabel = careProfile == null || careProfile.isEmpty
        ? 'Family member'
        : GuardianCareProfileX.fromValue(careProfile).label;

    final status = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(connectionIcon, size: 18, color: connectionColor),
        const SizedBox(width: 8),
        Flexible(
          child: Text(
            connectionLabel,
            style: textTheme.bodyMedium?.copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: colors.textPrimary,
            ),
          ),
        ),
        if (onWatchStatus != null) ...[
          const SizedBox(width: 4),
          Icon(Icons.chevron_right_rounded, size: 18, color: colors.textSecondary),
        ],
      ],
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            ExcludeSemantics(
              child: AvatarBubble(
                initials: initialsFor(device.displayName),
                color: colors.accent,
                size: 64,
                ringWidth: 1,
                imageUrl: device.avatarUrl,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    device.displayName,
                    style: textTheme.headlineSmall?.copyWith(
                      fontSize: 28,
                      height: 1.2,
                      letterSpacing: -0.6,
                      color: colors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    profileLabel,
                    style: textTheme.bodyMedium?.copyWith(
                      fontSize: 14,
                      color: colors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        if (onWatchStatus == null)
          ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Align(alignment: Alignment.centerLeft, child: status),
          )
        else
          Tooltip(
            message: 'View watch status',
            child: TextButton(
              onPressed: onWatchStatus,
              style: TextButton.styleFrom(
                minimumSize: const Size(48, 48),
                padding: EdgeInsets.zero,
                alignment: Alignment.centerLeft,
                foregroundColor: colors.textPrimary,
                tapTargetSize: MaterialTapTargetSize.padded,
              ),
              child: status,
            ),
          ),
        Text(
          deviceWatchCheckInLabel(device),
          style: textTheme.bodyMedium?.copyWith(
            fontSize: 14,
            color: colors.textSecondary,
          ),
        ),
        const SizedBox(height: 8),
        _OverviewBattery(device: device, phase: phase),
      ],
    );
  }
}

class _OverviewBattery extends StatelessWidget {
  const _OverviewBattery({required this.device, required this.phase});

  final Device device;
  final DeviceConnectivityPhase phase;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final battery = device.batteryPercent;
    final batteryAt = device.batteryUpdatedAt;
    final age = batteryAt == null ? null : DateTime.now().difference(batteryAt);
    final lastKnown = phase != DeviceConnectivityPhase.live ||
        age == null ||
        age > deviceTelemetryFreshness ||
        age < const Duration(minutes: -1);
    final label = battery == null
        ? 'Battery unavailable'
        : 'Battery $battery%${lastKnown ? ' · last known' : ''}';
    final color = battery == null || battery > 30
        ? colors.textSecondary
        : battery <= 15
        ? (dark ? const Color(0xFFFF8F95) : GuardianColors.dangerText)
        : (dark ? GuardianColors.warning : GuardianColors.warningText);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 1),
          child: Icon(
            battery == null
                ? Icons.battery_unknown_rounded
                : battery <= 15
                ? Icons.battery_alert_rounded
                : Icons.battery_std_rounded,
            size: 18,
            color: color,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ),
      ],
    );
  }
}

class _OverviewActions extends StatelessWidget {
  const _OverviewActions({
    required this.helpEnabled,
    this.onCall,
    this.onJourney,
    this.onHelp,
  });

  final bool helpEnabled;
  final VoidCallback? onCall;
  final VoidCallback? onJourney;
  final VoidCallback? onHelp;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(12));
    final textStyle = Theme.of(context).textTheme.titleMedium?.copyWith(
      fontSize: 14,
      fontWeight: FontWeight.w700,
    );
    final secondaryStyle = OutlinedButton.styleFrom(
      foregroundColor: colors.textPrimary,
      disabledForegroundColor: colors.textSecondary,
      minimumSize: const Size(48, 52),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
      side: BorderSide(color: colors.border),
      shape: shape,
      textStyle: textStyle,
      tapTargetSize: MaterialTapTargetSize.padded,
    );
    final journey = OutlinedButton(
      onPressed: onJourney,
      style: secondaryStyle,
      child: const _ActionLabel(icon: Icons.route_rounded, label: 'View journey'),
    );
    final help = Tooltip(
      message: helpEnabled ? 'Open Guardian help' : 'Guardian help requires a Family plan',
      child: OutlinedButton(
        onPressed: onHelp,
        style: secondaryStyle,
        child: _ActionLabel(
          icon: helpEnabled ? Icons.chat_bubble_outline_rounded : Icons.lock_outline_rounded,
          label: 'Guardian help',
        ),
      ),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          onPressed: onCall,
          style: FilledButton.styleFrom(
            backgroundColor: GuardianColors.forest,
            foregroundColor: Colors.white,
            disabledBackgroundColor: colors.surfaceMuted,
            disabledForegroundColor: colors.textSecondary,
            minimumSize: const Size(48, 52),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            shape: shape,
            textStyle: textStyle,
            tapTargetSize: MaterialTapTargetSize.padded,
          ),
          child: const _ActionLabel(icon: Icons.call_rounded, label: 'Call watch'),
        ),
        const SizedBox(height: 10),
        if (textScale > 1.25)
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [journey, const SizedBox(height: 10), help],
          )
        else
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: journey),
                const SizedBox(width: 10),
                Expanded(child: help),
              ],
            ),
          ),
      ],
    );
  }
}

class _ActionLabel extends StatelessWidget {
  const _ActionLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18),
        const SizedBox(width: 6),
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
  }
}
