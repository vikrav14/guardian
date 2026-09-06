import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../alerts/alert_detail.dart';
import '../alerts/alert_presentation.dart';
import '../alerts/alert_row.dart';
import '../models/alert.dart';
import '../models/device.dart';
import '../services/guardian_services.dart';
import '../services/watch_call_actions.dart';
import '../theme/app_theme.dart';
import '../widgets/layout/guardian_page_frame.dart';

class AlertsPage extends StatefulWidget {
  const AlertsPage({
    super.key,
    this.alertsStream,
    this.devicesStream,
    this.resolveAlert,
    this.onCallWatch,
    this.openLocation,
    this.clock,
  });

  final Stream<List<GuardianAlert>>? alertsStream;
  final Stream<List<Device>>? devicesStream;
  final Future<void> Function(String)? resolveAlert;
  final Future<void> Function(Device)? onCallWatch;
  final Future<bool> Function(Uri)? openLocation;
  final DateTime Function()? clock;

  @override
  State<AlertsPage> createState() => _AlertsPageState();
}

class _AlertsPageState extends State<AlertsPage> {
  late Stream<List<GuardianAlert>> _alertsStream;
  late Stream<List<Device>> _devicesStream;
  AlertCategory _category = AlertCategory.all;
  bool _history = false;
  bool _mobileDetail = false;
  bool _confirming = false;
  String? _selectedId;
  List<GuardianAlert> _latestAlerts = const [];
  List<Device> _latestDevices = const [];
  final Set<String> _pending = {};
  final Map<String, String> _errors = {};
  final ScrollController _scroll = ScrollController(keepScrollOffset: false);

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _scrollToTop() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _scroll.hasClients) _scroll.jumpTo(0);
    });
  }

  void _showInbox() {
    setState(() => _mobileDetail = false);
    _scrollToTop();
  }

  @override
  void initState() {
    super.initState();
    _connect();
  }

  void _connect() {
    _alertsStream = widget.alertsStream ?? AlertService().watchLinkedAlerts();
    _devicesStream =
        widget.devicesStream ?? DeviceService().watchLinkedDevices();
  }

  @override
  void didUpdateWidget(covariant AlertsPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.alertsStream != widget.alertsStream ||
        oldWidget.devicesStream != widget.devicesStream) {
      _connect();
      _latestAlerts = const [];
      _latestDevices = const [];
      _selectedId = null;
      _mobileDetail = false;
    }
  }

  GuardianAlert? _findAlert(String id) {
    for (final alert in _latestAlerts) {
      if (alert.id == id) return alert;
    }
    return null;
  }

  Device? _deviceFor(GuardianAlert alert) {
    for (final device in _latestDevices) {
      if (device.imei == alert.imei) return device;
    }
    return null;
  }

  void _changeView({bool? history, AlertCategory? category}) => setState(() {
    if (history != null) _history = history;
    if (category != null) _category = category;
    _selectedId = null;
    _mobileDetail = false;
    _scrollToTop();
  });

  Future<void> _resolve(GuardianAlert alert) async {
    if (_confirming || _pending.contains(alert.id) || alert.resolved) return;
    _confirming = true;
    bool? confirmed;
    try {
      confirmed = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          scrollable: true,
          title: const Text('Mark this alert as resolved?'),
          content: const Text(
            'It will close for every linked guardian and remain in recent history. Confirm after you have reviewed what happened.',
          ),
          actions: [
            TextButton(
              key: const Key('alert-keep-open'),
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Keep open'),
            ),
            FilledButton(
              key: const Key('alert-confirm-resolve'),
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Confirm resolution'),
            ),
          ],
        ),
      );
    } finally {
      _confirming = false;
    }
    if (!mounted || confirmed != true) return;
    // Recheck the stream after confirmation; access or resolution may change.
    final current = _findAlert(alert.id);
    if (current == null || current.imei != alert.imei || current.resolved) {
      return;
    }
    setState(() {
      _pending.add(alert.id);
      _errors.remove(alert.id);
    });
    try {
      await (widget.resolveAlert?.call(alert.id) ??
          AlertService().resolve(alert.id));
      // The stream confirms success. Do not hide records optimistically.
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _pending.remove(alert.id);
        _errors[alert.id] =
            'Could not resolve this alert. It remains open; please try again.';
      });
    }
  }

  Future<void> _call(GuardianAlert alert) async {
    final current = _findAlert(alert.id);
    if (current == null || current.imei != alert.imei) return;
    final device = _deviceFor(current);
    if (device == null || device.simNumber?.trim().isNotEmpty != true) return;
    try {
      if (widget.onCallWatch != null) {
        await widget.onCallWatch!(device);
      } else {
        await callWatch(context, device);
      }
    } catch (_) {
      if (mounted) _notice('Could not open the watch call. Please try again.');
    }
  }

  Future<void> _location(GuardianAlert alert) async {
    final current = _findAlert(alert.id);
    if (current == null || current.imei != alert.imei) return;
    final uri = current.sosLocationSnapshot?.mapsUri;
    if (uri == null) return;
    try {
      final opened =
          await (widget.openLocation?.call(uri) ??
              launchUrl(uri, mode: LaunchMode.externalApplication));
      if (!opened && mounted) {
        _notice('Could not open the incident map. Please try again.');
      }
    } catch (_) {
      if (mounted) {
        _notice('Could not open the incident map. Please try again.');
      }
    }
  }

  void _notice(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Widget _detail(GuardianAlert? alert) => alert == null
      ? const GuardianEmptyState(
          icon: Icons.touch_app_outlined,
          title: 'Select an alert',
          message:
              'Its recorded details and available actions will appear here.',
        )
      : AlertDetail(
          alert: alert,
          device: _deviceFor(alert),
          saving: _pending.contains(alert.id),
          error: _errors[alert.id],
          onResolve: () => _resolve(alert),
          onCall: () => _call(alert),
          onLocation: alert.sosLocationSnapshot?.mapsUri == null
              ? null
              : () => _location(alert),
        );

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Scaffold(
      backgroundColor: colors.canvas,
      body: GuardianPageFrame(
        maxWidth: 1140,
        child: StreamBuilder<List<Device>>(
          stream: _devicesStream,
          builder: (context, deviceSnapshot) {
            _latestDevices = deviceSnapshot.hasError
                ? const []
                : deviceSnapshot.data ?? const [];
            return StreamBuilder<List<GuardianAlert>>(
              stream: _alertsStream,
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  _latestAlerts = const [];
                  return Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: GuardianEmptyState(
                        icon: Icons.cloud_off_outlined,
                        title: 'Alerts could not be loaded',
                        message:
                            'Check your connection and try again. An unavailable list does not mean there are no alerts.',
                        action: OutlinedButton(
                          onPressed: () => setState(_connect),
                          child: const Text('Try again'),
                        ),
                      ),
                    ),
                  );
                }
                if (!snapshot.hasData) {
                  _latestAlerts = const [];
                  return const Center(child: CircularProgressIndicator());
                }
                _latestAlerts = snapshot.data!;
                _pending.removeWhere((id) {
                  final alert = _findAlert(id);
                  return alert == null || alert.resolved;
                });
                final visible = _latestAlerts
                    .where(
                      (a) => a.resolved == _history && _category.includes(a),
                    )
                    .toList();
                final explicit = _selectedId == null
                    ? null
                    : _findAlert(_selectedId!);
                final selected =
                    explicit ?? (visible.isEmpty ? null : visible.first);
                return LayoutBuilder(
                  builder: (context, constraints) {
                    final wide = constraints.maxWidth >= 880;
                    final mobileDetail = !wide && _mobileDetail;
                    final inbox = _inbox(visible, selected?.id);
                    return PopScope(
                      canPop: !mobileDetail,
                      onPopInvokedWithResult: (didPop, result) {
                        if (!didPop && mobileDetail) _showInbox();
                      },
                      child: ListView(
                        controller: _scroll,
                        key: const PageStorageKey('guardian-alerts-scroll'),
                        padding: const EdgeInsets.fromLTRB(18, 24, 18, 148),
                        children: [
                          const GuardianPageHeader(
                            title: 'Alerts',
                            subtitle:
                                'See what happened. Choose what to do next.',
                          ),
                          const SizedBox(height: 24),
                          if (deviceSnapshot.hasError) ...[
                            Text(
                              'Watch details could not be loaded. Alerts remain available; call actions will return when watch details reconnect.',
                              style: TextStyle(color: colors.textSecondary),
                            ),
                            const SizedBox(height: 16),
                          ],
                          if (wide)
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(flex: 6, child: inbox),
                                const SizedBox(width: 24),
                                Expanded(flex: 5, child: _detail(selected)),
                              ],
                            )
                          else if (mobileDetail) ...[
                            Align(
                              alignment: Alignment.centerLeft,
                              child: TextButton.icon(
                                key: const Key('alerts-back'),
                                onPressed: _showInbox,
                                icon: const Icon(Icons.arrow_back_rounded),
                                label: const Text('Back to alerts'),
                              ),
                            ),
                            const SizedBox(height: 8),
                            if (explicit == null)
                              const GuardianEmptyState(
                                icon: Icons.info_outline,
                                title: 'This alert is no longer available',
                                message:
                                    'Return to the current linked-watch alerts.',
                              )
                            else
                              _detail(explicit),
                          ] else
                            inbox,
                        ],
                      ),
                    );
                  },
                );
              },
            );
          },
        ),
      ),
    );
  }

  Widget _inbox(List<GuardianAlert> alerts, String? selectedId) {
    final colors = context.guardianColors;
    final now = widget.clock?.call() ?? DateTime.now();
    final groups = <String, List<GuardianAlert>>{};
    for (final alert in alerts) {
      groups
          .putIfAbsent(alertDateGroup(alert.createdAt, now), () => [])
          .add(alert);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            ChoiceChip(
              key: const Key('alerts-open'),
              label: Text(
                'Open (${_latestAlerts.where((a) => !a.resolved).length})',
              ),
              selected: !_history,
              onSelected: (_) => _changeView(history: false),
            ),
            ChoiceChip(
              key: const Key('alerts-history'),
              label: Text(
                'History (${_latestAlerts.where((a) => a.resolved).length})',
              ),
              selected: _history,
              onSelected: (_) => _changeView(history: true),
            ),
          ],
        ),
        const SizedBox(height: 14),
        Wrap(
          spacing: 7,
          runSpacing: 7,
          children: [
            for (final category in AlertCategory.values)
              ChoiceChip(
                key: ValueKey('alerts-category-${category.name}'),
                label: Text(category.label),
                selected: _category == category,
                onSelected: (_) => _changeView(category: category),
              ),
          ],
        ),
        const SizedBox(height: 12),
        if (alerts.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 18),
            child: GuardianEmptyState(
              icon: Icons.inbox_outlined,
              title: _history
                  ? 'No resolved alerts in this view'
                  : 'No open alerts in this view',
              message: 'Try another category to see other recent alerts.',
            ),
          ),
        for (final group in groups.entries) ...[
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 14, 4, 9),
            child: Text(
              group.key,
              style: TextStyle(
                color: colors.textSecondary,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          for (final alert in group.value) ...[
            AlertRow(
              alert: alert,
              device: _deviceFor(alert),
              selected: selectedId == alert.id,
              onTap: () {
                setState(() {
                  _selectedId = alert.id;
                  _mobileDetail = true;
                });
                _scrollToTop();
              },
            ),
            const SizedBox(height: 9),
          ],
        ],
        const SizedBox(height: 12),
        Text(
          'Showing up to 100 recent alerts from linked watches.',
          style: TextStyle(color: colors.textSecondary, fontSize: 12),
        ),
      ],
    );
  }
}
