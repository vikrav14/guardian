import 'package:flutter/material.dart';
import '../services/voice_messages_service.dart';
import '../theme/app_theme.dart';
import 'guardian_widgets.dart';

String voiceClock(int milliseconds) {
  final seconds = (milliseconds / 1000).ceil();
  return '${seconds ~/ 60}:${(seconds % 60).toString().padLeft(2, '0')}';
}

/// Presentation only: microphone, access and dispatch guards remain in the page.
class VoiceConversationView extends StatelessWidget {
  const VoiceConversationView({
    super.key,
    required this.name,
    this.wearerAvatarUrl,
    this.guardianAvatarUrl,
    required this.inbox,
    required this.error,
    required this.playing,
    required this.position,
    required this.recording,
    required this.starting,
    required this.sending,
    required this.pending,
    required this.canRecord,
    required this.recordedBytes,
    required this.draftBytes,
    required this.refresh,
    required this.record,
    required this.stop,
    required this.preview,
    required this.discard,
    required this.send,
    required this.play,
    required this.remove,
    this.onClose,
  });
  final String name;
  final String? wearerAvatarUrl, guardianAvatarUrl, error, playing;
  final VoiceInbox? inbox;
  final Duration position;
  final bool recording, starting, sending, pending, canRecord;
  final int recordedBytes;
  final int? draftBytes;
  final VoidCallback refresh, record, stop, preview, discard, send;
  final void Function(VoiceMessage) play, remove;
  final VoidCallback? onClose;

