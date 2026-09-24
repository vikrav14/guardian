import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/safety_snapshot.dart';
import '../services/safety_snapshot_service.dart';

class SafetySnapshotPage extends StatefulWidget {
  const SafetySnapshotPage({super.key, required this.imei, required this.name,
    this.service});
  final String imei;
  final String name;
  final SafetySnapshotService? service;

  @override
  State<SafetySnapshotPage> createState() => _SafetySnapshotPageState();
}

class _SafetySnapshotPageState extends State<SafetySnapshotPage>
    with WidgetsBindingObserver {
  late final SafetySnapshotService _service;
  Timer? _poll;
  SnapshotFeed? _feed;
  String? _error;
  bool _loading = false;
  bool _sending = false;
  bool _foreground = true;
  DateTime? _lastRefresh;
  final Map<String, Future<Uint8List>> _images = {};
  final Set<String> _deleting = {};

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? SafetySnapshotService();
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _poll = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!_foreground) return;
      final pending = _sending || (_feed?.items.any((item) => item.isPending) ?? false);
      if (pending || _lastRefresh == null || DateTime.now().difference(_lastRefresh!) >= const Duration(seconds: 30)) {
        unawaited(_refresh());
      } else if (mounted) {
        setState(() { _images.removeWhere((id, _) => !(_feed?.items.any((item) => item.id == id && item.isViewable) ?? false)); });
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (!_foreground) {
      _clearImages();
      if (mounted) setState(() => _feed = null);
    } else {
      unawaited(_refresh());
    }
  }

  void _clearImages() {
    // No disk cache, download URL or persistent image bytes are used.
    _images.clear();
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground) return;
    _loading = true;
    _lastRefresh = DateTime.now();
    try {
      final feed = await _service.load(widget.imei);
      if (!mounted || !_foreground) return;
      setState(() {
        _feed = feed;
        _error = null;
        _images.removeWhere((id, _) => !feed.items.any((item) => item.id == id && item.isViewable));
      });
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _message(error);
          _feed = null;
          _clearImages();
        });
      }
    } finally { _loading = false; }
  }

  String _message(Object error) => error is SnapshotFailure
      ? error.message : const SnapshotFailure('network').message;

  Future<void> _takePhoto() async {
    final purpose = await showDialog<String>(context: context,
      builder: (_) => const _PhotoPermissionDialog());
    if (purpose == null || !mounted) return;
    setState(() => _sending = true);
    try {
      await _service.requestSnapshot(imei: widget.imei, purpose: purpose,
        consentConfirmed: true, safetyPurposeConfirmed: true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(error is SnapshotFailure ? error.message
            : 'The request status is uncertain. Checking for a photo; please wait before trying again.'),
        ));
      }
    } finally {
      if (mounted) {
        await _refresh();
        if (mounted) setState(() => _sending = false);
      }
    }
  }

  Future<void> _delete(SafetySnapshot item) async {
    setState(() { _deleting.add(item.id); _images.remove(item.id); });
    try {
      await _service.delete(item.id);
      await _refresh();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_message(error))));
      }
      await _refresh();
    } finally {
      if (mounted) setState(() => _deleting.remove(item.id));
    }
  }

  @override
  void dispose() {
    _poll?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    _clearImages();
    if (widget.service == null) _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final feed = _feed;
    final waiting = _sending || (feed?.items.any((item) => item.isPending) ?? false);
    final cooling = feed?.retryAt?.isAfter(DateTime.now()) ?? false;
    final canRequest = feed != null && feed.cameraAvailable && feed.online &&
        !waiting && !cooling && _foreground;
    final explanation = _error ?? (feed == null ? 'Connecting to your watch…'
        : !feed.cameraAvailable ? 'Photos are not available for this watch yet.'
        : !feed.online ? 'The watch needs to be connected to take a photo.'
        : waiting ? 'Waiting for the watch to send one photo. This can take up to two minutes.'
        : cooling ? 'Next photo available after ${DateFormat.Hm().format(feed.retryAt!.toLocal())}.'
        : 'Take one photo from ${widget.name}’s watch.');
    return Scaffold(
      appBar: AppBar(title: const Text('Safety snapshot')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Center(child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 640),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(widget.name, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text(explanation),
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: canRequest ? _takePhoto : null,
                    icon: waiting
                        ? const SizedBox(width: 18, height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.photo_camera_outlined),
                    label: Text(waiting ? 'Taking photo…' : 'Take photo'),
                  ),
                  const SizedBox(height: 12),
                  const Text('Photos are private and expire after 24 hours. '
                    'A snapshot gives context; it does not confirm that someone is safe.'),
                  const SizedBox(height: 24),
                  if (feed != null && feed.items.isEmpty)
                    const Padding(padding: EdgeInsets.symmetric(vertical: 36),
                      child: Column(children: [
                        Icon(Icons.photo_outlined, size: 48),
                        SizedBox(height: 12), Text('Your first photo will appear here.'),
                      ])),
                  for (final item in feed?.items ?? const <SafetySnapshot>[])
                    _photo(item),
                ]),
            )),
          ],
        ),
      ),
    );
  }

  Widget _photo(SafetySnapshot item) {
    final deleting = _deleting.contains(item.id);
    return Card(margin: const EdgeInsets.only(bottom: 16),
      child: Padding(padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text(deleting ? 'Deleting…' : item.statusLabel,
            style: Theme.of(context).textTheme.titleMedium),
          if (item.receivedAt != null) ...[
            const SizedBox(height: 4),
            Text('Received ${DateFormat('d MMM, HH:mm:ss').format(item.receivedAt!.toLocal())}'),
          ],
          if (item.isViewable && !deleting) ...[
            const SizedBox(height: 12),
            FutureBuilder<Uint8List>(
              future: _images.putIfAbsent(item.id, () => _service.loadImage(item.id)),
              builder: (context, snapshot) {
                if (snapshot.hasError) return const Text('This photo cannot be opened.');
                if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
                return _PrivatePhoto(bytes: snapshot.data!);
              },
            ),
            const SizedBox(height: 8),
            TextButton.icon(onPressed: () => _delete(item),
              icon: const Icon(Icons.delete_outline), label: const Text('Delete photo')),
          ],
          if (item.state == SafetySnapshotState.failed)
            const Text('The watch did not provide a complete photo for this request.'),
          if (item.isPending)
            TextButton(onPressed: deleting ? null : () => _delete(item),
              child: const Text('Cancel waiting')),
        ]),
      ),
    );
  }
}

