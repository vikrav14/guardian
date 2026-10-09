import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/device.dart';
import '../theme/app_theme.dart';
import '../wellness/linked_wellness_stream.dart';
import '../widgets/cards/guardian_surface.dart';
import 'priority_update.dart';

typedef PriorityUpdateSource =
    Stream<Map<String, dynamic>> Function(String imei);
Stream<Map<String, dynamic>> watchPriorityUpdates(String imei) =>
    watchLinkedWellnessData(
      FirebaseFirestore.instance,
      FirebaseAuth.instance,
      imei,
      () => FirebaseFirestore.instance
          .collection('devices')
          .doc(imei)
          .collection('localUpdates')
          .doc('current')
          .snapshots()
          .map((doc) => [doc.data() ?? <String, dynamic>{}]),
      permission: 'location',
    ).map((rows) => rows.firstOrNull ?? <String, dynamic>{});

class LinkedPriorityUpdates extends StatefulWidget {
  const LinkedPriorityUpdates({
    super.key,
    required this.device,
    required this.weather,
    this.temperatureC,
    this.source = watchPriorityUpdates,
    this.clock = DateTime.now,
  });
  final Device device;
  final Widget weather;
  final double? temperatureC;
  final PriorityUpdateSource source;
  final DateTime Function() clock;
  @override
  State<LinkedPriorityUpdates> createState() => _LinkedPriorityUpdatesState();
}

class _LinkedPriorityUpdatesState extends State<LinkedPriorityUpdates> {
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Timer? _expiry;
  PriorityUpdates? _data;
  int _generation = 0, _index = 0;
  String? _weatherFor;
  @override
  void initState() {
    super.initState();
    _bind();
  }

