import 'dart:async';
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../services/reminder_recording.dart';
import '../services/voice_messages_service.dart';
import '../theme/app_theme.dart';

abstract class VoiceClipPlayer {
  Stream<void> get completed;
  Future<void> play(Uint8List wav);
  Future<void> stop();
  Future<void> dispose();
}

class DeviceVoiceClipPlayer implements VoiceClipPlayer {
  final _player = AudioPlayer();
  @override
  Stream<void> get completed => _player.onPlayerComplete;
  @override
  Future<void> play(Uint8List wav) =>
      _player.play(BytesSource(wav, mimeType: 'audio/wav'));
  @override
  Future<void> stop() => _player.stop();
  @override
  Future<void> dispose() => _player.dispose();
}

class VoiceMessagesPage extends StatefulWidget {
  const VoiceMessagesPage({
    super.key,
    required this.imei,
    required this.wearerName,
    this.client,
    this.recorder,
    this.player,
  });
  final String imei, wearerName;
  final VoiceMessagesClient? client;
  final ReminderRecorder? recorder;
  final VoiceClipPlayer? player;
  @override
  State<VoiceMessagesPage> createState() => _VoiceMessagesPageState();
}

class _VoiceMessagesPageState extends State<VoiceMessagesPage>
    with WidgetsBindingObserver {
  late final VoiceMessagesClient _client;
  late final ReminderRecorder _recorder;
  late final VoiceClipPlayer _player;
  StreamSubscription<void>? _auth, _completion;
  StreamSubscription<Uint8List>? _capture;
  Timer? _poll, _recordTimer;
  VoiceInbox? _inbox;
  String? _error, _playing, _pendingId;
  Uint8List? _draft;
  BytesBuilder? _bytes;
  bool _foreground = true,
      _loading = false,
      _sending = false,
      _recording = false,
      _starting = false,
      _stopping = false;
  int _generation = 0, _recordedBytes = 0;
  int _playGeneration = 0;
  bool _playLoading = false;
  bool get _canRecord =>
      _foreground &&
      _inbox?.connected == true &&
      _error == null &&
      !_sending &&
      !_starting &&
      !_stopping &&
      _pendingId == null &&
      _inbox?.sendingBlocked == false &&
      _inbox?.coolingDown == false;
  bool get _valid => mounted && _foreground;

  @override
  void initState() {
    super.initState();
    _client = widget.client ?? VoiceMessagesService();
    _recorder = widget.recorder ?? MicrophoneReminderRecorder();
    _player = widget.player ?? DeviceVoiceClipPlayer();
    WidgetsBinding.instance.addObserver(this);
    _auth = _client.accessChanges.listen((_) => _clearAccess());
    _completion = _player.completed.listen((_) {
      if (mounted) setState(() => _playing = null);
    });
    _poll = Timer.periodic(const Duration(seconds: 10), (_) {
      if (_foreground) unawaited(_refresh());
    });
    unawaited(_refresh());
  }

  void _clearAccess() {
    if (!mounted) return;
    _generation++;
    _playGeneration++;
    setState(() {
      _inbox = null;
      _draft = null;
      _playing = null;
    });
    unawaited(_stopRecording(discard: true));
    unawaited(_player.stop());
    if (_foreground) unawaited(_refresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _clearAccess();
  }

  Future<void> _refresh() async {
    if (_loading || !_valid) return;
    final generation = _generation;
    _loading = true;
    try {
      final inbox = await _client.load(widget.imei);
      if (!_valid || generation != _generation) return;
      setState(() {
        _inbox = inbox;
        _error = null;
        if (inbox.messages.any(
          (m) =>
              m.id == _pendingId &&
              !['sending', 'preparing'].contains(m.status),
        )) {
          _pendingId = null;
        }
      });
      if (_playing != null &&
          _playing != 'draft' &&
          !inbox.messages.any((m) => m.id == _playing && m.available)) {
        await _player.stop();
        if (mounted) setState(() => _playing = null);
      }
    } catch (error) {
      if (!_valid || generation != _generation) return;
      _playGeneration++;
      setState(() {
        _inbox = null;
        _error = _message(error);
        _draft = null;
        _playing = null;
      });
      await _stopRecording(discard: true);
      await _player.stop();
    } finally {
      _loading = false;
      if (_valid && generation != _generation) unawaited(_refresh());
    }
  }

  String _message(Object error) => error is VoiceMessageException
      ? error.message
      : 'Could not confirm the connection. Refresh to check the message status.';

  Future<void> _startRecording() async {
    if (!_canRecord) return;
    _playGeneration++;
    final generation = _generation;
    setState(() {
      _starting = true;
      _draft = null;
      _error = null;
    });
    try {
      await _player.stop();
      if (!await _recorder.permission()) {
        throw const _RecordingError(
          'Allow microphone access to record a voice message.',
        );
      }
      if (!_valid ||
          generation != _generation ||
          _inbox == null ||
          _error != null) {
        return;
      }
      final stream = await _recorder.start();
      if (!_valid ||
          generation != _generation ||
          _inbox == null ||
          _error != null) {
        await _recorder.stop();
        return;
      }
      _bytes = BytesBuilder(copy: false);
      _recordedBytes = 0;
      setState(() {
        _playing = null;
        _recording = true;
      });
      final limit = (_inbox?.maxSeconds ?? 30) * 16000;
      _capture = stream.listen(
        (chunk) {
          if (!_recording || _bytes == null) return;
          final remaining = limit - _recordedBytes;
          final take = chunk.length.clamp(0, remaining);
          _bytes!.add(Uint8List.fromList(chunk.sublist(0, take)));
          setState(() => _recordedBytes += take);
          if (_recordedBytes >= limit) unawaited(_stopRecording());
        },
        onError: (_) {
          unawaited(_stopRecording(discard: true));
          if (mounted) {
            setState(
              () => _error =
                  'Recording stopped. Please check the microphone and try again.',
            );
          }
        },
        onDone: () {
          if (_recording) unawaited(_stopRecording());
        },
      );
      _recordTimer = Timer(
        Duration(seconds: _inbox?.maxSeconds ?? 30),
        () => unawaited(_stopRecording()),
      );
    } catch (error) {
      if (_valid && generation == _generation) {
        setState(
          () => _error = error is _RecordingError
              ? error.message
              : 'Could not start the microphone. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _stopRecording({bool discard = false}) async {
    if (!_recording || _stopping) return;
    final generation = _generation;
    _recordTimer?.cancel();
    final captured = _bytes?.takeBytes();
    _bytes = null;
    setState(() {
      _stopping = true;
      _recording = false;
    });
    try {
      unawaited(_capture?.cancel());
      _capture = null;
      await _recorder.stop();
    } catch (_) {
      discard = true;
    }
    if (!mounted) return;
    setState(() {
      _stopping = false;
      if (!discard && _foreground && generation == _generation) {
        if (captured != null && captured.length >= 8000) {
          _draft = captured.sublist(0, captured.length - captured.length % 2);
        } else {
          _error = 'Record for at least half a second before stopping.';
        }
      }
    });
  }

  Future<void> _play({VoiceMessage? message}) async {
    if (!_valid || _recording || _starting || _inbox == null || _playLoading) {
      return;
    }
    final id = message?.id ?? 'draft', generation = _generation;
    final playGeneration = ++_playGeneration;
    _playLoading = true;
    try {
      await _player.stop();
      if (!_valid ||
          generation != _generation ||
          playGeneration != _playGeneration) {
        return;
      }
      if (_playing == id) {
        setState(() => _playing = null);
        return;
      }
      setState(() => _playing = null);
      final audio = message == null
          ? reminderWav(_draft!)
          : await _client.audio(widget.imei, id);
      if (!_valid ||
          generation != _generation ||
          playGeneration != _playGeneration ||
          (message != null && !message.available)) {
        return;
      }
      await _player.play(audio);
      if (!_valid ||
          generation != _generation ||
          playGeneration != _playGeneration) {
        await _player.stop();
        return;
      }
      setState(() => _playing = id);
      // This means playback was started in Guardian, never that the wearer heard it.
      if (message?.incoming == true && message?.played == false) {
        await _client.played(widget.imei, id);
        unawaited(_refresh());
      }
    } catch (error) {
      if (_valid && generation == _generation) {
        if (error is VoiceMessageException && error.accessDenied) {
          _clearAccess();
        }
        setState(() {
          _error = _message(error);
          _playing = null;
        });
      }
    } finally {
      _playLoading = false;
    }
  }

  Future<void> _send() async {
    if (!_canRecord || _draft == null) return;
    _playGeneration++;
    final pcm = _draft!, generation = _generation, id = const Uuid().v4();
    setState(() {
      _sending = true;
      _pendingId = id;
      _draft = null;
      _playing = null;
    });
    try {
      await _player.stop();
      if (!_valid || generation != _generation) {
        _pendingId = null;
        return;
      }
      await _client.send(
        widget.imei,
        id: id,
        pcm: pcm,
        createdAt: DateTime.now(),
      );
      if (mounted && generation == _generation) _pendingId = null;
    } catch (error) {
      if (mounted && generation == _generation) {
        if (error is VoiceMessageException &&
            error.code != 'gateway_unavailable') {
          _pendingId = null;
        }
        setState(() => _error = _message(error));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
      if (_valid) await _refresh();
    }
  }

  Future<void> _delete(VoiceMessage message) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete voice message?'),
        content: const Text(
          'This removes the recording from Guardian. It cannot remove a copy already received on the watch.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !_valid) return;
    _playGeneration++;
    try {
      await _player.stop();
      await _client.delete(widget.imei, message.id);
      await _refresh();
    } catch (error) {
      if (mounted) setState(() => _error = _message(error));
    }
  }

  @override
  void dispose() {
    _generation++;
    _foreground = false;
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _recordTimer?.cancel();
    unawaited(_auth?.cancel());
    unawaited(_completion?.cancel());
    unawaited(_capture?.cancel());
    unawaited(_recorder.dispose());
    unawaited(_player.dispose());
    if (widget.client == null) _client.close();
    _draft = null;
    _bytes = null;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.guardianColors;
    final messages =
        _inbox?.messages.where((m) => m.available).toList() ?? <VoiceMessage>[];
    return Scaffold(
      backgroundColor: c.canvas,
      appBar: AppBar(
        title: const Text('Voice messages'),
        actions: [
          IconButton(
            tooltip: 'Refresh messages',
            onPressed: _refresh,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
                  child: Row(
                    children: [
                      CircleAvatar(
                        backgroundColor: c.accent.withValues(alpha: .12),
                        child: Icon(Icons.watch_outlined, color: c.accent),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              widget.wearerName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 19,
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              _inbox == null
                                  ? 'Checking connection…'
                                  : _inbox!.connected
                                  ? 'Watch connected'
                                  : 'Watch offline',
                              style: TextStyle(color: c.textSecondary),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 6,
                    ),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                Expanded(
                  child: _inbox == null && _error == null
                      ? const Center(child: CircularProgressIndicator())
                      : messages.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(28),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.forum_outlined,
                                  color: c.accent,
                                  size: 42,
                                ),
                                const SizedBox(height: 16),
                                const Text(
                                  'A little closer, wherever you are.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                const Text(
                                  'Send a short voice message. Replies from the watch will appear here.',
                                  textAlign: TextAlign.center,
                                ),
                              ],
                            ),
                          ),
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                          itemCount: messages.length,
                          itemBuilder: (_, index) {
                            final message = messages[index];
                            return Align(
                              alignment: message.incoming
                                  ? Alignment.centerLeft
                                  : Alignment.centerRight,
                              child: Container(
                                constraints: const BoxConstraints(
                                  maxWidth: 440,
                                ),
                                margin: const EdgeInsets.only(bottom: 14),
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: message.incoming
                                      ? c.surface
                                      : c.accent.withValues(alpha: .09),
                                  border: Border.all(color: c.border),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            message.incoming
                                                ? widget.wearerName
                                                : 'You',
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ),
                                        Text(
                                          MaterialLocalizations.of(
                                            context,
                                          ).formatTimeOfDay(
                                            TimeOfDay.fromDateTime(
                                              message.createdAt,
                                            ),
                                          ),
                                          style: TextStyle(
                                            color: c.textSecondary,
                                            fontSize: 12,
                                          ),
                                        ),
                                        PopupMenuButton<String>(
                                          tooltip: 'Message options',
                                          onSelected: (_) => _delete(message),
                                          itemBuilder: (_) => [
                                            const PopupMenuItem(
                                              value: 'delete',
                                              child: Text('Delete message'),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                    Row(
                                      children: [
                                        IconButton.filledTonal(
                                          tooltip: _playing == message.id
                                              ? 'Stop message'
                                              : 'Play message',
                                          onPressed: _recording || _starting
                                              ? null
                                              : () => _play(message: message),
                                          icon: Icon(
                                            _playing == message.id
                                                ? Icons.stop_rounded
                                                : Icons.play_arrow_rounded,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Text(
                                            'Voice message · ${message.durationLabel}',
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      message.statusLabel,
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: c.textSecondary,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                  decoration: BoxDecoration(
                    color: c.surface,
                    border: Border(top: BorderSide(color: c.border)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_recording) ...[
                        Text(
                          'Recording · ${(_recordedBytes / 16000).toStringAsFixed(1)} / ${_inbox?.maxSeconds ?? 30} sec',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _stopRecording,
                          icon: const Icon(Icons.stop_rounded),
                          label: const Text('Stop recording'),
                        ),
                      ] else if (_draft != null) ...[
                        Text(
                          'Ready to send · ${(_draft!.length / 16000).toStringAsFixed(1)} sec',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          alignment: WrapAlignment.center,
                          spacing: 12,
                          runSpacing: 8,
                          children: [
                            TextButton(
                              onPressed: () {
                                _playGeneration++;
                                unawaited(_player.stop());
                                setState(() {
                                  _draft = null;
                                  _playing = null;
                                });
                              },
                              child: const Text('Discard'),
                            ),
                            OutlinedButton.icon(
                              onPressed: () => _play(),
                              icon: Icon(
                                _playing == 'draft'
                                    ? Icons.stop
                                    : Icons.play_arrow,
                              ),
                              label: const Text('Preview'),
                            ),
                            FilledButton.icon(
                              onPressed: _canRecord ? _send : null,
                              icon: const Icon(Icons.send_outlined),
                              label: const Text('Send'),
                            ),
                          ],
                        ),
                      ] else
                        FilledButton.icon(
                          onPressed: _canRecord ? _startRecording : null,
                          icon: Icon(
                            _sending ? Icons.hourglass_top : Icons.mic_none,
                          ),
                          label: Text(
                            _sending
                                ? 'Sending…'
                                : _starting
                                ? 'Opening microphone…'
                                : 'Record a message',
                          ),
                        ),
                      const SizedBox(height: 10),
                      Text(
                        _inbox?.sendingBlocked == true || _pendingId != null
                            ? 'A send is unconfirmed. Check its status before sending another.'
                            : _inbox?.coolingDown == true
                            ? 'Please wait a minute between messages.'
                            : 'Up to ${_inbox?.maxSeconds ?? 30} seconds · Recordings expire after 24 hours',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12, color: c.textSecondary),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '“Watch replied” confirms receipt, not that the message was heard.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 11, color: c.textSecondary),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RecordingError implements Exception {
  const _RecordingError(this.message);
  final String message;
}
