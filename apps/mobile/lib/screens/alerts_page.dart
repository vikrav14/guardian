import 'package:flutter/material.dart';

import '../dashboard/alert_formatters.dart';
import '../models/alert.dart';
import '../models/device.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/layout/guardian_page_frame.dart';

enum _AlertTone { danger, warning, neutral }

class AlertsPage extends StatelessWidget {
  const AlertsPage({super.key});

  _AlertTone _toneFor(GuardianAlert alert) {
    final t = alert.type.toLowerCase();
    final s = alert.severity.toLowerCase();
    if (t == 'sos' || t == 'fall' || s == 'critical') return _AlertTone.danger;
    if (t.contains('geofence') ||
        t == 'low_battery' ||
        t == 'offline' ||
        t == 'watch_removed' ||
        s == 'warning') {
      return _AlertTone.warning;
    }
    return _AlertTone.neutral;
  }

  IconData _iconFor(GuardianAlert alert) {
    switch (alert.type.toLowerCase()) {
      case 'sos':
      case 'fall':
        return Icons.warning_amber_rounded;
      case 'geofence_exit':
      case 'geofence_enter':
        return Icons.gpp_bad_outlined;
      case 'low_battery':
        return Icons.battery_1_bar;
      case 'offline':
        return Icons.signal_wifi_off_rounded;
      case 'watch_removed':
        return Icons.watch_off_outlined;
      default:
        return Icons.notifications_outlined;
    }
  }

  String _actionFor(GuardianAlert alert) {
    if (alert.resolved) return 'Resolved';
    final tone = _toneFor(alert);
    if (tone == _AlertTone.danger) return 'Review';
    if (tone == _AlertTone.warning) return 'Dismiss';
    return 'Dismiss';
  }

  (Color bg, Color fg, Color iconFg) _toneColors(
    _AlertTone tone,
    GuardianThemeColors semantic,
  ) {
    switch (tone) {
      case _AlertTone.danger:
        return (semantic.surface, semantic.textPrimary, GuardianColors.danger);
      case _AlertTone.warning:
        return (semantic.surface, semantic.textPrimary, GuardianColors.warning);
      case _AlertTone.neutral:
        return (semantic.surface, semantic.textPrimary, GuardianColors.accent);
    }
  }

