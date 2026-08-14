import 'package:flutter/material.dart';

import '../../dashboard/device_connectivity.dart';
import '../../dashboard/device_formatters.dart';
import '../../models/device.dart';
import '../../theme/app_theme.dart';
import 'dodo_stage.dart';

/// Guardian Now hero — person first, then interpreted safety context.
/// Uses real watch/avatar data and keeps the Dodo as Guardian's personality.
class GuardianNowHero extends StatelessWidget {
  const GuardianNowHero({
    required this.device,
    required this.aiInterpretation,
    required this.guardianAiEnabled,
    required this.askGuardianEnabled,
    this.onCall,
    this.onViewLocation,
    this.onAskGuardian,
    super.key,
  });

  final Device? device;
  final String aiInterpretation;
  final bool guardianAiEnabled;
  final bool askGuardianEnabled;
  final VoidCallback? onCall;
  final VoidCallback? onViewLocation;
  final VoidCallback? onAskGuardian;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    if (device == null) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 44),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(28),
          border: Border.all(color: colors.border),
        ),
        child: Column(
          children: [
            const Icon(
              Icons.watch_outlined,
              size: 34,
              color: GuardianColors.safe,
            ),
            const SizedBox(height: 12),
            Text(
              'No watch linked',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: colors.textPrimary,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              'Link a Guardian watch to start live family safety.',
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: colors.textSecondary),
            ),
          ],
        ),
      );
    }

    final d = device!;
    final live = d.isLiveConnected;
    final battery = d.batteryPercent;
    final locationLabel = _locationLabel(d);
    final updateLabel = deviceWatchCheckInLabel(d);
    final gpsLabel = d.hasApproximateLocation
        ? 'Approx.'
        : d.hasFreshLocation
        ? 'GPS'
        : d.location?.isValid == true
        ? 'Last GPS fix'
        : 'Locating';

    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(28),
        border: Border.all(color: Colors.white.withValues(alpha: 0.9)),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.08),
            blurRadius: 34,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final desktop = constraints.maxWidth >= 840;

          final identity = _IdentityBlock(
            device: d,
            locationLabel: locationLabel,
            updateLabel: updateLabel,
            live: live,
          );

          const dodo = SizedBox(
            width: 146,
            height: 146,
            child: GuardianDodoStageImage(action: DodoStageAction.idle),
          );

          final interpretation = guardianAiEnabled
              ? _AiCard(message: aiInterpretation)
              : _WatchStatusCard(device: d);

          final status = Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _StatusChip(
                icon: Icons.sensors_rounded,
                label: live ? 'Connected' : 'Offline',
                color: live ? GuardianColors.safe : GuardianColors.warning,
              ),
              _StatusChip(
                icon: Icons.location_on_rounded,
                label: gpsLabel,
                color: GuardianColors.accent,
              ),
              _StatusChip(
                icon: Icons.battery_5_bar_rounded,
                label: battery == null ? 'Battery —' : '$battery%',
                color: battery == null
                    ? colors.textMuted
                    : battery <= 20
                    ? Colors.red
                    : battery <= 40
                    ? GuardianColors.warning
                    : const Color(0xFFD19B16),
              ),
              _StatusChip(
                icon: Icons.signal_cellular_alt_rounded,
                label: live ? 'Signal good' : 'No signal',
                color: live ? GuardianColors.safe : colors.textMuted,
              ),
            ],
          );

          final actions = Row(
            children: [
              Expanded(
                child: _ActionButton(
                  icon: Icons.call_rounded,
                  label: 'Call watch',
                  subtitle: 'Speak instantly',
                  color: GuardianColors.safe,
                  onTap: onCall,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  icon: Icons.route_rounded,
                  label: 'View journey',
                  subtitle: 'See movement history',
                  color: GuardianColors.accent,
                  onTap: onViewLocation,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _ActionButton(
                  icon: askGuardianEnabled
                      ? Icons.chat_bubble_outline_rounded
                      : Icons.lock_outline_rounded,
                  label: 'Guardian help',
                  subtitle: askGuardianEnabled
                      ? 'Quick checks & WhatsApp'
                      : 'Family plan required',
                  color: GuardianColors.whatsapp,
                  onTap: onAskGuardian,
                  locked: !askGuardianEnabled,
                ),
              ),
            ],
          );

          if (!desktop) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                identity,
                const SizedBox(height: 16),
                status,
                const SizedBox(height: 18),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Expanded(child: interpretation),
                    const SizedBox(width: 8),
                    dodo,
                  ],
                ),
                const SizedBox(height: 18),
                actions,
              ],
            );
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Expanded(flex: 12, child: identity),
                  const SizedBox(width: 16),
                  dodo,
                  const SizedBox(width: 16),
                  Expanded(flex: 9, child: interpretation),
                ],
              ),
              const SizedBox(height: 14),
              Padding(padding: const EdgeInsets.only(left: 112), child: status),
              const SizedBox(height: 18),
              actions,
            ],
          );
        },
      ),
    );
  }

  static String _locationLabel(Device device) {
    final place = device.location?.placeLabel?.trim();
    if (place != null && place.isNotEmpty) return place;
    if (device.hasApproximateLocation) return 'Approximate location';
    if (device.hasFreshLocation) return 'Location confirmed';
    if (device.location?.isValid == true) return 'Last known location';
    return 'Locating…';
  }
}