class _PrivatePhoto extends StatefulWidget {
  const _PrivatePhoto({required this.bytes});
  final Uint8List bytes;
  @override
  State<_PrivatePhoto> createState() => _PrivatePhotoState();
}
class _PrivatePhotoState extends State<_PrivatePhoto> {
  late MemoryImage _provider;
  @override
  void initState() { super.initState(); _provider = MemoryImage(widget.bytes); }
  @override
  void didUpdateWidget(_PrivatePhoto oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.bytes, widget.bytes)) {
      unawaited(_provider.evict()); _provider = MemoryImage(widget.bytes);
    }
  }
  @override
  void dispose() { unawaited(_provider.evict()); super.dispose(); }
  @override
  Widget build(BuildContext context) => Image(image: _provider, height: 300,
    fit: BoxFit.contain, semanticLabel: 'Photo received from the watch',
    errorBuilder: (_, _, _) => const Text('This photo could not be displayed.'));
}

class _PhotoPermissionDialog extends StatefulWidget {
  const _PhotoPermissionDialog();
  @override
  State<_PhotoPermissionDialog> createState() => _PhotoPermissionDialogState();
}
class _PhotoPermissionDialogState extends State<_PhotoPermissionDialog> {
  final _purpose = TextEditingController(text: 'Check immediate surroundings');
  bool _confirmed = false;
  @override
  void dispose() { _purpose.dispose(); super.dispose(); }
  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Take one photo'),
    content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min,
      children: [
        TextField(controller: _purpose, maxLength: 160,
          onChanged: (_) => setState(() {}),
          decoration: const InputDecoration(labelText: 'Reason for this safety check')),
        CheckboxListTile(contentPadding: EdgeInsets.zero,
          value: _confirmed, onChanged: (value) => setState(() => _confirmed = value ?? false),
          title: const Text('I have the wearer’s or responsible guardian’s permission '
            'and am requesting this photo for a safety check.')),
      ])),
    actions: [
      TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
      FilledButton(onPressed: _confirmed && _purpose.text.trim().length >= 8
          ? () => Navigator.pop(context, _purpose.text.trim()) : null,
        child: const Text('Take photo')),
    ],
  );
}