  Device? _deviceFor(List<Device> devices, GuardianAlert alert) {
    for (final device in devices) {
      if (device.imei == alert.imei) return device;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Scaffold(
      backgroundColor: colors.canvas,
      body: GuardianPageFrame(
        maxWidth: 920,
        child: StreamBuilder<List<Device>>(
          stream: DeviceService().watchLinkedDevices(),
          builder: (context, deviceSnapshot) {
            final devices = deviceSnapshot.data ?? const <Device>[];

            return StreamBuilder<List<GuardianAlert>>(
              stream: AlertService().watchLinkedAlerts(),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return Center(child: Text('${snapshot.error}'));
                }
                if (!snapshot.hasData) {
                  return const Center(child: CircularProgressIndicator());
                }

                final alerts = snapshot.data!;
                final recent = alerts.where((a) {
                  final at = a.createdAt;
                  if (at == null) return true;
                  return DateTime.now().difference(at) <
                      const Duration(hours: 24);
                }).toList();
                final open = alerts.where((a) => !a.resolved).toList();

                return ListView(
                  padding: const EdgeInsets.fromLTRB(18, 24, 18, 118),
                  children: [
                    GuardianPageHeader(
                      eyebrow: 'THE IMPORTANT MOMENTS',
                      title: 'Alerts',
                      subtitle:
                          'Clear, calm updates—only when something matters.',
                      action: Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          color: colors.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: colors.border),
                        ),
                        child: Icon(
                          Icons.tune_rounded,
                          size: 19,
                          color: colors.textPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    const SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: [
                          _AlertFilterChip(label: 'All', active: true),
                          SizedBox(width: 7),
                          _AlertFilterChip(label: 'Safety'),
                          SizedBox(width: 7),
                          _AlertFilterChip(label: 'Device'),
                          SizedBox(width: 7),
                          _AlertFilterChip(label: 'Places'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (open.isEmpty && alerts.isEmpty)
                      const GuardianEmptyState(
                        icon: Icons.check_rounded,
                        title: 'Everyone is all clear',
                        message:
                            'SOS, safe-zone, battery, and connection alerts will appear here when they need you.',
                      )
                    else ...[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(6, 7, 6, 9),
                        child: Text(
                          recent.isEmpty ? 'EARLIER' : 'TODAY',
                          style: TextStyle(
                            color: colors.textMuted,
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                            letterSpacing: 1.2,
                          ),
                        ),
                      ),
                      for (final alert in open) ...[
                        _AlertCard(
                          title: alertDisplayTitle(
                            alert,
                            device: _deviceFor(devices, alert),
                          ),
                          body: alertDisplayBody(alert),
                          subtitle: alertDisplaySubtitle(
                            alert,
                            device: _deviceFor(devices, alert),
                          ),
                          icon: _iconFor(alert),
                          tone: _toneFor(alert),
                          colors: _toneColors(_toneFor(alert), colors),
                          action: _actionFor(alert),
                          borderColor: colors.border,
                          onAction: () => AlertService().resolve(alert.id),
                        ),
                        const SizedBox(height: 10),
                      ],
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(
                          color: colors.surface,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(color: colors.border),
                          boxShadow: [
                            BoxShadow(
                              color: GuardianColors.forest.withValues(
                                alpha: 0.05,
                              ),
                              blurRadius: 26,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 44,
                              height: 44,
                              decoration: const BoxDecoration(
                                color: GuardianColors.safeBg,
                                shape: BoxShape.circle,
                              ),
                              alignment: Alignment.center,
                              child: const Icon(
                                Icons.check,
                                color: GuardianColors.safe,
                                size: 20,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              open.isEmpty
                                  ? 'Everyone is all clear'
                                  : 'Everyone else is all clear',
                              style: TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: colors.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'New alerts will show up here first',
                              style: TextStyle(
                                fontSize: 12,
                                color: colors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _AlertFilterChip extends StatelessWidget {
  const _AlertFilterChip({required this.label, this.active = false});

  final String label;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 15, vertical: 8),
      decoration: BoxDecoration(
        color: active ? GuardianColors.forest : colors.surface,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: active ? GuardianColors.forest : colors.border,
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: active ? Colors.white : colors.textSecondary,
          fontSize: 11,
          fontWeight: active ? FontWeight.w800 : FontWeight.w500,
        ),
      ),
    );
  }
}

class _AlertCard extends StatelessWidget {
  const _AlertCard({
    required this.title,
    required this.body,
    required this.subtitle,
    required this.icon,
    required this.tone,
    required this.colors,
    required this.action,
    required this.borderColor,
    required this.onAction,
  });

  final String title;
  final String body;
  final String subtitle;
  final IconData icon;
  final _AlertTone tone;
  final (Color bg, Color fg, Color iconFg) colors;
  final String action;
  final Color borderColor;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, iconFg) = colors;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: borderColor),
        boxShadow: [
          BoxShadow(
            color: GuardianColors.forest.withValues(alpha: 0.05),
            blurRadius: 24,
            offset: const Offset(0, 9),
          ),
        ],
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: iconFg.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(14),
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 19, color: iconFg),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: fg,
                  ),
                ),
                if (body.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    body,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: context.guardianColors.textSecondary,
                    ),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 10,
                    color: context.guardianColors.textMuted,
                  ),
                ),
              ],
            ),
          ),
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: fg,
              padding: EdgeInsets.zero,
              minimumSize: Size.zero,
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              action,
              style: TextStyle(
                fontSize: 11,
                color: fg,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          const SizedBox(width: 4),
          Icon(
            Icons.chevron_right_rounded,
            size: 18,
            color: context.guardianColors.textMuted,
          ),
        ],
      ),
    );
  }
}
