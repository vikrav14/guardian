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
          desktop: desktop,
          helpEnabled: helpEnabled,
          onHelp: onHelp,
          onWatchStatus: onWatchStatus,
        );
        final actions = _OverviewActions(
          onCall: onCall,
          onJourney: onJourney,
        );

        return Container(
          padding: EdgeInsets.all(desktop ? 20 : 14),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: colors.border),
          ),
          child: desktop
              ? Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: identity),
                    const SizedBox(width: 28),
                    SizedBox(width: 340, child: actions),
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    identity,
                    Divider(height: 24, color: colors.border),
                    actions,
                  ],
                ),
        );
      },
    );
  }
}

class _OverviewIdentity extends StatelessWidget {
  const _OverviewIdentity({
    required this.device,
    required this.desktop,
    required this.helpEnabled,
    this.onHelp,
    this.onWatchStatus,
  });

  final Device device;
  final bool desktop;
  final bool helpEnabled;
  final VoidCallback? onHelp;
  final VoidCallback? onWatchStatus;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final careProfile = device.careProfile?.trim();
    final profileLabel = careProfile == null || careProfile.isEmpty
        ? 'Family member'
        : GuardianCareProfileX.fromValue(careProfile).label;

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
                size: desktop ? 52 : 48,
                ringWidth: 1,
                imageUrl: device.avatarUrl,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    device.displayName,
                    style: textTheme.headlineSmall?.copyWith(
                      fontSize: desktop ? 22 : 18,
                      fontWeight: FontWeight.w700,
                      height: 1.2,
                      letterSpacing: -0.3,
                      color: colors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 3),
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
            const SizedBox(width: 8),
            Tooltip(
              message: helpEnabled
                  ? 'Open Guardian help'
                  : 'Guardian help requires a Family plan',
              excludeFromSemantics: true,
              child: IconButton(
                onPressed: onHelp,
                constraints: const BoxConstraints(
                  minWidth: 48,
                  minHeight: 48,
                ),
                color: colors.textPrimary,
                icon: Icon(
                  helpEnabled
                      ? Icons.chat_bubble_outline_rounded
                      : Icons.lock_outline_rounded,
                  size: 22,
                  semanticLabel: 'Guardian help',
                ),
              ),
            ),
          ],
        ),
        Divider(height: 24, color: colors.border),
        _OverviewWatchState(device: device, onWatchStatus: onWatchStatus),
      ],
    );
  }
}

class _OverviewWatchState extends StatelessWidget {
  const _OverviewWatchState({required this.device, this.onWatchStatus});

  final Device device;
  final VoidCallback? onWatchStatus;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final phase = device.connectivityPhase();
    final connectionLabel = switch (phase) {
      DeviceConnectivityPhase.live => 'Watch connected',
      DeviceConnectivityPhase.reconnecting => 'Watch reconnecting',
      DeviceConnectivityPhase.offline => 'Watch offline',
    };
    final connectionIcon = switch (phase) {
      DeviceConnectivityPhase.live => Icons.circle,
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
    final statusContent = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            SizedBox(
              width: 18,
              child: Icon(
                connectionIcon,
                size: phase == DeviceConnectivityPhase.live ? 12 : 18,
                color: connectionColor,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                connectionLabel,
                style: textTheme.bodyMedium?.copyWith(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: colors.textPrimary,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 3),
        Padding(
          padding: const EdgeInsets.only(left: 26),
          child: Text(
            deviceWatchCheckInLabel(device).replaceFirst(
              'Watch checked in',
              'Checked in',
            ),
            style: textTheme.bodyMedium?.copyWith(
              fontSize: 14,
              color: colors.textSecondary,
            ),
          ),
        ),
      ],
    );
    final status = onWatchStatus == null
        ? ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Align(
              alignment: Alignment.centerLeft,
              child: statusContent,
            ),
          )
        : Tooltip(
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
              child: statusContent,
            ),
          );
    final batteryAt = device.batteryUpdatedAt;
    final age = batteryAt == null ? null : DateTime.now().difference(batteryAt);
    final batteryLastKnown =
        phase != DeviceConnectivityPhase.live ||
        age == null ||
        age > deviceTelemetryFreshness ||
        age < const Duration(minutes: -1);
    final battery = _OverviewBattery(
      device: device,
      lastKnown: batteryLastKnown,
    );
    final compactBattery = device.batteryPercent != null && !batteryLastKnown;

    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth < 310 || textScale > 1.25) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [status, const SizedBox(height: 10), battery],
          );
        }
        return Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(child: status),
            const SizedBox(width: 12),
            SizedBox(width: compactBattery ? 72 : 112, child: battery),
          ],
        );
      },
    );
  }
}

class _OverviewBattery extends StatelessWidget {
  const _OverviewBattery({required this.device, required this.lastKnown});

  final Device device;
  final bool lastKnown;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final battery = device.batteryPercent;
    final label = battery == null
        ? 'Battery unavailable'
        : 'Battery $battery%${lastKnown ? ' · last known' : ''}';
    final visibleLabel = battery == null || lastKnown ? label : '$battery%';
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
            visibleLabel,
            semanticsLabel: label,
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
    this.onCall,
    this.onJourney,
  });

  final VoidCallback? onCall;
  final VoidCallback? onJourney;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final shape = RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(10),
    );
    final textStyle = Theme.of(context).textTheme.titleMedium?.copyWith(
      fontSize: 14,
      fontWeight: FontWeight.w700,
    );
    final secondaryStyle = OutlinedButton.styleFrom(
      foregroundColor: colors.textPrimary,
      disabledForegroundColor: colors.textSecondary,
      minimumSize: const Size(48, 48),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      side: BorderSide(
        color: Theme.of(context).brightness == Brightness.dark
            ? colors.accent
            : GuardianColors.forest,
      ),
      shape: shape,
      textStyle: textStyle,
      tapTargetSize: MaterialTapTargetSize.padded,
    );
    final journey = OutlinedButton(
      onPressed: onJourney,
      style: secondaryStyle,
      child: const _ActionLabel(
        icon: Icons.route_rounded,
        label: 'View journey',
      ),
    );
    final call = FilledButton(
      onPressed: onCall,
      style: FilledButton.styleFrom(
        backgroundColor: GuardianColors.forest,
        foregroundColor: Colors.white,
        disabledBackgroundColor: colors.surfaceMuted,
        disabledForegroundColor: colors.textSecondary,
        minimumSize: const Size(48, 48),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        shape: shape,
        textStyle: textStyle,
        tapTargetSize: MaterialTapTargetSize.padded,
      ),
      child: const _ActionLabel(
        icon: Icons.call_rounded,
        label: 'Call watch',
      ),
    );

    return LayoutBuilder(
      builder: (context, constraints) {
        if (textScale > 1.25 || constraints.maxWidth < 280) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [call, const SizedBox(height: 10), journey],
          );
        }
        return IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: call),
              const SizedBox(width: 8),
              Expanded(child: journey),
            ],
          ),
        );
      },
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
