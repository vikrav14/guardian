import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../theme/app_theme.dart';
import '../../widgets/guardian_widgets.dart';

/// Formats the selected date consistently across the Journey experience.
String formatJourneyHeaderDate(DateTime day) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final target = DateTime(day.year, day.month, day.day);
  final diff = target.difference(today).inDays;
  final datePart = DateFormat('MMM d, y').format(day);

  return switch (diff) {
    0 => 'Today, $datePart',
    -1 => 'Yesterday, $datePart',
    1 => 'Tomorrow, $datePart',
    _ => '${DateFormat.EEEE().format(day)}, $datePart',
  };
}

class JourneyHeader extends StatelessWidget {
  const JourneyHeader({
    super.key,
    required this.deviceName,
    required this.imei,
    required this.selectedDay,
    required this.isOnline,
    required this.onBack,
    required this.onDateTap,
    required this.onShare,
    required this.onCompare,
    required this.onSettings,
    this.avatarUrl,
    this.compareActive = false,
  });

  final String deviceName;
  final String imei;
  final String? avatarUrl;
  final DateTime selectedDay;
  final bool isOnline;
  final bool compareActive;
  final VoidCallback onBack;
  final VoidCallback onDateTap;
  final VoidCallback onShare;
  final VoidCallback onCompare;
  final VoidCallback onSettings;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 620;
    final showDirectActions = width >= 820;

    return Material(
      color: GuardianColors.ivory.withValues(alpha: 0.96),
      child: SafeArea(
        bottom: false,
        child: Container(
          height: compact ? 76 : 84,
          padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 24),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: colors.border)),
          ),
          child: Row(
            children: [
              _HeaderIconButton(
                tooltip: 'Back to Home',
                icon: Icons.arrow_back_rounded,
                onTap: onBack,
              ),
              SizedBox(width: compact ? 5 : 10),
              AvatarBubble(
                initials: initialsFor(deviceName),
                color: avatarColorForKey(imei),
                size: compact ? 38 : 42,
                imageUrl: avatarUrl,
              ),
              SizedBox(width: compact ? 8 : 11),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      deviceName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontSize: compact ? 17 : 20,
                        height: 1,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.35,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Row(
                      children: [
                        Text(
                          'Journeys',
                          style: TextStyle(
                            color: colors.textSecondary,
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: 7),
                        Container(
                          width: 4,
                          height: 4,
                          decoration: BoxDecoration(
                            color: colors.border,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 7),
                        _OnlineStatus(isOnline: isOnline),
                      ],
                    ),
                  ],
                ),
              ),
              SizedBox(width: compact ? 5 : 14),
              _DatePickerButton(
                label: compact
                    ? _compactDateLabel(selectedDay)
                    : formatJourneyHeaderDate(selectedDay),
                compact: compact,
                onTap: onDateTap,
              ),
              if (showDirectActions) ...[
                const SizedBox(width: 8),
                _HeaderIconButton(
                  tooltip: 'Share journey',
                  icon: Icons.ios_share_rounded,
                  onTap: onShare,
                ),
                const SizedBox(width: 6),
                _HeaderIconButton(
                  tooltip: compareActive
                      ? 'Exit comparison'
                      : 'Compare journeys',
                  icon: Icons.compare_arrows_rounded,
                  active: compareActive,
                  onTap: onCompare,
                ),
              ],
              PopupMenuButton<String>(
                tooltip: 'Journey options',
                icon: Icon(
                  Icons.more_horiz_rounded,
                  color: colors.textPrimary,
                  size: 21,
                ),
                color: colors.surface,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
                onSelected: (value) {
                  switch (value) {
                    case 'share':
                      onShare();
                    case 'compare':
                      onCompare();
                    case 'settings':
                      onSettings();
                  }
                },
                itemBuilder: (context) => [
                  if (!showDirectActions)
                    const PopupMenuItem(
                      value: 'share',
                      child: _MenuLabel(
                        icon: Icons.ios_share_rounded,
                        label: 'Share journey',
                      ),
                    ),
                  if (!showDirectActions)
                    PopupMenuItem(
                      value: 'compare',
                      child: _MenuLabel(
                        icon: Icons.compare_arrows_rounded,
                        label: compareActive
                            ? 'Exit comparison'
                            : 'Compare days',
                      ),
                    ),
                  const PopupMenuItem(
                    value: 'settings',
                    child: _MenuLabel(
                      icon: Icons.tune_rounded,
                      label: 'Journey settings',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _compactDateLabel(DateTime day) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(day.year, day.month, day.day);
    final diff = target.difference(today).inDays;
    final prefix = switch (diff) {
      0 => 'Today',
      -1 => 'Yesterday',
      _ => DateFormat.E().format(day),
    };
    return '$prefix · ${DateFormat.MMMd().format(day)}';
  }
}

class _OnlineStatus extends StatelessWidget {
  const _OnlineStatus({required this.isOnline});

  final bool isOnline;

  @override
  Widget build(BuildContext context) {
    final color = isOnline
        ? GuardianColors.safe
        : context.guardianColors.textMuted;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 6,
          height: 6,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Text(
          isOnline ? 'Online' : 'Offline',
          style: TextStyle(
            color: color,
            fontSize: 9,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _DatePickerButton extends StatelessWidget {
  const _DatePickerButton({
    required this.label,
    required this.compact,
    required this.onTap,
  });

  final String label;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Material(
      color: colors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          constraints: BoxConstraints(maxWidth: compact ? 128 : 220),
          height: compact ? 38 : 42,
          padding: EdgeInsets.symmetric(horizontal: compact ? 9 : 12),
          decoration: BoxDecoration(
            border: Border.all(color: colors.border),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.calendar_month_outlined,
                color: GuardianColors.safe,
                size: compact ? 16 : 18,
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: compact ? 9 : 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              const SizedBox(width: 3),
              Icon(
                Icons.keyboard_arrow_down_rounded,
                color: colors.textMuted,
                size: 17,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.tooltip,
    required this.icon,
    required this.onTap,
    this.active = false,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Tooltip(
      message: tooltip,
      child: Material(
        color: active ? GuardianColors.safeBg : colors.surface,
        borderRadius: BorderRadius.circular(13),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(13),
          child: Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              border: Border.all(
                color: active ? GuardianColors.safe : colors.border,
              ),
              borderRadius: BorderRadius.circular(13),
            ),
            child: Icon(
              icon,
              size: 19,
              color: active ? GuardianColors.safe : colors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

class _MenuLabel extends StatelessWidget {
  const _MenuLabel({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      children: [
        Icon(icon, size: 18, color: colors.textSecondary),
        const SizedBox(width: 10),
        Text(
          label,
          style: TextStyle(
            color: colors.textPrimary,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
