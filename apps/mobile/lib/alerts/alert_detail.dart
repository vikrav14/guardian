import 'package:flutter/material.dart';

import '../dashboard/alert_formatters.dart';
import '../models/alert.dart';
import '../models/device.dart';
import '../theme/app_theme.dart';
import 'alert_presentation.dart';

class AlertDetail extends StatelessWidget {
  const AlertDetail({
    super.key,
    required this.alert,
    required this.device,
    required this.saving,
    required this.onResolve,
    required this.onCall,
    required this.onLocation,
    this.error,
  });

  final GuardianAlert alert;
  final Device? device;
  final bool saving;
  final VoidCallback onResolve;
  final VoidCallback? onCall;
  final VoidCallback? onLocation;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final title = alertDisplayTitle(alert, device: device);
    final body = alertDisplayBody(alert);
    final sos = alert.type.toLowerCase() == 'sos';
    final canCall =
        device?.simNumber?.trim().isNotEmpty == true && onCall != null;
    return Container(
      key: ValueKey('alert-detail-${alert.id}'),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: colors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  title,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Chip(
                label: Text(alert.resolved ? 'Resolved' : 'Open'),
                backgroundColor: sos && !alert.resolved
                    ? GuardianColors.danger.withValues(alpha: 0.10)
                    : colors.surfaceMuted,
                side: BorderSide.none,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${device?.displayName ?? 'Linked watch'} · ${alertRecordedTime(alert.createdAt)}',
            style: TextStyle(color: colors.textSecondary, fontSize: 12),
          ),
          if (body.isNotEmpty && body != title) ...[
            const SizedBox(height: 18),
            Text(
              body,
              style: TextStyle(color: colors.textPrimary, height: 1.5),
            ),
          ],
          if (sos || alert.type.toLowerCase() == 'fall') ...[
            const SizedBox(height: 20),
            FilledButton.icon(
              key: const Key('alert-call-watch'),
              onPressed: canCall ? onCall : null,
              icon: const Icon(Icons.phone_outlined, size: 19),
              label: const Text('Call watch'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            if (!canCall) ...[
              const SizedBox(height: 8),
              Text(
                device == null
                    ? 'Watch details are unavailable. Calling cannot be opened here yet.'
                    : 'No SIM number is saved for this watch. Check its settings.',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            ],
          ],
          if (sos) ...[
            const SizedBox(height: 20),
            _SosLocation(alert: alert, onLocation: onLocation),
          ],
          const SizedBox(height: 20),
          Divider(color: colors.border),
          const SizedBox(height: 12),
          if (alert.resolved) ...[
            Row(
              children: [
                Icon(Icons.check_circle_outline, color: colors.accent),
                const SizedBox(width: 8),
                const Expanded(child: Text('Marked as resolved')),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              alert.resolvedAt == null
                  ? 'Kept in recent history.'
                  : '${alertRecordedTime(alert.resolvedAt)} · Kept in recent history.',
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
          ] else ...[
            OutlinedButton.icon(
              key: const Key('alert-resolve'),
              onPressed: saving ? null : onResolve,
              icon: saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check_rounded, size: 19),
              label: Text(saving ? 'Saving…' : 'Mark as resolved'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Opening or calling does not resolve this alert.',
              textAlign: TextAlign.center,
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
            if (error != null) ...[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  error!,
                  key: const Key('alert-resolve-error'),
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _SosLocation extends StatelessWidget {
  const _SosLocation({required this.alert, required this.onLocation});

  final GuardianAlert alert;
  final VoidCallback? onLocation;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final snapshot = alert.sosLocationSnapshot;
    final point = snapshot?.location;
    final network = snapshot?.secondaryNetworkObservation;
    final locationAvailable = snapshot?.mapsUri != null && onLocation != null;
    final label = snapshot?.retainedSatellite == true
        ? 'Last reliable GPS'
        : point?.source == 'gps'
        ? 'Satellite GPS'
        : point?.source == 'wifi'
        ? 'Approximate Wi-Fi location'
        : point?.source == 'lbs'
        ? 'Approximate cellular location'
        : 'Positioning source unconfirmed';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.surfaceMuted,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(
                Icons.location_on_outlined,
                size: 18,
                color: colors.textSecondary,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  'Location at SOS receipt',
                  style: TextStyle(color: colors.textSecondary, fontSize: 12),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (point == null) ...[
            const Text(
              'Location unavailable',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            const Text('No trustworthy location was recorded with this alert.'),
          ] else ...[
            Text(
              label,
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 4),
            Text(
              point.placeLabel ?? 'Recorded coordinates',
              style: TextStyle(
                color: colors.textPrimary,
                fontSize: 17,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              sosReceiptAge(snapshot!.ageSeconds),
              key: const Key('alert-location-age'),
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
            if (point.recordedAt != null)
              Text(
                'Recorded ${alertRecordedTime(point.recordedAt)}',
                style: TextStyle(color: colors.textSecondary, fontSize: 12),
              ),
            if (point.source != 'gps' && point.accuracyMeters != null)
              Text('Estimated radius: ${point.accuracyMeters!.round()} m'),
            if (snapshot.state == 'last_known') ...[
              const SizedBox(height: 8),
              const Text('Current position unconfirmed.'),
            ],
          ],
          const SizedBox(height: 14),
          OutlinedButton.icon(
            key: const Key('alert-incident-map'),
            onPressed: locationAvailable ? onLocation : null,
            icon: const Icon(Icons.map_outlined, size: 19),
            label: Text(
              locationAvailable
                  ? 'View incident location'
                  : 'Incident map unavailable',
            ),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(46),
            ),
          ),
          if (network != null) ...[
            const SizedBox(height: 10),
            ExpansionTile(
              key: PageStorageKey('alert-network-${alert.id}'),
              tilePadding: EdgeInsets.zero,
              childrenPadding: const EdgeInsets.only(bottom: 8),
              title: const Text(
                'Approximate network observation',
                style: TextStyle(fontSize: 12),
              ),
              children: [
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(
                    [
                      sosReceiptAge(network.ageAt(snapshot!.capturedAt)),
                      if (network.accuracyMeters != null)
                        'Estimated radius: ${network.accuracyMeters!.round()} m.',
                      'Kept separately from the GPS location above.',
                    ].join(' '),
                    style: TextStyle(color: colors.textSecondary, fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
