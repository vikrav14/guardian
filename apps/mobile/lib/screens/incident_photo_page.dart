import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/incident_photos.dart';
import '../services/safety_snapshot_service.dart';

class IncidentPhotoPage extends StatefulWidget {
  const IncidentPhotoPage({super.key, required this.incidentId, this.service, this.onClose});
  final String incidentId;
  final SafetySnapshotService? service;
  final VoidCallback? onClose;
  @override
  State<IncidentPhotoPage> createState() => _IncidentPhotoPageState();
}

class _IncidentPhotoPageState extends State<IncidentPhotoPage> with WidgetsBindingObserver {
  late final SafetySnapshotService _service;
  Timer? _timer;
  IncidentPhotoFeed? _feed;
  bool _foreground = true;
  bool _fresh = false;
  bool _loading = false;
  int _generation = 0;
  String? _error;
  final Map<String, Future<Uint8List>> _images = {};
  final Set<String> _deleting = {};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? SafetySnapshotService();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (mounted) setState(() {}); // Also hides photos at their exact next expiry check.
      if (_foreground && _error == null) unawaited(_refresh());
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _generation++;
    _images.clear();
    if (mounted) setState(() => _fresh = false);
    if (_foreground) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground) return;
    final generation = _generation;
    _loading = true;
    try {
      final feed = await _service.loadIncident(widget.incidentId).timeout(
        const Duration(seconds: 35),
        onTimeout: () => throw const SnapshotFailure('photo_service_timeout'),
      );
      if (!mounted || !_foreground || generation != _generation) return;
      setState(() {
        _feed = feed; _fresh = true; _error = null;
        _images.removeWhere((id, _) => !feed.photos.any((p) => p.id == id && p.viewable));
      });
    } catch (error) {
      if (!mounted || !_foreground || generation != _generation) return;
      setState(() {
        _feed = null; _fresh = false; _images.clear();
        _error = error is SnapshotFailure ? error.message : 'Could not load incident photos.';
      });
    } finally {
      _loading = false;
      if (mounted && _foreground && generation != _generation) unawaited(_refresh());
    }
  }

  Future<void> _delete(IncidentPhoto photo) async {
    setState(() { _deleting.add(photo.id); _images.remove(photo.id); });
    try {
      await _service.delete(photo.id);
      await _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Could not delete the photo. Please retry.')));
      }
    } finally {
      if (mounted) setState(() => _deleting.remove(photo.id));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel(); _images.clear();
    if (widget.service == null) _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    final visible = _foreground && _fresh;
    final status = switch (feed?.state) {
      'collecting' || 'preparing' => 'Requesting up to 5 photos, one at a time…',
      'complete' => 'Photo sequence finished',
      'stopped' => 'Photo sequence stopped. Available photos are kept below.',
      'expired' => 'These incident photos have expired.',
      'unavailable' => 'Photos are not available for this incident.',
      _ => 'Loading incident photos…',
    };
    return Scaffold(
      appBar: AppBar(
        title: const Text('Photos & AI details'),
        leading: widget.onClose == null ? null : IconButton(
          tooltip: 'Back to Guardian', icon: const Icon(Icons.arrow_back), onPressed: widget.onClose),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(padding: const EdgeInsets.all(20), children: [
          Center(child: ConstrainedBox(constraints: const BoxConstraints(maxWidth: 680),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(feed?.trial == true ? 'Supervised photo trial' : feed?.type == 'fall' ? 'Fall incident' : 'SOS incident',
                style: Theme.of(context).textTheme.headlineSmall),
              if (feed?.eventAt != null) Text(DateFormat('d MMM, HH:mm:ss').format(feed!.eventAt!.toLocal())),
              const SizedBox(height: 16),
              const Text('Check on the wearer now. Photos and AI descriptions cannot establish their condition or confirm their current location.'),
              const SizedBox(height: 16),
              Text(_error ?? status, key: const Key('incident-status')),
              if (feed != null) Text('${feed.received} of up to 5 photos available'),
              if (_error != null) TextButton.icon(onPressed: _refresh,
                icon: const Icon(Icons.refresh), label: const Text('Retry connection')),
              const SizedBox(height: 8),
              const Text('Private • Photos and AI details expire after 24 hours. Times shown are receipt times, not verified capture times.'),
              if (!visible && feed != null) const Padding(padding: EdgeInsets.only(top: 12),
                child: Text('Photos and AI details are hidden until access is checked again.')),
              if (visible && feed != null && feed.photos.any((p) => p.viewable && p.analysis?['status'] == 'ready')) ...[
                const SizedBox(height: 24),
                Text('Across the photos', style: Theme.of(context).textTheme.titleMedium),
                for (final photo in feed.photos.where((p) => p.viewable && p.analysis?['status'] == 'ready'))
                  Padding(padding: const EdgeInsets.only(top: 8),
                    child: Text('Photo ${photo.sequence}: ${(photo.analysis!['visibleDetails'] as List).first}')),
              ],
              const SizedBox(height: 24),
              for (final photo in feed?.photos ?? <IncidentPhoto>[]) _photo(photo, visible),
            ]))),
        ]),
      ),
    );
  }

  Widget _photo(IncidentPhoto photo, bool visible) {
    final show = visible && photo.viewable && !_deleting.contains(photo.id);
    return Card(margin: const EdgeInsets.only(bottom: 20), child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Photo ${photo.sequence}', style: Theme.of(context).textTheme.titleLarge),
        if (photo.receivedAt != null) Text('Received ${DateFormat('HH:mm:ss').format(photo.receivedAt!.toLocal())}'),
        if (!show) Padding(padding: const EdgeInsets.symmetric(vertical: 16), child: Text(
          _deleting.contains(photo.id) ? 'Deleting…' : photo.state == 'deleted' ? 'Deleted' :
          photo.state == 'failed' ? 'No photo received for this request.' :
          photo.state == 'expired' || (photo.state == 'available' && !photo.viewable) ? 'Expired' :
          photo.viewable ? 'Private photo hidden' : 'Waiting for photo…')),
        if (show) ...[
          const SizedBox(height: 12),
          FutureBuilder<Uint8List>(future: _images.putIfAbsent(photo.id, () => _service.loadImage(photo.id)),
            builder: (context, snapshot) {
              if (snapshot.hasError) return const Text('This photo cannot be opened.');
              if (!snapshot.hasData) return const SizedBox(height: 200, child: Center(child: CircularProgressIndicator()));
              return _AdjustedPhoto(key: ValueKey(photo.id), bytes: snapshot.data!);
            }),
          const SizedBox(height: 16),
          Text('Guardian AI photo insights', style: Theme.of(context).textTheme.titleMedium),
          const Text('AI interpretation of the original. Details may be incorrect; check the photo.'),
          const SizedBox(height: 8),
          _analysis(photo.analysis),
          TextButton.icon(onPressed: () => _delete(photo), icon: const Icon(Icons.delete_outline),
            label: const Text('Delete photo & AI details')),
        ],
      ]),
    ));
  }

  Widget _analysis(Map<String, dynamic>? analysis) {
    final status = analysis?['status'];
    if (status == 'unavailable') return const Text('AI analysis unavailable. The original photo remains available.');
    if (status != 'ready' && status != 'too_unclear') return const Text('Analysing this photo…');
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (status == 'too_unclear') const Text('Too unclear to assess'),
      for (final section in [('visibleDetails', 'Visible details'), ('uncertainDetails', 'Uncertain details'), ('limitations', 'Image limitations')])
        if ((analysis![section.$1] as List<dynamic>? ?? []).isNotEmpty) ...[
          const SizedBox(height: 8), Text(section.$2, style: const TextStyle(fontWeight: FontWeight.w600)),
          for (final text in analysis[section.$1] as List<dynamic>) Text('• $text'),
        ],
    ]);
  }
}

