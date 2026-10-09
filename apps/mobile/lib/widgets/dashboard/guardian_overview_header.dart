import 'package:flutter/material.dart';

import '../cards/guardian_surface.dart';
import '../../dashboard/device_connectivity.dart';
import '../../dashboard/device_formatters.dart';
import '../../models/care_profile.dart';
import '../../models/device.dart';
import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';
import 'profile_weather_panel.dart';
import 'dashboard_action_style.dart';

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
    this.watchCheckStatus,
    this.weather,
    this.photoAction,
    this.voiceAction,
  });

  final Device device;
  final bool helpEnabled;
  final VoidCallback? onCall;
  final VoidCallback? onJourney;
  final VoidCallback? onHelp;
  final VoidCallback? onWatchStatus;
  final Widget? watchCheckStatus;
  final Widget? weather;
  final Widget? photoAction;
  final Widget? voiceAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return GuardianSurface(
      radius: 24,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _OverviewIdentity(device: device, onWatchStatus: onWatchStatus),
          if (device.allowsShared('location')) ...[
            const SizedBox(height: 18),
            weather ?? const ProfileWeatherPanel(),
          ],
          const SizedBox(height: 12),
          _OverviewWatchState(device: device, onWatchStatus: onWatchStatus),
          ?watchCheckStatus,
          Divider(height: 24, color: colors.border),
          _OverviewActions(onCall: onCall, onJourney: onJourney),
          ?voiceAction,
          if (photoAction != null) ...[
            const SizedBox(height: 10),
            photoAction!,
          ],
        ],
      ),
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
    final careProfile = device.careProfile?.trim();
    final profileLabel = careProfile == null || careProfile.isEmpty
        ? 'Family member'
        : GuardianCareProfileX.fromValue(careProfile).label;
    final profile = Row(
      children: [
        ExcludeSemantics(
          child: AvatarBubble(
            initials: initialsFor(device.displayName).characters.first,
            color: colors.accent,
            size: 50,
            ringWidth: 4,
            filled: true,
            imageUrl: device.avatarUrl,
          ),
        ),
        const SizedBox(width: 13),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                device.displayName,
                style: TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w600,
                  height: 1.25,
                  letterSpacing: -.4,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 3),
              Text(
                profileLabel,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 13,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) {
        final badge = InkWell(
          onTap: onWatchStatus,
          borderRadius: BorderRadius.circular(9),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Align(
              widthFactor: 1,
              heightFactor: 1,
              child: _ConnectionBadge(device: device),
            ),
          ),
        );
        if (constraints.maxWidth < 290 ||
            MediaQuery.textScalerOf(context).scale(14) > 18) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [profile, const SizedBox(height: 12), badge],
          );
        }
        return Row(
          children: [
            Expanded(child: profile),
            const SizedBox(width: 8),
            badge,
          ],
        );
      },
    );
  }
}

class _ConnectionBadge extends StatelessWidget {
  const _ConnectionBadge({required this.device});
  final Device device;
  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final phase = device.connectivityPhase();
    final dark = Theme.of(context).brightness == Brightness.dark;
    final (label, icon, tone) = switch (phase) {
      DeviceConnectivityPhase.live => (
        'Connected',
        Icons.check_rounded,
        colors.safe,
      ),
      DeviceConnectivityPhase.reconnecting => (
        'Reconnecting',
        Icons.sync_rounded,
        dark ? GuardianColors.warning : GuardianColors.warningText,
      ),
      DeviceConnectivityPhase.offline => (
        'Offline',
        Icons.sensors_off_outlined,
        colors.textSecondary,
      ),
    };
    return Semantics(
      label: 'Watch ${label.toLowerCase()}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: Color.alphaBlend(tone.withValues(alpha: .10), colors.surface),
          borderRadius: BorderRadius.circular(9),
          border: colors.highContrast ? Border.all(color: tone) : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 15, color: tone),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w500,
                color: tone,
              ),
            ),
          ],
        ),
      ),
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
    final connectionIcon = switch (phase) {
      DeviceConnectivityPhase.live => Icons.circle,
      DeviceConnectivityPhase.reconnecting => Icons.sync_rounded,
      DeviceConnectivityPhase.offline => Icons.sensors_off_rounded,
    };
    final connectionColor = switch (phase) {
      DeviceConnectivityPhase.live => colors.safe,
      DeviceConnectivityPhase.reconnecting =>
        dark ? GuardianColors.warning : GuardianColors.warningText,
      DeviceConnectivityPhase.offline => colors.textSecondary,
    };
    final statusContent = Row(
      children: [
        Icon(
          connectionIcon,
          size: phase == DeviceConnectivityPhase.live ? 8 : 16,
          color: connectionColor,
        ),
        const SizedBox(width: 9),
        Expanded(
          child: Text(
            deviceWatchCheckInLabel(
              device,
            ).replaceFirst('Watch checked in', 'Checked in'),
            style: textTheme.bodyMedium?.copyWith(
              fontSize: 13,
              color: colors.textPrimary,
            ),
          ),
        ),
      ],
    );
    final status = onWatchStatus == null
        ? ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Align(alignment: Alignment.centerLeft, child: statusContent),
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
        if (constraints.maxWidth < 260 || textScale > 1.25) {
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
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ),
      ],
    );
  }
}

class _OverviewActions extends StatelessWidget {
  const _OverviewActions({this.onCall, this.onJourney});

  final VoidCallback? onCall;
  final VoidCallback? onJourney;

  @override
  Widget build(BuildContext context) {
    final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
    final secondaryStyle = dashboardSecondaryActionStyle(context);
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
      style: GuardianControlStyles.primary(context).copyWith(
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 10, vertical: 12),
        ),
      ),
      child: const _ActionLabel(icon: Icons.call_outlined, label: 'Call watch'),
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
              const SizedBox(width: 10),
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
