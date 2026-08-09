import 'package:flutter/material.dart';

import '../../models/device.dart';
import '../../theme/app_theme.dart';

/// Guardian Now hero section — premium status summary matching image 2 design.
///
/// Shows: circular avatar + name + location, status chips (Connected, GPS, Battery, Signal),
/// Dodo illustration, Guardian AI card, and 3 action buttons (Call, View location, Ask Guardian).
class GuardianNowHero extends StatelessWidget {
  const GuardianNowHero({
    required this.device,
    required this.aiInterpretation,
    this.onCall,
    this.onViewLocation,
    this.onAskGuardian,
    super.key,
  });

  final Device? device;
  final String aiInterpretation;
  final VoidCallback? onCall;
  final VoidCallback? onViewLocation;
  final VoidCallback? onAskGuardian;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final textTheme = Theme.of(context).textTheme;

    if (device == null) {
      return Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          color: colors.surface,
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.3),
            width: 1,
          ),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
        child: Center(
          child: Column(
            children: [
              Text(
                'No watch linked',
                style: textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Link a device to see its status',
                style: textTheme.bodyMedium?.copyWith(
                  color: colors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      );
    }

    final d = device!;
    final isLive = d.connectionState == 'live';
    final displayName = d.displayName;
    final hasLocation = d.hasFreshLocation || d.hasApproximateLocation;
    final locationText = hasLocation ? 'Current location' : 'Locating...';

    final battery = d.batteryPercent ?? 0;
    final lastUpdate = d.lastHeartbeatAt;
    String updateText;
    if (lastUpdate == null) {
      updateText = 'Never connected';
    } else {
      final now = DateTime.now();
      final diff = now.difference(lastUpdate);
      if (diff.inMinutes < 1) {
        updateText = 'Updated just now';
      } else if (diff.inMinutes < 60) {
        updateText = 'Updated ${diff.inMinutes}m ago';
      } else if (diff.inHours < 24) {
        updateText = 'Updated ${diff.inHours}h ago';
      } else {
        updateText = 'Updated ${diff.inDays}d ago';
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Hero header: Avatar + Info + AI Summary
        Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            color: colors.surface,
            boxShadow: [
              BoxShadow(
                color: GuardianColors.forest.withValues(alpha: 0.06),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top row: Avatar + Info + Dodo + AI Card
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Avatar with live indicator
                  Stack(
                    children: [
                      Container(
                        width: 80,
                        height: 80,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: GuardianColors.accent.withValues(alpha: 0.1),
                          border: Border.all(
                            color: GuardianColors.accent,
                            width: 2,
                          ),
                        ),
                        child: ClipOval(
                          child: d.avatarUrl != null && d.avatarUrl!.isNotEmpty
                              ? Image.network(
                                  d.avatarUrl!,
                                  fit: BoxFit.cover,
                                  errorBuilder: (context, error, stackTrace) =>
                                      _AvatarFallback(
                                    displayName: displayName,
                                    textTheme: textTheme,
                                  ),
                                )
                              : _AvatarFallback(
                                  displayName: displayName,
                                  textTheme: textTheme,
                                ),
                        ),
                      ),
                      if (isLive)
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: Container(
                            width: 24,
                            height: 24,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: GuardianColors.safe,
                              border: Border.all(
                                color: colors.surface,
                                width: 2,
                              ),
                            ),
                            child: const Icon(
                              Icons.check,
                              size: 14,
                              color: Colors.white,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(width: 16),
                  // Center: Name, Location, Updated
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          style: textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: colors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Row(
                          children: [
                            Icon(
                              Icons.location_on,
                              size: 14,
                              color: GuardianColors.accent,
                            ),
                            const SizedBox(width: 4),
                            Expanded(
                              child: Text(
                                locationText,
                                style: textTheme.bodySmall?.copyWith(
                                  color: colors.textSecondary,
                                ),
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          updateText,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 12),
                  // Right: Dodo illustration placeholder + AI summary
                  SizedBox(
                    width: 140,
                    child: Column(
                      children: [
                        // Dodo icon
                        Container(
                          width: 60,
                          height: 60,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(12),
                            color: const Color(0xFF8058BE).withValues(alpha: 0.1),
                          ),
                          child: const Icon(
                            Icons.auto_awesome_rounded,
                            size: 32,
                            color: Color(0xFF8058BE),
                          ),
                        ),
                        const SizedBox(height: 8),
                        // AI summary
                        Text(
                          'Guardian AI',
                          style: textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: const Color(0xFF8058BE),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          aiInterpretation,
                          style: textTheme.bodySmall?.copyWith(
                            color: colors.textPrimary,
                            height: 1.3,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              // Status chips row: Connected, GPS, Battery, Signal
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    _StatusChip(
                      icon: Icons.wifi_rounded,
                      label: 'Connected',
                      color: isLive ? GuardianColors.safe : colors.textMuted,
                    ),
                    const SizedBox(width: 8),
                    _StatusChip(
                      icon: Icons.location_on_rounded,
                      label: 'GPS',
                      color: d.positioningDescription != null
                          ? GuardianColors.accent
                          : colors.textMuted,
                    ),
                    const SizedBox(width: 8),
                    _StatusChip(
                      icon: Icons.battery_full_rounded,
                      label: '$battery%',
                      color: battery > 40
                          ? GuardianColors.safe
                          : (battery > 20 ? GuardianColors.warning : Colors.red),
                    ),
                    const SizedBox(width: 8),
                    _StatusChip(
                      icon: Icons.signal_cellular_alt_rounded,
                      label: 'Good',
                      color: isLive ? GuardianColors.safe : colors.textMuted,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        // Action buttons row
        Row(
          children: [
            Expanded(
              child: _ActionButton(
                icon: Icons.call_rounded,
                label: 'Call watch',
                subtitle: 'Speak instantly',
                color: GuardianColors.safe,
                onTap: onCall ?? () {},
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ActionButton(
                icon: Icons.location_on_rounded,
                label: 'View location',
                subtitle: 'Open live map',
                color: GuardianColors.accent,
                onTap: onViewLocation ?? () {},
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ActionButton(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Ask Guardian',
                subtitle: 'On WhatsApp',
                color: GuardianColors.whatsapp,
                onTap: onAskGuardian ?? () {},
              ),
            ),
          ],
        ),
      ],
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
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(8),
        color: color.withValues(alpha: 0.1),
        border: Border.all(color: color.withValues(alpha: 0.2), width: 1),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: color,
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
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 12),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: color.withValues(alpha: 0.2),
              width: 1,
            ),
          ),
          child: Column(
            children: [
              Icon(icon, size: 24, color: color),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: TextStyle(
                  fontSize: 10,
                  color: color.withValues(alpha: 0.7),
                ),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AvatarFallback extends StatelessWidget {
  const _AvatarFallback({
    required this.displayName,
    required this.textTheme,
  });

  final String displayName;
  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        displayName.isNotEmpty ? displayName[0].toUpperCase() : '?',
        style: textTheme.displaySmall?.copyWith(
          color: GuardianColors.accent,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