  @override
  void didUpdateWidget(LinkedPriorityUpdates oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.device.imei != widget.device.imei ||
        oldWidget.source != widget.source ||
        oldWidget.device.allowsShared('location') !=
            widget.device.allowsShared('location')) {
      _bind();
    }
  }

  void _bind() {
    final generation = ++_generation;
    unawaited(_subscription?.cancel());
    _expiry?.cancel();
    _data = null;
    _weatherFor = null;
    _index = 0;
    if (!widget.device.allowsShared('location')) return;
    _subscription = widget
        .source(widget.device.imei)
        .listen(
          (value) {
            if (!mounted || generation != _generation) return;
            setState(() {
              _data = PriorityUpdates.fromMap(value);
              _index = 0;
            });
            _schedule();
          },
          onError: (Object error) {
            if (!mounted || generation != _generation) return;
            _expiry?.cancel();
            setState(() => _data = null);
          },
        );
  }

  void _schedule() {
    _expiry?.cancel();
    final now = widget.clock();
    final deadlines = <DateTime>[
      if (_data?.locationExpiry != null) _data!.locationExpiry!,
      if (_data?.observedAt != null)
        _data!.observedAt!.add(const Duration(minutes: 15)),
      for (final item in _data?.items ?? <PriorityUpdate>[]) ...[
        if (item.expiresAt != null) item.expiresAt!,
        if (item.checkedAt != null)
          item.checkedAt!.add(Duration(minutes: item.official ? 10 : 30)),
      ],
    ].where((date) => date.isAfter(now)).toList()..sort();
    final duration =
        deadlines.isEmpty ||
            deadlines.first.difference(now) > const Duration(minutes: 1)
        ? const Duration(minutes: 1)
        : deadlines.first.difference(now);
    _expiry = Timer(duration, () {
      if (mounted) {
        setState(() {});
        _schedule();
      }
    });
  }

  @override
  void dispose() {
    ++_generation;
    unawaited(_subscription?.cancel());
    _expiry?.cancel();
    super.dispose();
  }

  String _age(DateTime at) {
    final minutes = widget.clock().difference(at).inMinutes.clamp(0, 999999);
    return minutes < 1
        ? 'just now'
        : minutes < 60
        ? '${minutes}m ago'
        : '${minutes ~/ 60}h ago';
  }

  Future<void> _details(PriorityUpdate item) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) => SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                item.official ? 'Official warning' : 'Local report',
                style: Theme.of(context).textTheme.labelLarge,
              ),
              const SizedBox(height: 12),
              Text(
                item.title,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 16),
              Text(item.reason),
              const SizedBox(height: 12),
              const Text(
                'A nearby report does not confirm that the wearer is affected.',
              ),
              const SizedBox(height: 16),
              Text(
                '${item.source}\nPublished ${_age(item.publishedAt!)} · checked ${_age(item.checkedAt!)}',
              ),
              if (_data?.observedAt != null)
                Text('Watch location recorded ${_age(_data!.observedAt!)}'),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () async {
                  final messenger = ScaffoldMessenger.of(sheetContext);
                  bool opened;
                  try {
                    opened = await launchUrl(
                      item.uri!,
                      mode: LaunchMode.externalApplication,
                    );
                  } catch (_) {
                    opened = false;
                  }
                  if (!opened && mounted) {
                    messenger.showSnackBar(
                      const SnackBar(
                        content: Text(
                          'Could not open the source. Please try again.',
                        ),
                      ),
                    );
                  }
                },
                icon: const Icon(Icons.open_in_new),
                label: const Text('Read source report'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(sheetContext),
                child: const Text('Done'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.device.allowsShared('location')) return const SizedBox.shrink();
    final items =
        _data?.applicable(widget.device, widget.clock()) ?? <PriorityUpdate>[];
    final item = items.isEmpty
        ? null
        : items[_index.clamp(0, items.length - 1)];
    // The everyday overview uses the compact weather panel from the island
    // design. Reserve report space only when there is a relevant local update.
    // Applicability, expiry and permission checks remain above this UI choice.
    if (item == null) {
      return KeyedSubtree(
        key: const ValueKey('priority-slot'),
        child: widget.weather,
      );
    }
    final key = '${item.id}:${item.revision}';
    final showWeather = _weatherFor == key;
    final scale = (MediaQuery.textScalerOf(context).scale(14) / 14).clamp(
      1.0,
      4.0,
    );
    // Keep a stable slot while switching between a relevant report and weather.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: 48 * scale,
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Around ${widget.device.displayName}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.labelLarge,
                ),
              ),
              TextButton.icon(
                onPressed: () =>
                    setState(() => _weatherFor = showWeather ? null : key),
                icon: Icon(
                  showWeather ? Icons.article_outlined : Icons.cloud_outlined,
                  size: 18,
                ),
                label: Text(
                  showWeather
                      ? 'Update'
                      : widget.temperatureC == null
                      ? 'Weather'
                      : '${widget.temperatureC!.round()}°C',
                  semanticsLabel: showWeather
                      ? 'Show local update'
                      : 'Show weather',
                ),
              ),
            ],
          ),
        ),
        SizedBox(
          key: const ValueKey('priority-slot'),
          height: (scale > 1.3 ? 300 : 220) * scale,
          child: showWeather
              ? Center(child: SingleChildScrollView(child: widget.weather))
              : _report(context, item, items.length),
        ),
      ],
    );
  }

  Widget _report(BuildContext context, PriorityUpdate item, int count) {
    final colors = context.guardianColors;
    final theme = Theme.of(context).textTheme;
    final icon = switch (item.eventType) {
      'public_safety' => Icons.shield_outlined,
      'fire' => Icons.local_fire_department_outlined,
      'road_disruption' => Icons.traffic_outlined,
      'infrastructure_disruption' => Icons.power_off_outlined,
      _ => Icons.warning_amber_rounded,
    };
    return GuardianSurface(
      radius: 18,
      tonal: true,
      tint: item.official ? colors.accent : const Color(0xFFD8B66A),
      elevation: 0,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: colors.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.official ? 'OFFICIAL WARNING' : 'LOCAL REPORT',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.labelSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Expanded(
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                item.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: theme.titleMedium?.copyWith(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          Text(
            item.place,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.bodySmall,
          ),
          Text(
            'Location updated ${_age(_data!.observedAt!)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: theme.bodySmall,
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: Text(
                  '${item.official ? 'MMS' : item.source} · ${_age(item.publishedAt!)}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: theme.bodySmall,
                ),
              ),
              Flexible(
                flex: 2,
                child: TextButton(
                  onPressed: () => _details(item),
                  child: const Text('View update', textAlign: TextAlign.center),
                ),
              ),
              if (count > 1)
                IconButton(
                  tooltip: 'Next update (${_index + 1} of $count)',
                  onPressed: () => setState(() {
                    _index = (_index + 1) % count;
                    _weatherFor = null;
                  }),
                  icon: const Icon(Icons.chevron_right),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
