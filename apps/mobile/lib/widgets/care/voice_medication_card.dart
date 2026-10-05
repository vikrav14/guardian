import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../../services/reminder_recording.dart';
import '../../services/voice_medication_service.dart';
import '../../theme/app_theme.dart';

class VoiceMedicationCard extends StatefulWidget {
  const VoiceMedicationCard({super.key, required this.imei, this.client});
  final String imei;
  final VoiceMedicationClient? client;
  @override
  State<VoiceMedicationCard> createState() => _VoiceMedicationCardState();
}

class _VoiceMedicationCardState extends State<VoiceMedicationCard> {
  late final VoiceMedicationClient _client =
      widget.client ?? VoiceMedicationService();
  List<VoiceMedicationReminder>? _items;
  String? _error;
  bool _loading = false;
  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    if (widget.client == null) _client.close();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _client.load(widget.imei);
      items.sort((a, b) => a.time.compareTo(b.time));
      if (mounted) setState(() => _items = items);
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = e is VoiceMedicationException
              ? e.message
              : 'Could not load watch reminders.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _edit([VoiceMedicationReminder? reminder]) async {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => VoiceMedicationEditor(
        imei: widget.imei,
        client: _client,
        reminder: reminder,
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.guardianColors;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: c.textMuted.withValues(alpha: .16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xffe5f2ec),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: const Icon(
                  Icons.medication_outlined,
                  color: Color(0xff246b55),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  'Medication reminders',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: c.textPrimary,
                  ),
                ),
              ),
              IconButton(
                onPressed: _loading ? null : _load,
                tooltip: 'Refresh watch status',
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'A familiar voice, at the right time.',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w600,
              color: c.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Choose an alert or record a short message for the watch. Up to three reminders.',
            style: TextStyle(color: c.textMuted, height: 1.45),
          ),
          if (_loading)
            const Padding(
              padding: EdgeInsets.only(top: 18),
              child: LinearProgressIndicator(),
            ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          if (_items?.isEmpty == true)
            Container(
              margin: const EdgeInsets.symmetric(vertical: 18),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: c.textMuted.withValues(alpha: .05),
                borderRadius: BorderRadius.circular(16),
              ),
              child: const Row(
                children: [
                  Icon(Icons.schedule, size: 28),
                  SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      'No reminders yet\nAdd one when you’re ready.',
                      style: TextStyle(height: 1.6),
                    ),
                  ),
                ],
              ),
            ),
          for (final reminder in _items ?? <VoiceMedicationReminder>[])
            Padding(
              padding: const EdgeInsets.only(top: 16),
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: reminder.frequency == 3 ? null : () => _edit(reminder),
                child: Container(
                  padding: const EdgeInsets.all(18),
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: c.textMuted.withValues(alpha: .18),
                    ),
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            reminder.time,
                            style: TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w700,
                              color: c.textPrimary,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              '${reminder.frequency == 1
                                  ? 'Once'
                                  : reminder.frequency == 2
                                  ? 'Daily'
                                  : 'Weekly'} · ${reminder.enabled ? 'Enabled' : 'Off'}',
                              style: TextStyle(color: c.textMuted),
                            ),
                          ),
                          const Icon(Icons.chevron_right),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        reminder.text,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 12,
                        runSpacing: 8,
                        children: [
                          _DetailPill(
                            icon: reminder.mode == 'voice'
                                ? Icons.mic_none
                                : Icons.notifications_none,
                            text: reminder.mode == 'voice'
                                ? 'Your voice · ${(reminder.durationMs / 1000).toStringAsFixed(1)}s'
                                : 'Standard alert',
                          ),
                          _DetailPill(
                            icon: reminder.status == 'reply_observed'
                                ? Icons.check_circle_outline
                                : Icons.info_outline,
                            text: reminder.statusLabel,
                          ),
                        ],
                      ),
                      if (reminder.frequency == 3)
                        const Padding(
                          padding: EdgeInsets.only(top: 10),
                          child: Text(
                            'Weekly settings are kept unchanged while watch weekday support is verified.',
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed:
                _items == null ||
                    _loading ||
                    _error != null ||
                    _items!.map((item) => item.slot).toSet().length >= 3
                ? null
                : () => _edit(),
            icon: const Icon(Icons.add),
            label: const Text('Add reminder'),
          ),
          const SizedBox(height: 14),
          Text(
            'A watch reply confirms receipt, not playback or that medicine was taken.',
            style: TextStyle(fontSize: 12, height: 1.4, color: c.textMuted),
          ),
        ],
      ),
    );
  }
}

