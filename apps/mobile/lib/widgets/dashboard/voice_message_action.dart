import 'dart:async';
import 'package:flutter/material.dart';
import '../../screens/voice_messages_page.dart';
import '../../services/voice_messages_service.dart';

/// Wearer-scoped, read-only entry point. Opening it never sends a recording.
class VoiceMessageAction extends StatefulWidget {
  const VoiceMessageAction({
    super.key,
    required this.imei,
    required this.wearerName,
    this.client,
  });
  final String imei, wearerName;
  final VoiceMessagesClient? client;
  @override
  State<VoiceMessageAction> createState() => _VoiceMessageActionState();
}

class _VoiceMessageActionState extends State<VoiceMessageAction>
    with WidgetsBindingObserver {
  late final VoiceMessagesClient _client;
  Timer? _timer;
  StreamSubscription<void>? _auth;
  VoiceInbox? _inbox;
  bool _foreground = true, _loading = false;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    _client = widget.client ?? VoiceMessagesService();
    WidgetsBinding.instance.addObserver(this);
    _auth = _client.accessChanges.listen((_) => _invalidate());
    _timer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_foreground && TickerMode.valuesOf(context).enabled) {
        unawaited(_refresh());
      }
    });
    unawaited(_refresh());
  }

  @override
  void didUpdateWidget(VoiceMessageAction oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imei != widget.imei) _invalidate();
  }

  void _invalidate() {
    _generation++;
    if (mounted) setState(() => _inbox = null);
    if (_foreground) unawaited(_refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _invalidate();
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground) return;
    final generation = _generation;
    _loading = true;
    try {
      final inbox = await _client.load(widget.imei);
      if (mounted && _foreground && generation == _generation) {
        setState(() => _inbox = inbox);
      }
    } catch (_) {
      if (mounted && generation == _generation) setState(() => _inbox = null);
    } finally {
      _loading = false;
      if (mounted && _foreground && generation != _generation) {
        unawaited(_refresh());
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    unawaited(_auth?.cancel());
    if (widget.client == null) _client.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_inbox == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: OutlinedButton.icon(
        key: ValueKey('voice-messages-${widget.imei}'),
        onPressed: () async {
          await Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => VoiceMessagesPage(
                imei: widget.imei,
                wearerName: widget.wearerName,
              ),
            ),
          );
          if (mounted) unawaited(_refresh());
        },
        icon: Badge(
          isLabelVisible: _inbox!.unread > 0,
          label: Text('${_inbox!.unread}'),
          child: const Icon(Icons.chat_bubble_outline),
        ),
        label: Text(
          _inbox!.unread > 0
              ? 'Voice messages · ${_inbox!.unread} new'
              : 'Voice messages',
        ),
      ),
    );
  }
}