  void _information(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 4, 24, 28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'About voice messages',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              const Text(
                'Record up to 30 seconds. You can listen before sending. Recordings are kept privately for 24 hours.',
              ),
              const SizedBox(height: 12),
              const Text(
                '“Watch replied” confirms receipt, not that the message was heard. “Played here” means playback started in Guardian.',
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = context.guardianColors;
    final messages =
        inbox?.messages.where((m) => m.available).toList() ?? <VoiceMessage>[];
    final connection = inbox == null
        ? 'Checking connection…'
        : inbox!.connected
        ? 'Watch connected'
        : 'Watch offline';
    return Scaffold(
      backgroundColor: c.canvas,
      appBar: AppBar(
        leading: onClose == null ? null : BackButton(onPressed: onClose),
        titleSpacing: 0,
        title: Row(
          children: [
            AvatarBubble(
              initials: initialsFor(name),
              color: c.accent,
              imageUrl: wearerAvatarUrl,
              size: 38,
              ringWidth: 1.5,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    connection,
                    style: TextStyle(fontSize: 12, color: c.textSecondary),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Refresh messages',
            onPressed: refresh,
            icon: const Icon(Icons.refresh_rounded, size: 22),
          ),
          IconButton(
            tooltip: 'About voice messages',
            onPressed: () => _information(context),
            icon: const Icon(Icons.info_outline_rounded, size: 21),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 680),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.lock_outline_rounded,
                        size: 13,
                        color: c.textSecondary,
                      ),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(
                          'Voice messages · Kept for 24 hours',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 12,
                            color: c.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                    child: Text(
                      error!,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
                Expanded(
                  child: inbox == null && error == null
                      ? const Center(child: CircularProgressIndicator())
                      : messages.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(30),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                AvatarBubble(
                                  initials: initialsFor(name),
                                  color: c.accent,
                                  imageUrl: wearerAvatarUrl,
                                  size: 72,
                                ),
                                const SizedBox(height: 20),
                                Text(
                                  'A familiar voice, wherever you are.',
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                                const SizedBox(height: 10),
                                Text(
                                  'Send $name a short message. Replies from the watch appear here.',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: c.textSecondary),
                                ),
                              ],
                            ),
                          ),
                        )
                      : LayoutBuilder(
                          builder: (context, constraints) => ListView.builder(
                            reverse: true,
                            padding: const EdgeInsets.fromLTRB(12, 6, 12, 16),
                            itemCount: messages.length,
                            itemBuilder: (context, index) {
                              final messageIndex = messages.length - 1 - index;
                              final message = messages[messageIndex];
                              final previous = messageIndex > 0
                                  ? messages[messageIndex - 1]
                                  : null;
                              final newDay =
                                  previous == null ||
                                  !DateUtils.isSameDay(
                                    previous.createdAt,
                                    message.createdAt,
                                  );
                              final active = playing == message.id;
                              final progress = active
                                  ? (position.inMilliseconds /
                                            message.durationMs)
                                        .clamp(0.0, 1.0)
                                  : 0.0;
                              final avatar = Semantics(
                                container: true,
                                excludeSemantics: true,
                                label: message.incoming
                                    ? '$name avatar'
                                    : 'Your avatar',
                                child: AvatarBubble(
                                  initials: message.incoming
                                      ? initialsFor(name)
                                      : 'You',
                                  color: c.accent,
                                  imageUrl: message.incoming
                                      ? wearerAvatarUrl
                                      : guardianAvatarUrl,
                                  size: 32,
                                  ringWidth: 1.5,
                                ),
                              );
                              final bubble = Container(
                                key: ValueKey('voice-bubble-${message.id}'),
                                constraints: BoxConstraints(
                                  maxWidth: ((constraints.maxWidth - 24) * .80)
                                      .clamp(0, 440),
                                ),
                                padding: const EdgeInsets.fromLTRB(
                                  12,
                                  4,
                                  12,
                                  10,
                                ),
                                decoration: BoxDecoration(
                                  color: message.incoming
                                      ? c.surface
                                      : Color.alphaBlend(
                                          c.accent.withValues(alpha: .12),
                                          c.surface,
                                        ),
                                  border: Border.all(
                                    color: c.border.withValues(alpha: .65),
                                  ),
                                  borderRadius: BorderRadius.only(
                                    topLeft: const Radius.circular(18),
                                    topRight: const Radius.circular(18),
                                    bottomLeft: Radius.circular(
                                      message.incoming ? 5 : 18,
                                    ),
                                    bottomRight: Radius.circular(
                                      message.incoming ? 18 : 5,
                                    ),
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Row(
                                      children: [
                                        Expanded(
                                          child: Text(
                                            message.incoming ? name : 'You',
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontSize: 12,
                                              color: c.textSecondary,
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
                                            fontSize: 11,
                                            color: c.textSecondary,
                                          ),
                                        ),
                                        SizedBox(
                                          width: 32,
                                          child: PopupMenuButton<String>(
                                            tooltip: 'Message options',
                                            iconSize: 18,
                                            padding: EdgeInsets.zero,
                                            onSelected: (_) => remove(message),
                                            itemBuilder: (_) => const [
                                              PopupMenuItem(
                                                value: 'delete',
                                                child: Text('Delete message'),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                    Row(
                                      children: [
                                        IconButton.filled(
                                          tooltip: active
                                              ? 'Stop message'
                                              : 'Play message',
                                          onPressed: recording || starting
                                              ? null
                                              : () => play(message),
                                          style: IconButton.styleFrom(
                                            backgroundColor: c.accent,
                                            foregroundColor: Colors.white,
                                          ),
                                          icon: Icon(
                                            active
                                                ? Icons.stop_rounded
                                                : Icons.play_arrow_rounded,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Semantics(
                                                label: 'Playback progress',
                                                value:
                                                    '${(progress * 100).round()} percent',
                                                child: LinearProgressIndicator(
                                                  value: progress,
                                                  minHeight: 4,
                                                  borderRadius:
                                                      BorderRadius.circular(4),
                                                  color: c.accent,
                                                  backgroundColor: c.accent
                                                      .withValues(alpha: .18),
                                                ),
                                              ),
                                              const SizedBox(height: 8),
                                              Text(
                                                active
                                                    ? '${voiceClock(position.inMilliseconds)} / ${voiceClock(message.durationMs)}'
                                                    : voiceClock(
                                                        message.durationMs,
                                                      ),
                                                style: TextStyle(
                                                  fontSize: 12,
                                                  color: c.textSecondary,
                                                  fontWeight: FontWeight.w500,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 5),
                                    Row(
                                      children: [
                                        if (message.incoming &&
                                            !message.played) ...[
                                          Container(
                                            width: 6,
                                            height: 6,
                                            decoration: BoxDecoration(
                                              color: c.accent,
                                              shape: BoxShape.circle,
                                            ),
                                          ),
                                          const SizedBox(width: 5),
                                        ],
                                        Flexible(
                                          child: Text(
                                            message.statusLabel,
                                            style: TextStyle(
                                              fontSize: 11,
                                              color:
                                                  message.incoming &&
                                                      !message.played
                                                  ? c.accent
                                                  : c.textSecondary,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              );
                              return Column(
                                children: [
                                  if (newDay)
                                    Padding(
                                      padding: const EdgeInsets.only(
                                        top: 6,
                                        bottom: 18,
                                      ),
                                      child: Text(
                                        DateUtils.isSameDay(
                                              message.createdAt,
                                              DateTime.now(),
                                            )
                                            ? 'Today'
                                            : MaterialLocalizations.of(
                                                context,
                                              ).formatShortDate(
                                                message.createdAt,
                                              ),
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: c.textSecondary,
                                        ),
                                      ),
                                    ),
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 16),
                                    child: Row(
                                      mainAxisAlignment: message.incoming
                                          ? MainAxisAlignment.start
                                          : MainAxisAlignment.end,
                                      crossAxisAlignment:
                                          CrossAxisAlignment.end,
                                      children: message.incoming
                                          ? [
                                              avatar,
                                              const SizedBox(width: 8),
                                              Flexible(child: bubble),
                                            ]
                                          : [
                                              Flexible(child: bubble),
                                              const SizedBox(width: 8),
                                              avatar,
                                            ],
                                    ),
                                  ),
                                ],
                              );
                            },
                          ),
                        ),
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 12),
                  decoration: BoxDecoration(
                    color: c.surface,
                    border: Border(top: BorderSide(color: c.border)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (recording) ...[
                        Text(
                          'Recording · ${voiceClock(recordedBytes ~/ 16)} / 0:30',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 10),
                        FilledButton.icon(
                          onPressed: stop,
                          icon: const Icon(Icons.stop_rounded),
                          label: const Text('Stop recording'),
                        ),
                      ] else if (draftBytes != null) ...[
                        Text(
                          'Ready to send · ${(draftBytes! / 16000).toStringAsFixed(1)} sec',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          alignment: WrapAlignment.center,
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            TextButton(
                              onPressed: discard,
                              child: const Text('Discard'),
                            ),
                            OutlinedButton.icon(
                              onPressed: preview,
                              icon: Icon(
                                playing == 'draft'
                                    ? Icons.stop_rounded
                                    : Icons.play_arrow_rounded,
                              ),
                              label: const Text('Preview'),
                            ),
                            FilledButton.icon(
                              onPressed: canRecord ? send : null,
                              icon: const Icon(Icons.send_rounded, size: 18),
                              label: const Text('Send'),
                            ),
                          ],
                        ),
                      ] else
                        FilledButton.icon(
                          onPressed: canRecord ? record : null,
                          icon: Icon(
                            sending ? Icons.hourglass_top : Icons.mic_rounded,
                          ),
                          label: Text(
                            sending
                                ? 'Sending…'
                                : starting
                                ? 'Opening microphone…'
                                : 'Record a message',
                          ),
                        ),
                      const SizedBox(height: 8),
                      Text(
                        inbox?.sendingBlocked == true || pending
                            ? 'A send is unconfirmed. Check its status before sending another.'
                            : inbox?.coolingDown == true
                            ? 'Please wait a minute between messages.'
                            : recording
                            ? 'Tap Stop when you’re finished'
                            : 'Up to 30 seconds · Listen before sending',
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
