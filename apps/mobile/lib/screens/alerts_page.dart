import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/alert.dart';

class AlertsPage extends StatelessWidget {
  const AlertsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final query = FirebaseFirestore.instance
        .collection('alerts')
        .orderBy('createdAt', descending: true)
        .limit(100);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Alerts'),
        backgroundColor: const Color(0xFFF7F4EF),
      ),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: query.snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text(
                  'Could not load alerts.\n${snapshot.error}\n\n'
                  'Tip: create a Firestore index if prompted, or keep rules in test mode.',
                  textAlign: TextAlign.center,
                ),
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final alerts = snapshot.data!.docs.map(GuardianAlert.fromDoc).toList();
          if (alerts.isEmpty) {
            return const Center(
              child: Text(
                'No alerts yet.\nTrigger SOS from the simulator:\n'
                'npm run simulate -- --sos',
                textAlign: TextAlign.center,
                style: TextStyle(height: 1.45),
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: alerts.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final alert = alerts[index];
              return _AlertTile(alert: alert);
            },
          );
        },
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.alert});

  final GuardianAlert alert;

  Color get _severityColor {
    switch (alert.severity) {
      case 'critical':
        return const Color(0xFFB91C1C);
      case 'warning':
        return const Color(0xFFD97706);
      default:
        return const Color(0xFF2F6FED);
    }
  }

  IconData get _icon {
    switch (alert.type) {
      case 'sos':
        return Icons.sos;
      case 'fall':
        return Icons.personal_injury_outlined;
      case 'low_battery':
        return Icons.battery_alert;
      case 'geofence_exit':
      case 'geofence_enter':
        return Icons.fence;
      default:
        return Icons.notifications_active_outlined;
    }
  }

  Future<void> _resolve(BuildContext context) async {
    await FirebaseFirestore.instance.collection('alerts').doc(alert.id).update({
      'resolved': true,
      'resolvedAt': FieldValue.serverTimestamp(),
    });
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Alert marked resolved')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final time = alert.createdAt != null
        ? DateFormat('dd MMM, HH:mm').format(alert.createdAt!.toLocal())
        : '—';

    return Material(
      color: alert.resolved ? const Color(0xFFEDEBE6) : const Color(0xFFF7F4EF),
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              backgroundColor: _severityColor.withValues(alpha: 0.15),
              foregroundColor: _severityColor,
              child: Icon(_icon, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          alert.type.toUpperCase(),
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: _severityColor,
                            letterSpacing: 0.4,
                          ),
                        ),
                      ),
                      Text(
                        time,
                        style: const TextStyle(fontSize: 12, color: Color(0xFF5C6B63)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(alert.message),
                  const SizedBox(height: 4),
                  Text(
                    'IMEI ${alert.imei}',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF5C6B63)),
                  ),
                  if (!alert.resolved) ...[
                    const SizedBox(height: 10),
                    Align(
                      alignment: Alignment.centerLeft,
                      child: TextButton.icon(
                        onPressed: () => _resolve(context),
                        icon: const Icon(Icons.check, size: 18),
                        label: const Text('Resolve'),
                      ),
                    ),
                  ] else
                    const Padding(
                      padding: EdgeInsets.only(top: 6),
                      child: Text(
                        'Resolved',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFF1F8A4C),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