class _IdentityBlock extends StatelessWidget {
  const _IdentityBlock({
    required this.device,
    required this.locationLabel,
    required this.updateLabel,
    required this.live,
  });

  final Device device;
  final String locationLabel;
  final String updateLabel;
  final bool live;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      children: [
        Stack(
          clipBehavior: Clip.none,
          children: [
            Container(
              width: 92,
              height: 92,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: GuardianColors.safe.withValues(alpha: 0.08),
                border: Border.all(
                  color: GuardianColors.safe.withValues(alpha: 0.5),
                  width: 2,
                ),
              ),
              child: ClipOval(
                child: device.avatarUrl?.trim().isNotEmpty == true
                    ? Image.network(
                        device.avatarUrl!,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            _AvatarFallback(name: device.displayName),
                      )
                    : _AvatarFallback(name: device.displayName),
              ),
            ),
            Positioned(
              top: -4,
              left: -6,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: live
                      ? GuardianColors.safeBg
                      : GuardianColors.warningBg,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(
                  live ? '● LIVE' : '● OFFLINE',
                  style: TextStyle(
                    color: live ? GuardianColors.safe : GuardianColors.warning,
                    fontSize: 8,
                    fontWeight: FontWeight.w900,
                    letterSpacing: .6,
                  ),
                ),
              ),
            ),
            if (live)
              Positioned(
                bottom: 1,
                right: 0,
                child: Container(
                  width: 27,
                  height: 27,
                  decoration: BoxDecoration(
                    color: GuardianColors.safe,
                    shape: BoxShape.circle,
                    border: Border.all(color: colors.surface, width: 3),
                  ),
                  child: const Icon(
                    Icons.location_on_rounded,
                    size: 14,
                    color: Colors.white,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(width: 20),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                device.displayName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 28,
                  height: 1,
                  fontWeight: FontWeight.w800,
                  letterSpacing: -0.8,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  const Icon(
                    Icons.location_on_outlined,
                    size: 16,
                    color: GuardianColors.safe,
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      locationLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 7),
              Row(
                children: [
                  Icon(
                    Icons.schedule_rounded,
                    size: 14,
                    color: colors.textMuted,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    updateLabel,
                    style: TextStyle(color: colors.textSecondary, fontSize: 11),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AiCard extends StatelessWidget {
  const _AiCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      constraints: const BoxConstraints(minHeight: 130),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFF6F0FF),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFF8058BE).withValues(alpha: 0.16),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Row(
            children: [
              Icon(
                Icons.auto_awesome_rounded,
                size: 16,
                color: Color(0xFF8058BE),
              ),
              SizedBox(width: 7),
              Text(
                'Guardian AI',
                style: TextStyle(
                  color: Color(0xFF6D3FB0),
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            message,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 13,
              height: 1.45,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _WatchStatusCard extends StatelessWidget {
  const _WatchStatusCard({required this.device});

  final Device device;

  String get _message {
    final battery = device.batteryPercent;
    if (battery != null && battery < 15) {
      return 'Battery is critically low. Charge the watch soon.';
    }
    if (device.isTrulyOffline) {
      return 'Watch offline. The map is showing the last known location.';
    }
    if (device.isReconnecting) {
      return 'Watch reconnecting. Waiting for a fresh update.';
    }
    if (!device.hasFreshLocation && !device.hasApproximateLocation) {
      return 'Watch connected. Waiting for a fresh location fix.';
    }
    return 'Watch connected. Location and battery status are available.';
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      constraints: const BoxConstraints(minHeight: 130),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: GuardianColors.safe.withValues(alpha: 0.055),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: GuardianColors.safe.withValues(alpha: 0.16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Row(
            children: [
              Icon(Icons.watch_outlined, size: 16, color: GuardianColors.safe),
              SizedBox(width: 7),
              Text(
                'Watch status',
                style: TextStyle(
                  color: GuardianColors.safe,
                  fontSize: 13,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            _message,
            maxLines: 4,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: colors.textPrimary,
              fontSize: 13,
              height: 1.45,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.icon,
    required this.label,
    required this.color,
  });

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.09),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withValues(alpha: 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              color: color,
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.onTap,
    this.locked = false,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final VoidCallback? onTap;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    final enabled = onTap != null;
    final actionColor = locked ? context.guardianColors.textMuted : color;
    return Material(
      color: enabled ? actionColor.withValues(alpha: 0.08) : Colors.black12,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          constraints: const BoxConstraints(minHeight: 64),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: enabled
                  ? actionColor.withValues(alpha: 0.12)
                  : Colors.transparent,
            ),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 22, color: enabled ? actionColor : Colors.grey),
              const SizedBox(width: 10),
              Flexible(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: enabled ? actionColor : Colors.grey,
                        fontSize: 12,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: enabled
                            ? actionColor.withValues(alpha: 0.72)
                            : Colors.grey,
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvatarFallback extends StatelessWidget {
  const _AvatarFallback({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        name.trim().isEmpty ? '?' : name.trim()[0].toUpperCase(),
        style: const TextStyle(
          color: GuardianColors.safe,
          fontSize: 30,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}
