import 'dart:async';

import 'package:flutter/material.dart';

import '../models/geofence.dart';
import '../services/home_wifi_service.dart';
import '../services/phone_wifi_scanner.dart';
import '../theme/app_theme.dart';
import '../widgets/safe_zones/safe_zone_map.dart';

String homeWifiMessage(String code) => switch (code) {
  'owner_required' => 'Only the service owner can manage Home Wi-Fi.',
  'device_not_linked' => 'This watch is no longer linked to your account.',
  'sign_in_required' => 'Please sign in again to manage Home Wi-Fi.',
  'home_family_plan_required' => 'An active Family or Care plan is needed.',
  'home_zone_missing' => 'Create or activate a safe zone named Home first.',
  'home_zone_ambiguous' => 'Keep one active Home zone for this watch.',
  'home_changed' => 'The Home pin changed. Refresh and confirm it again.',
  'settings_changed' => 'Home Wi-Fi changed elsewhere. Refresh before saving.',
  'network_expired' =>
    'That network report expired. Wait for a new watch report.',
  'gateway_not_configured' =>
    'Home Wi-Fi setup is unavailable in this app build.',
  _ => 'Home Wi-Fi setup is unavailable. Check your connection and refresh.',
};

String phoneWifiMessage(String code) => switch (code) {
  'noLocationPermissionRequired' || 'noLocationPermissionDenied' =>
    'Allow location access for Guardian in Android Settings, then scan again. Android requires it to find Wi-Fi names.',
  'noLocationPermissionUpgradeAccuracy' =>
    'Allow precise location for Guardian in Android Settings, then scan again.',
  'noLocationServiceDisabled' =>
    'Turn on Location in your phone settings, then scan again.',
  'scan_rejected' || 'busy' =>
    'Android could not start a scan. Check that Wi-Fi is on and wait a moment before trying again.',
  'timeout' =>
    'The scan did not finish. Check Wi-Fi, Location and Guardian permissions, then try again.',
  _ =>
    'Wi-Fi scanning is unavailable. Check your phone settings and try again.',
};

class HomeWifiSetupPage extends StatefulWidget {
  const HomeWifiSetupPage({
    super.key,
    required this.zone,
    this.client,
    this.mapBuilder,
    this.scanner,
  });
  final Geofence zone;
  final HomeWifiClient? client;
  final Widget Function(Geofence)? mapBuilder;
  final PhoneWifiScanner? scanner;
  @override
  State<HomeWifiSetupPage> createState() => _HomeWifiSetupPageState();
}

