import 'dart:async';

import 'package:flutter/material.dart';

import '../../dashboard/device_connectivity.dart';
import '../../dashboard/wearing_presentation.dart';
import '../../models/device.dart';
import '../../models/wear_check.dart';
import '../../models/wear_status.dart';
import '../../theme/app_theme.dart';

class DashboardWearingStatus extends StatefulWidget {
  const DashboardWearingStatus({
    super.key,
    required this.device,
    required this.watchStatus,
    required this.watchChecks,
    required this.recordCheck,
    this.clock,
  });

  final Device device;
  final Stream<WearStatus> Function(String imei) watchStatus;
  final Stream<WearCheck?> Function(String imei) watchChecks;
  final Future<void> Function(String imei, String state) recordCheck;
  final DateTime Function()? clock;

  @override
  State<DashboardWearingStatus> createState() => _DashboardWearingStatusState();
}

class _DashboardWearingStatusState extends State<DashboardWearingStatus>
    with WidgetsBindingObserver {
  late Stream<WearStatus> _status;
  late Stream<WearCheck?> _checks;
  Timer? _clock;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _subscribe();
    // Expire evidence even when no packets arrive and the parent stays still.
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  void _subscribe() {
    _generation++;
    _status = widget.watchStatus(widget.device.imei);
    _checks = widget.watchChecks(widget.device.imei);
  }

  @override
  void didUpdateWidget(DashboardWearingStatus oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.device.imei != widget.device.imei) _subscribe();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && mounted) setState(() {});
  }

  @override
  void dispose() {
    _clock?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => StreamBuilder<WearStatus>(
    // A new device/retry must not retain StreamBuilder's previous data.
    key: ValueKey(_generation),
    stream: _status,
    builder: (context, statusSnapshot) => StreamBuilder<WearCheck?>(
      stream: _checks,
      builder: (context, checkSnapshot) {
        final unavailable = statusSnapshot.hasError || checkSnapshot.hasError;
        final loading = statusSnapshot.connectionState == ConnectionState.waiting ||
            checkSnapshot.connectionState == ConnectionState.waiting;
        final status = unavailable
            ? const WearStatus() : statusSnapshot.data ?? const WearStatus();
        final check = unavailable ? null : checkSnapshot.data;
        final presentation = unavailable
            ? const WearingPresentation('Wearing status unavailable',
                'Tap to retry', WearingTone.neutral)
            : loading
            ? const WearingPresentation('Checking wearing status…',
                'Waiting for an update', WearingTone.neutral)
            : WearingPresentation.at(
                now: widget.clock?.call() ?? DateTime.now(),
                connected: widget.device.connectivityPhase() == DeviceConnectivityPhase.live,
                status: status,
                check: check,
              );
        return WearingStatusTile(
          presentation: presentation,
          onTap: unavailable
              ? () => setState(_subscribe)
              : loading ? null : () => _showDetails(status, check),
        );
      },
    ),
  );

  Future<void> _showDetails(WearStatus status, WearCheck? check) async {
    // Capture this device for the sheet; switching the dashboard behind it
    // must never redirect a family's observation to a different watch.
    final device = widget.device;
    final record = widget.recordCheck;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => _WearingDetails(
        name: device.displayName,
        status: status,
        check: check,
        onRecord: (state) => record(device.imei, state),
      ),
    );
  }
}

/// Pure presentation, shared by the live dashboard and visual previews.
class WearingStatusTile extends StatelessWidget {
  const WearingStatusTile({super.key, required this.presentation, this.onTap});

  final WearingPresentation presentation;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final color = switch (presentation.tone) {
      WearingTone.detected => dark ? colors.accent : GuardianColors.safeText,
      WearingTone.removal => dark ? GuardianColors.warning : GuardianColors.warningText,
      WearingTone.neutral => colors.textSecondary,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Divider(height: 20, color: colors.border),
        InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Icon(Icons.watch_outlined, size: 18, color: color),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(presentation.title, style: TextStyle(
                        color: color, fontSize: 14, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 4),
                      Text(presentation.detail, style: TextStyle(
                        color: colors.textSecondary, fontSize: 13, height: 1.4)),
                    ],
                  ),
                ),
                if (onTap != null) ...[
                  const SizedBox(width: 8),
                  Icon(Icons.chevron_right, color: colors.textSecondary, size: 20),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _WearingDetails extends StatefulWidget {
  const _WearingDetails({
    required this.name,
    required this.status,
    required this.check,
    required this.onRecord,
  });

  final String name;
  final WearStatus status;
  final WearCheck? check;
  final Future<void> Function(String state) onRecord;

  @override
  State<_WearingDetails> createState() => _WearingDetailsState();
}

class _WearingDetailsState extends State<_WearingDetails> {
  bool _saving = false;
  String? _error;

  String _when(DateTime at) {
    final local = at.toLocal();
    final formats = MaterialLocalizations.of(context);
    return '${formats.formatFullDate(local)}, ${formats.formatTimeOfDay(TimeOfDay.fromDateTime(local))}';
  }

  Future<void> _save(String state) async {
    setState(() { _saving = true; _error = null; });
    try {
      await widget.onRecord(state);
      if (mounted) Navigator.of(context).pop();
    } catch (_) {
      if (mounted) setState(() {
        _saving = false;
        _error = 'Check could not be saved. Check your connection and phone clock, then try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final removal = widget.status.lastRemovalReportedAt;
    final check = widget.check;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('${widget.name} · Wearing information',
              style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Text(widget.status.deviceAccepted
              ? 'Wearing detection uses fresh watch sensor reports. A connection alone does not confirm wearing.'
              : 'This watch reports removal alarms. We cannot yet confirm automatically when it is back on the wrist.'),
            if (removal != null && !removal.isAfter(DateTime.now())) ...[
              const SizedBox(height: 16),
              Text('Last removal report: ${_when(removal)}'),
            ],
            if (check != null && !check.observedAt.isAfter(DateTime.now())) ...[
              const SizedBox(height: 12),
              Text('Last family check: ${check.state == 'worn' ? 'on wrist' : 'off wrist'} · ${_when(check.observedAt)}'),
            ],
            const SizedBox(height: 24),
            Text('Record a family check', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const Text('Only record this after checking the person’s wrist now. '
              'It is saved as a dated family observation, not automatic detection.'),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: _saving ? null : () => _save('worn'),
              child: const Text('I checked: on wrist'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: _saving ? null : () => _save('removed'),
              child: const Text('I checked: off wrist'),
            ),
            if (_saving) const Padding(
              padding: EdgeInsets.only(top: 16),
              child: Text('Saving family check…'),
            ),
            if (_error != null) Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(_error!, style: TextStyle(color: colors.textPrimary)),
            ),
            TextButton(onPressed: () => Navigator.of(context).pop(),
              child: const Text('Close')),
          ],
        ),
      ),
    );
  }
}