class _DetailPill extends StatelessWidget {
  const _DetailPill({required this.icon, required this.text});
  final IconData icon;
  final String text;
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 16, color: context.guardianColors.textMuted),
      const SizedBox(width: 5),
      Flexible(
        child: Text(
          text,
          style: TextStyle(
            fontSize: 12,
            color: context.guardianColors.textMuted,
          ),
        ),
      ),
    ],
  );
}

class VoiceMedicationEditor extends StatefulWidget {
  const VoiceMedicationEditor({
    super.key,
    required this.imei,
    required this.client,
    this.reminder,
    this.recorder,
  });
  final String imei;
  final VoiceMedicationClient client;
  final VoiceMedicationReminder? reminder;
  final ReminderRecorder? recorder;
  @override
  State<VoiceMedicationEditor> createState() => _VoiceMedicationEditorState();
}

class _VoiceMedicationEditorState extends State<VoiceMedicationEditor>
    with WidgetsBindingObserver {
  late final _text = TextEditingController(
    text: widget.reminder?.text ?? 'Time for your medicine',
  );
  late final ReminderRecorder _recorder =
      widget.recorder ?? MicrophoneReminderRecorder();
  AudioPlayer? _player;
  final _chunks = BytesBuilder(copy: false);
  StreamSubscription<Uint8List>? _subscription;
  StreamSubscription<void>? _playback;
  Timer? _limit;
  Uint8List? _pcm, _preview;
  late String _mode = widget.reminder?.mode ?? 'alert';
  late String _time = widget.reminder?.time ?? _initialTime();
  late int _frequency = widget.reminder?.frequency ?? 1;
  late bool _enabled = widget.reminder?.enabled ?? true;
  bool _stopping = false;
  bool _foreground = true;
  bool _recording = false,
      _starting = false,
      _saving = false,
      _playing = false,
      _loadingPreview = false;
  double _seconds = 0;
  String? _error, _result;
  VoiceMedicationReminder? _saved;
  late String _requestId = const Uuid().v4();
  late final String _id = widget.reminder?.id ?? const Uuid().v4();
  int get _version => _saved?.version ?? widget.reminder?.version ?? 0;
  String _initialTime() {
    final t = DateTime.now().toUtc().add(const Duration(hours: 4, minutes: 5));
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  bool get _hasSavedVoice => (_saved ?? widget.reminder)?.mode == 'voice';
  bool get _hasVoice => _pcm != null || _hasSavedVoice;
  bool get _busy => _starting || _stopping || _saving || _loadingPreview;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    if (state != AppLifecycleState.resumed) {
      if (_recording) unawaited(_stop());
      unawaited(_player?.stop());
      if (mounted) setState(() => _playing = false);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _limit?.cancel();
    unawaited(_subscription?.cancel());
    unawaited(_playback?.cancel());
    unawaited(_recorder.dispose());
    unawaited(_player?.dispose());
    _text.dispose();
    super.dispose();
  }

  void _changed() {
    _requestId = const Uuid().v4();
    _result = null;
    _error = null;
  }

  Future<void> _record() async {
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      await _player?.stop();
      if (!await _recorder.permission()) {
        throw const VoiceMedicationException('microphone_permission');
      }
      if (!mounted || !_foreground) return;
      final stream = await _recorder.start();
      if (!mounted || !_foreground) {
        await _recorder.stop();
        return;
      }
      _chunks.clear();
      setState(() {
        _recording = true;
        _playing = false;
        _seconds = 0;
      });
      _subscription = stream.listen(
        (chunk) {
          if (!_recording) return;
          final remaining = 160000 - _chunks.length;
          _chunks.add(chunk.sublist(0, math.min(remaining, chunk.length)));
          if (mounted) setState(() => _seconds = _chunks.length / 16000);
          if (_chunks.length >= 160000) unawaited(_stop());
        },
        onError: (_) {
          unawaited(_stop(discard: true));
        },
        onDone: () {
          if (_recording) unawaited(_stop());
        },
      );
      _limit = Timer(const Duration(seconds: 10), () => unawaited(_stop()));
    } catch (e) {
      if (mounted) {
        setState(
          () => _error =
              e is VoiceMedicationException && e.code == 'microphone_permission'
              ? 'Microphone access is off. Allow it in your phone or browser settings to record.'
              : 'Could not start the microphone. Please try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _stop({bool discard = false}) async {
    if (!_recording) return;
    setState(() {
      _recording = false;
      _stopping = true;
    });
    _limit?.cancel();
    try {
      await _recorder.stop();
    } catch (_) {
      discard = true;
    }
    await _subscription?.cancel();
    _subscription = null;
    final bytes = _chunks.takeBytes();
    _stopping = false;
    if (!mounted) return;
    setState(() {
      if (discard || bytes.length < 8000) {
        _error = 'Record at least half a second, then try again.';
      } else {
        _pcm = Uint8List.sublistView(bytes, 0, bytes.length - bytes.length % 2);
        _preview = reminderWav(_pcm!);
        _changed();
      }
    });
  }

  Future<void> _listen() async {
    if (_playing) {
      await _player?.stop();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() {
      _loadingPreview = true;
      _error = null;
    });
    try {
      _preview ??= await widget.client.audio(widget.imei, _id);
      if (!mounted) return;
      _player ??= AudioPlayer();
      _playback ??= _player!.onPlayerComplete.listen((_) {
        if (mounted) setState(() => _playing = false);
      });
      await _player!.play(BytesSource(_preview!, mimeType: 'audio/wav'));
      if (mounted) setState(() => _playing = true);
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Could not play this recording. Your saved reminder is unchanged.',
        );
      }
    } finally {
      if (mounted) setState(() => _loadingPreview = false);
    }
  }

  Future<void> _pickTime() async {
    final p = _time.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: int.parse(p[0]), minute: int.parse(p[1])),
    );
    if (picked != null && mounted) {
      setState(() {
        _time =
            '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
        _changed();
      });
    }
  }

  Future<void> _save({bool delete = false}) async {
    if (_text.text.trim().isEmpty || (_mode == 'voice' && !_hasVoice)) {
      setState(
        () => _error = _text.text.trim().isEmpty
            ? 'Add a short reminder label.'
            : 'Record your message first.',
      );
      return;
    }
    if (delete) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Remove this reminder?'),
          content: const Text(
            'Guardian will ask the watch to turn it off. It stays in the list if the reply is not confirmed.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Keep reminder'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Turn off & remove'),
            ),
          ],
        ),
      );
      if (confirmed != true || !mounted) return;
      _requestId = const Uuid().v4();
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    await _player?.stop();
    try {
      final result = await widget.client.save(widget.imei, {
        'requestId': _requestId,
        'id': _id,
        'version': _version,
        'action': delete ? 'delete' : 'save',
        'settings': {
          'time': _time,
          'frequency': _frequency,
          'enabled': delete ? false : _enabled,
          'mode': _mode,
          'text': _text.text.trim(),
        },
        if (_mode == 'voice' && _pcm != null) 'pcm': base64Encode(_pcm!),
      });
      if (!mounted) return;
      if (result.deleted) {
        Navigator.of(context).pop();
        return;
      }
      setState(() {
        _saved = result;
        _enabled = result.enabled;
        _pcm = null;
        _requestId = const Uuid().v4();
        _result = result.statusLabel;
        if (result.reason != null) {
          _error = VoiceMedicationException(result.reason!).message;
        }
      });
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = e is VoiceMedicationException
              ? e.message
              : 'Connection interrupted. Close and refresh the list before making another change.',
        );
      }
      // Retain this request ID on an ambiguous response, so a repeat cannot send twice.
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _playing = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.guardianColors,
        green = Theme.of(context).colorScheme.primary;
    final duration = _pcm != null
        ? _pcm!.length / 16000
        : ((_saved ?? widget.reminder)?.durationMs ?? 0) / 1000;
    return PopScope(
      canPop: !_saving && !_recording && !_starting,
      child: Dialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(28)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 550),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        widget.reminder == null
                            ? 'New reminder'
                            : 'Edit reminder',
                        style: TextStyle(
                          fontSize: 26,
                          fontWeight: FontWeight.w700,
                          color: c.textPrimary,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Close reminder',
                      onPressed: _busy || _recording
                          ? null
                          : () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  'A little reassurance, in your own voice.',
                  style: TextStyle(color: c.textMuted, height: 1.4),
                ),
                const SizedBox(height: 24),
                TextField(
                  controller: _text,
                  maxLength: 80,
                  enabled: !_busy && !_recording,
                  onChanged: (_) => setState(_changed),
                  decoration: const InputDecoration(
                    labelText: 'Reminder label',
                    hintText: 'Evening medicine',
                    border: OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                const SizedBox(height: 18),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Reminder time',
                        style: TextStyle(color: c.textMuted),
                      ),
                    ),
                    OutlinedButton.icon(
                      onPressed: _busy || _recording ? null : _pickTime,
                      icon: const Icon(Icons.schedule),
                      label: Text(
                        _time,
                        style: const TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ],
                ),
                Text(
                  'Watch time · Mauritius',
                  style: TextStyle(fontSize: 12, color: c.textMuted),
                ),
                const SizedBox(height: 14),
                SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 1, label: Text('Once')),
                    ButtonSegment(value: 2, label: Text('Every day')),
                  ],
                  selected: {_frequency},
                  onSelectionChanged: _busy || _recording
                      ? null
                      : (s) => setState(() {
                          _frequency = s.first;
                          _changed();
                        }),
                ),
                const SizedBox(height: 24),
                Text(
                  'How should the watch remind them?',
                  style: TextStyle(
                    fontWeight: FontWeight.w600,
                    color: c.textPrimary,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: _ModeTile(
                        title: 'Standard alert',
                        subtitle: 'Watch sound',
                        icon: Icons.notifications_none,
                        selected: _mode == 'alert',
                        onTap: _busy || _recording
                            ? null
                            : () => setState(() {
                                _mode = 'alert';
                                unawaited(_player?.stop());
                                _playing = false;
                                _changed();
                              }),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _ModeTile(
                        title: 'Your voice',
                        subtitle: 'A familiar message',
                        icon: Icons.mic_none,
                        selected: _mode == 'voice',
                        onTap: _busy || _recording
                            ? null
                            : () => setState(() {
                                _mode = 'voice';
                                _changed();
                              }),
                      ),
                    ),
                  ],
                ),
                if (_mode == 'voice') ...[
                  const SizedBox(height: 16),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(18),
                    decoration: BoxDecoration(
                      color: green.withValues(alpha: .06),
                      border: Border.all(color: green.withValues(alpha: .15)),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Column(
                      children: [
                        Icon(
                          _recording
                              ? Icons.graphic_eq
                              : _hasVoice
                              ? Icons.check_circle_outline
                              : Icons.mic_none,
                          size: 34,
                          color: green,
                        ),
                        const SizedBox(height: 10),
                        Text(
                          _recording
                              ? 'Recording… ${_seconds.toStringAsFixed(1)}s / 10s'
                              : _hasVoice
                              ? 'Your message · ${duration.toStringAsFixed(1)} seconds'
                              : 'Make it personal',
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        const SizedBox(height: 8),
                        if (_recording)
                          LinearProgressIndicator(value: _seconds / 10)
                        else
                          Text(
                            _hasVoice
                                ? 'Listen before saving to the watch.'
                                : 'Speak clearly. A short message is enough.\nUp to 10 seconds.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.5,
                              color: c.textMuted,
                            ),
                          ),
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 10,
                          runSpacing: 8,
                          alignment: WrapAlignment.center,
                          children: [
                            if (_hasVoice && !_recording)
                              OutlinedButton.icon(
                                onPressed: _busy ? null : _listen,
                                icon: Icon(
                                  _playing ? Icons.stop : Icons.play_arrow,
                                ),
                                label: Text(
                                  _loadingPreview
                                      ? 'Loading…'
                                      : _playing
                                      ? 'Stop playback'
                                      : 'Listen',
                                ),
                              ),
                            FilledButton.icon(
                              onPressed: _busy
                                  ? null
                                  : _recording
                                  ? _stop
                                  : _record,
                              icon: Icon(_recording ? Icons.stop : Icons.mic),
                              label: Text(
                                _starting
                                    ? 'Starting…'
                                    : _recording
                                    ? 'Stop recording'
                                    : _hasVoice
                                    ? 'Record again'
                                    : 'Record message',
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Only linked guardians can access the recording.',
                    style: TextStyle(fontSize: 12, color: c.textMuted),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Recorded reminders may play aloud even when Call alert '
                    'style is set to Vibration or Silent.',
                    style: TextStyle(fontSize: 12, color: c.textMuted),
                  ),
                ],
                const SizedBox(height: 14),
                SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Enabled'),
                  subtitle: Text(
                    _enabled
                        ? 'Play at the scheduled time'
                        : 'Keep this reminder switched off',
                  ),
                  value: _enabled,
                  onChanged: _busy || _recording
                      ? null
                      : (v) => setState(() {
                          _enabled = v;
                          _changed();
                        }),
                ),
                if (_result != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      _result!,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: green,
                      ),
                    ),
                  ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      _error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                        height: 1.4,
                      ),
                    ),
                  ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    style: FilledButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 16),
                    ),
                    onPressed: _busy || _recording ? null : _save,
                    icon: _saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.watch_outlined),
                    label: Text(
                      _saving ? 'Checking the watch…' : 'Save to watch',
                    ),
                  ),
                ),
                if (widget.reminder != null || _saved != null)
                  Center(
                    child: TextButton(
                      onPressed: _busy || _recording
                          ? null
                          : () => _save(delete: true),
                      child: const Text('Remove reminder'),
                    ),
                  ),
                const SizedBox(height: 10),
                Text(
                  'The watch must be connected to save. A reply does not confirm playback or that medicine was taken.',
                  style: TextStyle(
                    fontSize: 12,
                    height: 1.45,
                    color: c.textMuted,
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

class _ModeTile extends StatelessWidget {
  const _ModeTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.selected,
    this.onTap,
  });
  final String title, subtitle;
  final IconData icon;
  final bool selected;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    final c = context.guardianColors,
        primary = Theme.of(context).colorScheme.primary;
    return Semantics(
      selected: selected,
      button: true,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 160),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: selected
                ? primary.withValues(alpha: .07)
                : Colors.transparent,
            border: Border.all(
              color: selected ? primary : c.textMuted.withValues(alpha: .25),
              width: selected ? 1.5 : 1,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: selected ? primary : c.textMuted),
              const SizedBox(height: 10),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Text(
                subtitle,
                style: TextStyle(fontSize: 12, color: c.textMuted),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
