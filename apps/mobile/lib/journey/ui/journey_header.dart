import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../theme/app_theme.dart';
import '../../widgets/guardian_widgets.dart';
import 'journey_screen_theme.dart';

/// Formats the center date label, e.g. "Yesterday, Jul 22, 2026".
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

/// 72px top bar: back, avatar, name, online pill, date picker, overflow menu.
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
    final initials = initialsFor(deviceName);
    final avatarColor = avatarColorForKey(imei);
    final dateLabel = formatJourneyHeaderDate(selectedDay);
    final isWide = MediaQuery.sizeOf(context).width >= 600;

    return Container(
      height: JourneyScreenTheme.headerHeight,
      decoration: BoxDecoration(
        color: const Color(0xFFFBFAF6),
        border: Border(
          bottom: BorderSide(color: JourneyScreenTheme.cardBorder),
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: JourneyScreenTheme.spacing),
      child: Row(
        children: [
          IconButton(
            tooltip: 'Back',
            onPressed: onBack,
            icon: const Icon(
              Icons.arrow_back_rounded,
              color: JourneyScreenTheme.textPrimary,
            ),
            constraints: const BoxConstraints(
              minWidth: JourneyScreenTheme.minTouchTarget,
              minHeight: JourneyScreenTheme.minTouchTarget,
            ),
          ),
          AvatarBubble(
            initials: initials,
            color: avatarColor,
            size: 36,
            imageUrl: avatarUrl,
          ),
          const SizedBox(width: JourneyScreenTheme.spacing),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  deviceName,
                  style: JourneyScreenTheme.textStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                _OnlinePill(isOnline: isOnline),
              ],
            ),
          ),
          if (isWide) ...[
            const Spacer(),
            _DatePickerButton(label: dateLabel, onTap: onDateTap),
            const Spacer(),
          ] else
            Expanded(
              child: Center(
                child: _DatePickerButton(label: dateLabel, onTap: onDateTap),
              ),
            ),
          PopupMenuButton<String>(
            tooltip: 'More',
            icon: const Icon(Icons.more_vert_rounded, color: JourneyScreenTheme.textPrimary),
            color: Colors.white,
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
              PopupMenuItem(
                value: 'share',
                child: Text('Share journey', style: JourneyScreenTheme.textStyle(fontSize: 14)),
              ),
              PopupMenuItem(
                value: 'compare',
                child: Row(
                  children: [
                    Text(
                      compareActive ? 'Exit compare' : 'Compare days',
                      style: JourneyScreenTheme.textStyle(fontSize: 14),
                    ),
                    if (compareActive) ...[
                      const Spacer(),
                      const Icon(Icons.check_rounded, size: 16, color: JourneyScreenTheme.accent),
                    ],
                  ],
                ),
              ),
              PopupMenuItem(
                value: 'settings',
                child: Text('Journey settings', style: JourneyScreenTheme.textStyle(fontSize: 14)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OnlinePill extends StatelessWidget {
  const _OnlinePill({required this.isOnline});

  final bool isOnline;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: (isOnline ? JourneyScreenTheme.success : Colors.grey)
            .withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(
              color: isOnline ? JourneyScreenTheme.success : Colors.grey,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 4),
          Text(
            isOnline ? 'Online' : 'Offline',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: isOnline ? JourneyScreenTheme.success : Colors.grey,
            ),
          ),
        ],
      ),
    );
  }
}

class _DatePickerButton extends StatelessWidget {
  const _DatePickerButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(JourneyScreenTheme.radiusMedium),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: JourneyScreenTheme.spacing2,
            vertical: JourneyScreenTheme.spacing,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  label,
                  style: JourneyScreenTheme.textStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const Icon(
                Icons.arrow_drop_down_rounded,
                color: JourneyScreenTheme.textSecondary,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