class _HomeWifiSetupPageState extends State<HomeWifiSetupPage>
    with WidgetsBindingObserver {
  late final HomeWifiClient _client;
  late final PhoneWifiScanner _scanner;
  List<PhoneWifiNetwork> _phoneNetworks = const [];
  DateTime? _phoneScanExpires;
  String? _phoneNotice;
  bool _scanning = false;
  final ScrollController _scroll = ScrollController();
  Timer? _timer;
  HomeWifiState? _state;
  String? _selected;
  String? _error;
  String? _notice;
  bool _confirmed = false;
  bool _loading = false;
  bool _saving = false;
  bool _needsRefresh = false;
  bool _foreground = true;
  int _ticks = 0;
  DateTime _pollUntil = DateTime.now().add(const Duration(minutes: 10));

  @override
  void initState() {
    super.initState();
    _client = widget.client ?? HomeWifiService();
    _scanner = widget.scanner ?? AndroidPhoneWifiScanner();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_load());
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!_foreground || !mounted) return;
      setState(() {
        _ticks++;
        if (_phoneScanExpires != null && !_phoneFresh) {
          _phoneNetworks = const [];
          _phoneScanExpires = null;
          _phoneNotice = 'Phone scan expired. Scan again to find nearby names.';
        }
      }); // Expired network choices disable without another HTTP response.
      if (_ticks % 10 == 0 &&
          DateTime.now().isBefore(_pollUntil) &&
          !_needsRefresh) {
        unawaited(_load());
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (_foreground) unawaited(_load());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _scroll.dispose();
    if (widget.client == null) _client.close();
    if (widget.scanner == null) _scanner.close();
    super.dispose();
  }

  Future<void> _load({bool manual = false}) async {
    if (_loading || _saving || _scanning) return;
    if (manual) _pollUntil = DateTime.now().add(const Duration(minutes: 10));
    setState(() => _loading = true);
    try {
      final state = await _client.load(
        widget.zone.imei,
        widget.zone.id,
        phoneNetworks: _phoneFresh && _state?.homeKey != null
            ? _phoneNetworks
            : const [],
        homeKey: _state?.homeKey,
      );
      if (!mounted) return;
      setState(() {
        if (_state?.homeKey != state.homeKey ||
            _state?.version != state.version) {
          _selected = null;
          _confirmed = false;
          if (_state != null) {
            _phoneNetworks = const [];
            _phoneScanExpires = null;
          }
        }
        final before = _state?.networks
            .where((n) => n.id == _selected)
            .firstOrNull;
        final after = state.networks
            .where((n) => n.id == _selected)
            .firstOrNull;
        if (before?.name != after?.name) _confirmed = false;
        if (!state.networks.any(
          (n) => n.id == _selected && n.fresh(DateTime.now()),
        )) {
          _selected = null;
        }
        _state = state;
        if (_phoneFresh && _phoneNetworks.isNotEmpty) {
          _phoneNotice =
              '${_phoneNetworks.length} named 2.4 GHz networks found by your phone. '
              '${state.phoneMatches.length} also reported by the watch.';
        }
        _error = null;
        _needsRefresh = false;
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = homeWifiMessage(
            error is HomeWifiException ? error.code : 'setup_unavailable',
          );
          _needsRefresh = true;
          _phoneNetworks = const [];
          _phoneScanExpires = null;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  bool get _phoneFresh => _phoneScanExpires?.isAfter(DateTime.now()) == true;

  Future<void> _scanPhone() async {
    if (_scanning ||
        _loading ||
        _saving ||
        _needsRefresh ||
        _state?.homeKey == null) {
      return;
    }
    setState(() {
      _scanning = true;
      _phoneNotice = null;
      _phoneNetworks = const [];
      _phoneScanExpires = null;
      _selected = null;
      _confirmed = false;
    });
    try {
      final networks = await _scanner.scan();
      if (!mounted) return;
      setState(() {
        _phoneNetworks = networks;
        _phoneScanExpires = DateTime.now().add(const Duration(minutes: 2));
        _phoneNotice = networks.isEmpty
            ? 'No named 2.4 GHz networks found. Keep your phone near the home router and try again.'
            : 'Found ${networks.length} named 2.4 GHz networks. Checking which ones the watch has reported.';
      });
    } catch (error) {
      if (mounted) {
        setState(
          () => _phoneNotice = phoneWifiMessage(
            error is PhoneWifiScanException ? error.code : 'unavailable',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
    if (mounted) await _load(manual: true);
  }

  Future<void> _save({bool remove = false}) async {
    final state = _state;
    if (_saving || _loading || _scanning || _needsRefresh || state == null) {
      return;
    }
    if (!remove &&
        (!_confirmed ||
            !state.networks.any(
              (n) => n.id == _selected && n.fresh(DateTime.now()),
            ))) {
      return;
    }
    if (remove) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Remove Home Wi-Fi?'),
          content: const Text(
            'Guardian will stop recognising this saved network. Your Home map pin stays saved.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Remove'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
    }
    setState(() {
      _saving = true;
      _error = null;
      _notice = null;
    });
    try {
      if (remove) {
        await _client.remove(widget.zone.imei, expectedVersion: state.version);
      } else {
        await _client.save(
          widget.zone.imei,
          widget.zone.id,
          candidateId: _selected!,
          expectedVersion: state.version,
          homeKey: state.homeKey!,
        );
      }
      if (mounted) {
        setState(() {
          _selected = null;
          _confirmed = false;
          _notice = remove
              ? 'Home Wi-Fi removed.'
              : 'Home Wi-Fi saved. Waiting for fresh watch reports.';
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _needsRefresh = true;
          _error = error is HomeWifiException
              ? homeWifiMessage(error.code)
              : 'The save result is unconfirmed. Refresh to check the saved setting before trying again.';
        });
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
    if (mounted && _scroll.hasClients) {
      unawaited(
        _scroll.animateTo(
          0,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        ),
      );
    }
    if (mounted && !_needsRefresh) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final state = _state;
    final now = DateTime.now();
    final networks =
        state?.networks.where((n) => n.fresh(now)).toList() ??
        <HomeWifiNetwork>[];
    final canSave =
        !_saving &&
        !_loading &&
        !_scanning &&
        !_needsRefresh &&
        _confirmed &&
        state?.homeKey != null &&
        networks.any((n) => n.id == _selected);
    final home = state?.lat == null || state?.lng == null
        ? null
        : Geofence(
            id: widget.zone.id,
            imei: widget.zone.imei,
            name: 'Home',
            active: true,
            lat: state!.lat!,
            lng: state.lng!,
            radiusMeters: state.radiusMeters ?? 150,
          );
    return Scaffold(
      appBar: AppBar(title: const Text('Home Wi-Fi')),
      backgroundColor: colors.canvas,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 640),
          child: SingleChildScrollView(
            controller: _scroll,
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Recognise your familiar place',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Choose a network seen by the watch while it is at home. No Wi-Fi password is needed.',
                ),
                const SizedBox(height: 20),
                if (state?.enabled == true)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            state!.name ?? 'Saved network',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          const SizedBox(height: 6),
                          Text(
                            _needsRefresh
                                ? 'Detection status unavailable.'
                                : state.detectedNow
                                ? 'Home Wi-Fi detected at ${_time(state.observedAt)}'
                                : state.observedAt != null
                                ? 'Last detected at ${_time(state.observedAt)}. Current presence is unconfirmed.'
                                : 'Saved. Waiting for fresh watch reports.',
                          ),
                          TextButton.icon(
                            onPressed:
                                _saving ||
                                    _loading ||
                                    _scanning ||
                                    _needsRefresh
                                ? null
                                : () => _save(remove: true),
                            icon: const Icon(Icons.link_off),
                            label: const Text('Remove saved network'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_notice != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_notice!),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(_error!),
                  ),
                if (state?.homeProblem != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text(homeWifiMessage(state!.homeProblem!)),
                  ),
                if (_scanner.supported) ...[
                  const SizedBox(height: 12),
                  const Text(
                    'Find Wi-Fi names with your phone. Android needs location permission and Location switched on. Nearby names and identifiers are shared with Guardian to match the watch reports.',
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed:
                        _scanning ||
                            _loading ||
                            _saving ||
                            _needsRefresh ||
                            state?.homeKey == null
                        ? null
                        : _scanPhone,
                    icon: const Icon(Icons.wifi_find),
                    label: Text(
                      _scanning ? 'Scanning nearby Wi-Fi…' : 'Find Wi-Fi names',
                    ),
                  ),
                  if (_scanning) const LinearProgressIndicator(),
                  if (_phoneNotice != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      child: Text(_phoneNotice!),
                    ),
                ],
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Networks reported by the watch',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                    ),
                    IconButton(
                      onPressed: _loading || _saving || _scanning
                          ? null
                          : () => _load(manual: true),
                      tooltip: 'Refresh list',
                      icon: const Icon(Icons.refresh),
                    ),
                  ],
                ),
                if (_loading) const LinearProgressIndicator(),
                if (state != null && !state.connected)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 12),
                    child: Text(
                      'The watch is offline. Reconnect it to Guardian to receive new network reports.',
                    ),
                  ),
                if (networks.isEmpty && !_loading)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16),
                    child: Text(
                      'No recent networks yet. Keep the watch near your home router and wait for its next report. Refresh checks received reports.',
                    ),
                  ),
                for (final network in networks)
                  Card(
                    child: ListTile(
                      key: ValueKey(network.id),
                      leading: const Icon(Icons.wifi),
                      title: Text(network.name),
                      subtitle: Text(
                        'Radio …${network.radioHint} · ${network.signalDbm} dBm\n'
                        '${network.nameSource == 'phone' ? 'Name from phone · ' : ''}Seen ${_time(network.observedAt)}',
                      ),
                      isThreeLine: true,
                      trailing: Icon(
                        _selected == network.id
                            ? Icons.check_circle
                            : Icons.circle_outlined,
                      ),
                      selected: _selected == network.id,
                      onTap: _saving || _scanning || _needsRefresh
                          ? null
                          : () => setState(() {
                              _selected = network.id;
                              _confirmed = false;
                            }),
                    ),
                  ),
                if (_phoneFresh &&
                    !_needsRefresh &&
                    _phoneNetworks.asMap().keys.any(
                      (index) =>
                          !(state?.phoneMatches.contains(index) ?? false),
                    ))
                  Padding(
                    padding: const EdgeInsets.only(top: 12, bottom: 8),
                    child: Text(
                      'Seen only by your phone',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ),
                if (_phoneFresh && !_needsRefresh)
                  for (var index = 0; index < _phoneNetworks.length; index++)
                    if (!(state?.phoneMatches.contains(index) ?? false))
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.wifi),
                          title: Text(_phoneNetworks[index].ssid),
                          subtitle: Text(
                            'Radio …${_phoneNetworks[index].radioHint} · 2.4 GHz\nWaiting for the watch to report this network.',
                          ),
                          isThreeLine: true,
                          enabled: false,
                        ),
                      ),
                if (home != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    'Your saved Home pin',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 180,
                    child:
                        widget.mapBuilder?.call(home) ??
                        SafeZoneMap(zone: home),
                  ),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: _confirmed,
                    onChanged: _saving || _scanning || _selected == null
                        ? null
                        : (value) => setState(() => _confirmed = value == true),
                    title: const Text(
                      'I recognise this network and confirm this Home pin.',
                    ),
                  ),
                ],
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: canSave ? () => _save() : null,
                  icon: const Icon(Icons.wifi),
                  label: Text(_saving ? 'Saving…' : 'Save Home Wi-Fi'),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Detection depends on fresh watch reports. A missing network report does not mean the wearer has left home.',
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _time(DateTime? at) {
    if (at == null) return 'an unknown time';
    final local = at.toLocal();
    return '${local.day}/${local.month} ${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }
}
