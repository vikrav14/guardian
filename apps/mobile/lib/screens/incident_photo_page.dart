import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';

import '../models/incident_photos.dart';
import '../services/safety_snapshot_service.dart';

class IncidentPhotoPage extends StatefulWidget {
  const IncidentPhotoPage({
    super.key,
    required this.incidentId,
    this.service,
    this.onClose,
    this.wearerName,
    this.onCall,
    this.onLocation,
  });
  final String incidentId;
  final SafetySnapshotService? service;
  final VoidCallback? onClose;
  final String? wearerName;
  final VoidCallback? onCall, onLocation;
  @override
  State<IncidentPhotoPage> createState() => _IncidentPhotoPageState();
}

class _IncidentPhotoPageState extends State<IncidentPhotoPage>
    with WidgetsBindingObserver {
  late final SafetySnapshotService _service;
  Timer? _timer;
  IncidentPhotoFeed? _feed;
  bool _foreground = true;
  bool _fresh = false;
  bool _loading = false;
  bool _requesting = false;
  String? _requestKey;
  String? _requestError;
  int _generation = 0;
  String? _error;
  DateTime? _lastRefresh;
  final Map<String, Future<Uint8List>> _images = {};
  final Map<String, _PhotoViewAdjustment> _adjustments = {};
  final Set<String> _deleting = {};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? SafetySnapshotService();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) setState(() {});
      final active =
          _feed?.collecting == true ||
          _requesting ||
          [
            'camera_busy',
            'automatic_photo_pending',
          ].contains(_feed?.photoAccess?.reason) ||
          (_feed?.photoAccess?.reason == 'incident_photo_settling' &&
              _feed?.photoAccess?.retryAt?.isAfter(
                    _feed!.photoAccess!.serverNow,
                  ) ==
                  false) ||
          (_feed?.photos.any(
                (photo) =>
                    photo.viewable &&
                    [
                      'pending',
                      'analysing',
                    ].contains(photo.analysis?['status']),
              ) ??
              false);
      if (_foreground &&
          _error == null &&
          (active ||
              _lastRefresh == null ||
              DateTime.now().difference(_lastRefresh!) >=
                  const Duration(seconds: 30))) {
        unawaited(_refresh());
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _generation++;
    _images.clear();
    _lastRefresh = null;
    if (mounted) setState(() => _fresh = false);
    if (_foreground) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground) return;
    final generation = _generation;
    _loading = true;
    _lastRefresh = DateTime.now();
    try {
      final feed = await _service
          .loadIncident(widget.incidentId)
          .timeout(
            const Duration(seconds: 35),
            onTimeout: () =>
                throw const SnapshotFailure('photo_service_timeout'),
          );
      if (!mounted || !_foreground || generation != _generation) return;
      setState(() {
        _feed = feed;
        _fresh = true;
        _error = null;
        _images.removeWhere(
          (id, _) => !feed.photos.any((p) => p.id == id && p.viewable),
        );
        _adjustments.removeWhere(
          (id, _) => !feed.photos.any((p) => p.id == id && p.viewable),
        );
      });
    } catch (error) {
      if (!mounted || !_foreground || generation != _generation) return;
      setState(() {
        _feed = null;
        _fresh = false;
        _images.clear();
        _adjustments.clear();
        _error = error is SnapshotFailure
            ? error.message
            : 'Could not load incident photos.';
      });
    } finally {
      _loading = false;
      if (mounted && _foreground && generation != _generation) {
        unawaited(_refresh());
      }
    }
  }

  Future<void> _delete(IncidentPhoto photo) async {
    setState(() {
      // Invalidate a status request begun before deletion; its late response
      // must not restore a scene description after the photo was removed.
      _generation++;
      _fresh = false;
      _deleting.add(photo.id);
      _adjustments.remove(photo.id);
      _images.clear();
    });
    try {
      await _service.delete(photo.id);
      await _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not delete the photo. Please retry.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _deleting.remove(photo.id));
    }
  }

  Future<void> _requestPhoto() async {
    if (_requesting ||
        !_fresh ||
        !_foreground ||
        _feed?.photoAccess?.requestEnabled != true) {
      return;
    }
    setState(() {
      _generation++;
      _fresh = false;
      _requesting = true;
      _requestError = null;
    });
    // Retain the same intent after an ambiguous transport failure. A repeated
    // tap can only retrieve that request, never silently create another capture.
    _requestKey ??= const Uuid().v4();
    try {
      await _service.requestIncidentPhoto(widget.incidentId, _requestKey!);
      _requestKey = null;
      if (mounted) setState(() => _fresh = false);
      await _refresh();
    } catch (error) {
      if (error is SnapshotFailure && error.code != 'request_status_unknown') {
        _requestKey = null;
      }
      if (mounted) {
        setState(
          () => _requestError = error is SnapshotFailure
              ? error.message
              : 'Could not check the photo request.',
        );
      }
      await _refresh();
    } finally {
      if (mounted) setState(() => _requesting = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _images.clear();
    if (widget.service == null) _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    final visible = _foreground && _fresh;
    final access = feed?.photoAccess;
    final status = access != null
        ? (feed!.collecting
              ? 'Requesting the first photo…'
              : feed.received == 0
              ? 'No photo received yet.'
              : 'Available photos and AI details')
        : switch (feed?.state) {
            'collecting' || 'preparing' => 'Waiting for incident photos…',
            'complete' => 'Photo sequence finished',
            'stopped' =>
              'Photo sequence stopped. Available photos are kept below.',
            'expired' => 'These incident photos have expired.',
            'unavailable' => 'Photos are not available for this incident.',
            _ => 'Loading incident photos…',
          };
    return Scaffold(
      appBar: AppBar(
        title: const Text('Incident photos'),
        leading: widget.onClose == null
            ? null
            : IconButton(
                tooltip: 'Back to Guardian',
                icon: const Icon(Icons.arrow_back),
                onPressed: widget.onClose,
              ),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 680),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (widget.wearerName != null) ...[
                      Text(
                        widget.wearerName!,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      const SizedBox(height: 6),
                    ],
                    Text(
                      feed?.trial == true
                          ? 'Supervised photo trial'
                          : switch (feed?.type) {
                              'fall' => 'Fall incident',
                              'sos' => 'SOS incident',
                              _ => 'Incident photos',
                            },
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    if (feed?.eventAt != null)
                      Text(
                        DateFormat(
                          'd MMM, HH:mm:ss',
                        ).format(feed!.eventAt!.toLocal()),
                      ),
                    const SizedBox(height: 16),
                    const Text(
                      'Check on the wearer now. Photos and AI descriptions cannot establish their condition or confirm their current location.',
                    ),
                    if (widget.onCall != null || widget.onLocation != null) ...[
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 12,
                        runSpacing: 8,
                        children: [
                          if (widget.onCall != null)
                            OutlinedButton.icon(
                              onPressed: widget.onCall,
                              icon: const Icon(Icons.phone_outlined),
                              label: const Text('Call watch'),
                            ),
                          if (widget.onLocation != null)
                            OutlinedButton.icon(
                              onPressed: widget.onLocation,
                              icon: const Icon(Icons.location_on_outlined),
                              label: const Text('View location'),
                            ),
                        ],
                      ),
                    ],
                    const SizedBox(height: 16),
                    Text(_error ?? status, key: const Key('incident-status')),
                    if (feed != null)
                      Text(
                        '${feed.received} ${feed.received == 1 ? 'photo' : 'photos'} available',
                      ),
                    if (access != null) ...[
                      const SizedBox(height: 16),
                      Text(
                        access.windowOpen
                            ? 'Photo access open · ${access.minutesLeft} min left'
                            : 'Photo request window closed',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      if (access.endsAt != null && access.windowOpen)
                        Text(
                          'Request photos until ${DateFormat.Hm().format(access.endsAt!.toLocal())}',
                        ),
                      if (feed!.photos.isNotEmpty) ...[
                        const SizedBox(height: 16),
                        _photo(feed.photos.first, visible),
                      ],
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        key: const Key('incident-request-photo'),
                        onPressed:
                            visible && access.requestEnabled && !_requesting
                            ? _requestPhoto
                            : null,
                        icon: Icon(
                          _requesting ||
                                  [
                                    'camera_busy',
                                    'automatic_photo_pending',
                                  ].contains(access.reason)
                              ? Icons.hourglass_top
                              : Icons.camera_alt_outlined,
                        ),
                        label: Text(
                          _requesting
                              ? 'Requesting photo…'
                              : [
                                      'camera_busy',
                                      'automatic_photo_pending',
                                    ].contains(access.reason) &&
                                    access.windowOpen
                              ? 'Waiting for photo…'
                              : !access.windowOpen
                              ? 'Photo request window closed'
                              : _requestKey != null
                              ? 'Check previous request'
                              : 'Take another photo',
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(_requestError ?? access.message),
                    ],
                    if (_error != null)
                      TextButton.icon(
                        onPressed: _refresh,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry connection'),
                      ),
                    const SizedBox(height: 8),
                    const Text(
                      'Private • Photos and AI details expire after 24 hours. Times shown are receipt times, not verified capture times.',
                    ),
                    if (!visible && feed != null)
                      const Padding(
                        padding: EdgeInsets.only(top: 12),
                        child: Text(
                          'Photos and AI details are hidden until access is checked again.',
                        ),
                      ),
                    if (visible &&
                        feed != null &&
                        (access == null || feed.photos.length > 1) &&
                        feed.photos.any(
                          (p) => p.viewable && p.sceneSummary != null,
                        )) ...[
                      const SizedBox(height: 24),
                      Text(
                        'Across the photos',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      for (final photo in feed.photos.where(
                        (p) => p.viewable && p.sceneSummary != null,
                      ))
                        Padding(
                          padding: const EdgeInsets.only(top: 8),
                          child: Text(
                            'Photo ${photo.sequence}: ${photo.sceneSummary}',
                          ),
                        ),
                    ],
                    const SizedBox(height: 24),
                    for (final photo
                        in (feed?.photos ?? <IncidentPhoto>[]).skip(
                          access == null ? 0 : 1,
                        ))
                      _photo(photo, visible),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _photo(IncidentPhoto photo, bool visible) {
    final show = visible && photo.viewable && !_deleting.contains(photo.id);
    return Card(
      margin: const EdgeInsets.only(bottom: 20),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Photo ${photo.sequence}',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            if (photo.receivedAt != null)
              Text(
                'Received ${DateFormat('HH:mm:ss').format(photo.receivedAt!.toLocal())}',
              ),
            if (!show)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  _deleting.contains(photo.id)
                      ? 'Deleting…'
                      : photo.state == 'deleted'
                      ? 'Deleted'
                      : photo.state == 'failed'
                      ? 'Photo unavailable for this request.'
                      : photo.state == 'expired' ||
                            (photo.state == 'available' && !photo.viewable)
                      ? 'Expired'
                      : photo.viewable
                      ? 'Private photo hidden'
                      : 'Waiting for photo…',
                ),
              ),
            if (show) ...[
              const SizedBox(height: 12),
              FutureBuilder<Uint8List>(
                future: _images.putIfAbsent(
                  photo.id,
                  () => _service.loadImage(photo.id),
                ),
                builder: (context, snapshot) {
                  if (snapshot.hasError) {
                    return const Text('This photo cannot be opened.');
                  }
                  if (!snapshot.hasData) {
                    return const SizedBox(
                      height: 200,
                      child: Center(child: CircularProgressIndicator()),
                    );
                  }
                  return _AdjustedPhoto(
                    key: ValueKey(photo.id),
                    bytes: snapshot.data!,
                    suggestedQuarterTurns: photo.suggestedQuarterTurns,
                    adjustment: _adjustments.putIfAbsent(
                      photo.id,
                      _PhotoViewAdjustment.new,
                    ),
                  );
                },
              ),
              const SizedBox(height: 16),
              Text(
                'Guardian AI photo insights',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const Text(
                'AI description of this photo. Check against the image.',
              ),
              const SizedBox(height: 8),
              _analysis(photo.analysis),
              TextButton.icon(
                onPressed: () => _delete(photo),
                icon: const Icon(Icons.delete_outline),
                label: const Text('Delete photo & AI details'),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _analysis(Map<String, dynamic>? analysis) {
    final status = analysis?['status'];
    if (status == 'unavailable') {
      if ([
        'analysis_orientation_uncertain',
        'analysis_orientation_inconsistent',
      ].contains(analysis?['reason'])) {
        return const Text(
          'AI could not establish the photo orientation. You can rotate and inspect the original.',
        );
      }
      return const Text(
        'AI analysis unavailable. The original photo remains available.',
      );
    }
    if (status != 'ready' && status != 'too_unclear') {
      return const Text('Analysing this photo…');
    }
    List<String> details(String key) => (analysis?[key] as List<dynamic>? ?? [])
        .whereType<String>()
        .map((text) => text.trim())
        .where((text) => text.isNotEmpty)
        .toSet()
        .toList();
    final visibleDetails = details('visibleDetails');
    final summary = (analysis?['summary'] as String?)?.trim();
    final hasSummary = summary != null && summary.isNotEmpty;
    final uncertain = details('uncertainDetails');
    final limitations = details(
      'limitations',
    ).where((text) => !uncertain.contains(text)).toList();
    final extra = [
      ('Also visible', hasSummary ? visibleDetails : <String>[]),
      ('Uncertain details', uncertain.skip(1).toList()),
      ('Image quality', limitations.skip(1).toList()),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (status == 'too_unclear') const Text('Limited visual detail'),
        if (hasSummary || visibleDetails.isNotEmpty)
          Text(hasSummary ? summary : visibleDetails.join(' ')),
        if ([
          'conflicting',
          'not_selected',
        ].contains(analysis?['orientationSelection']?['verification']))
          const Text(
            'Automatic orientation is uncertain. Use Rotate to adjust the view.',
          ),
        for (final caveat in [
          if (uncertain.isNotEmpty) uncertain.first,
          if (limitations.isNotEmpty) limitations.first,
        ])
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(caveat)),
        if (extra.any((section) => section.$2.isNotEmpty))
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: const EdgeInsets.only(bottom: 8),
            expandedCrossAxisAlignment: CrossAxisAlignment.start,
            title: const Text('More photo details'),
            children: [
              for (final section in extra)
                if (section.$2.isNotEmpty) ...[
                  Text(
                    section.$1,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  for (final text in section.$2) Text('• $text'),
                  const SizedBox(height: 8),
                ],
            ],
          ),
      ],
    );
  }
}

// These session-only viewing choices contain no image or AI content. Keep them
// across foreground reauthorization so a late AI result cannot undo a choice.
class _PhotoViewAdjustment {
  int? quarterTurns;
  double brightness = 0;
}

class _AdjustedPhoto extends StatefulWidget {
  const _AdjustedPhoto({
    super.key,
    required this.bytes,
    required this.adjustment,
    this.suggestedQuarterTurns,
  });
  final Uint8List bytes;
  final _PhotoViewAdjustment adjustment;
  final int? suggestedQuarterTurns;
  @override
  State<_AdjustedPhoto> createState() => _AdjustedPhotoState();
}

class _AdjustedPhotoState extends State<_AdjustedPhoto> {
  late final MemoryImage _image = MemoryImage(widget.bytes);
  int get _turns =>
      widget.adjustment.quarterTurns ?? widget.suggestedQuarterTurns ?? 0;
  double get _brightness => widget.adjustment.brightness;
  bool get _autoRotated =>
      widget.adjustment.quarterTurns == null && _turns != 0;
  @override
  void dispose() {
    unawaited(_image.evict());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      ColorFiltered(
        colorFilter: ColorFilter.matrix([
          1,
          0,
          0,
          0,
          _brightness,
          0,
          1,
          0,
          0,
          _brightness,
          0,
          0,
          1,
          0,
          _brightness,
          0,
          0,
          0,
          1,
          0,
        ]),
        child: RotatedBox(
          quarterTurns: _turns,
          child: Image(
            image: _image,
            height: 280,
            fit: BoxFit.contain,
            semanticLabel: _turns == 0
                ? 'Original photo received from the watch'
                : 'Watch photo rotated for viewing',
            errorBuilder: (_, _, _) =>
                const Text('This photo could not be displayed.'),
          ),
        ),
      ),
      Wrap(
        spacing: 12,
        alignment: WrapAlignment.center,
        children: [
          TextButton.icon(
            onPressed: () => setState(
              () => widget.adjustment.quarterTurns = (_turns + 1) % 4,
            ),
            icon: const Icon(Icons.rotate_right),
            label: const Text('Rotate'),
          ),
          TextButton(
            onPressed: () => setState(() {
              widget.adjustment.quarterTurns = 0;
              widget.adjustment.brightness = 0;
            }),
            child: const Text('Original'),
          ),
          if ((widget.suggestedQuarterTurns ?? 0) != 0)
            TextButton(
              onPressed: () =>
                  setState(() => widget.adjustment.quarterTurns = null),
              child: const Text('Auto rotate'),
            ),
        ],
      ),
      Row(
        children: [
          const Icon(Icons.brightness_6_outlined),
          Expanded(
            child: Slider(
              label: 'Brightness',
              value: _brightness,
              min: -40,
              max: 70,
              onChanged: (value) =>
                  setState(() => widget.adjustment.brightness = value),
            ),
          ),
        ],
      ),
      Text(
        _autoRotated
            ? (_brightness == 0
                  ? 'Auto-rotated • original preserved'
                  : 'Auto-rotated • brightness adjusted')
            : _turns == 0 && _brightness == 0
            ? 'Original photo'
            : 'Adjusted view • rotation / brightness only',
      ),
    ],
  );
}