class _AdjustedPhoto extends StatefulWidget {
  const _AdjustedPhoto({super.key, required this.bytes});
  final Uint8List bytes;
  @override
  State<_AdjustedPhoto> createState() => _AdjustedPhotoState();
}

class _AdjustedPhotoState extends State<_AdjustedPhoto> {
  late final MemoryImage _image = MemoryImage(widget.bytes);
  int _turns = 0;
  double _brightness = 0;
  @override
  void dispose() { unawaited(_image.evict()); super.dispose(); }
  @override
  Widget build(BuildContext context) => Column(children: [
    ColorFiltered(colorFilter: ColorFilter.matrix([
      1, 0, 0, 0, _brightness, 0, 1, 0, 0, _brightness, 0, 0, 1, 0, _brightness, 0, 0, 0, 1, 0,
    ]), child: RotatedBox(quarterTurns: _turns, child: Image(image: _image, height: 280,
      fit: BoxFit.contain, semanticLabel: 'Original photo received from the watch',
      errorBuilder: (_, _, _) => const Text('This photo could not be displayed.')))),
    Wrap(spacing: 12, alignment: WrapAlignment.center, children: [
      TextButton.icon(onPressed: () => setState(() => _turns = (_turns + 1) % 4),
        icon: const Icon(Icons.rotate_right), label: const Text('Rotate')),
      TextButton(onPressed: () => setState(() { _turns = 0; _brightness = 0; }), child: const Text('Original')),
    ]),
    Row(children: [const Icon(Icons.brightness_6_outlined), Expanded(child: Slider(
      label: 'Brightness', value: _brightness, min: -40, max: 70,
      onChanged: (value) => setState(() => _brightness = value),))]),
    Text(_turns == 0 && _brightness == 0 ? 'Original photo' : 'Adjusted view • rotation / brightness only'),
  ]);
}
