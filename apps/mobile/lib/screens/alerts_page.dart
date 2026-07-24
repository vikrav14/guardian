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
        return (GuardianColors.dangerBg, GuardianColors.dangerText, GuardianColors.danger);
      case _AlertTone.warning:
        return (GuardianColors.warningBg, GuardianColors.warningText, GuardianColors.warning);
      case _AlertTone.neutral:
        return (semantic.surface, semantic.textPrimary, semantic.textSecondary);
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
      body: SafeArea(
        child: GuardianPageFrame(
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
                  return DateTime.now().difference(at) < const Duration(hours: 24);
                }).toList();
                final open = alerts.where((a) => !a.resolved).toList();

                return ListView(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 28),
                  children: [
                    GuardianPageHeader(
                      title: 'Alerts',
                      subtitle: recent.isEmpty
                          ? 'Everything is calm right now'
                          : '${recent.length} in the last 24 hours',
                    ),
                    const SizedBox(height: 20),
                    if (open.isEmpty && alerts.isEmpty)
                      const GuardianEmptyState(
                        icon: Icons.check_rounded,
                        title: 'Everyone is all clear',
                        message:
                            'SOS, safe-zone, battery, and connection alerts will appear here when they need you.',
                      )
                    else ...[
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
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: colors.surface,
                          borderRadius: BorderRadius.circular(14),
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
                              child: const Icon(Icons.check, color: GuardianColors.safe, size: 20),
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
                              style: TextStyle(fontSize: 12, color: colors.textSecondary),
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
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(14),
        border: tone == _AlertTone.neutral
            ? Border.all(color: borderColor)
            : null,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              color: iconFg.withValues(alpha: 0.15),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Icon(icon, size: 17, color: iconFg),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: fg),
                ),
                if (body.isNotEmpty) ...[
                  const SizedBox(height: 3),
                  Text(
                    body,
                    style: TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: fg.withValues(alpha: 0.88),
                    ),
                  ),
                ],
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(fontSize: 11, color: fg.withValues(alpha: 0.72)),
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
              style: TextStyle(fontSize: 11, color: fg, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
