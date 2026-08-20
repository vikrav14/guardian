import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../journey_models.dart';
import '../journey_replay_controller.dart';
import '../journey_utils.dart';
import 'journey_screen_theme.dart';

/// Compact bottom floating playback control with expand/collapse.
class JourneyPlaybackBar extends StatefulWidget {
  const JourneyPlaybackBar({super.key, required this.replay});

  final JourneyReplayController replay;

  @override
  State<JourneyPlaybackBar> createState() => _JourneyPlaybackBarState();
}

class _JourneyPlaybackBarState extends State<JourneyPlaybackBar> {
  var _expanded = false;

  List<JourneyEvent> get _scrubberEvents => widget.replay.events.where((event) {
    return event.type == JourneyEventType.leftHome ||
        event.type == JourneyEventType.vehicle ||
        event.type == JourneyEventType.stopped ||
        event.type == JourneyEventType.arrived;
  }).toList();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.replay,
      builder: (context, _) {
        final replay = widget.replay;
        final start = replay.stats.startTime;
        final end = replay.stats.endTime;
        final currentTime = interpolateJourneyTime(
          replay.rawPoints,
          replay.progress,
        );

        return AnimatedContainer(
          duration: JourneyScreenTheme.animationDuration,
          curve: JourneyScreenTheme.animationCurve,
          margin: EdgeInsets.only(
            left: 0,
            right: 0,
            top: JourneyScreenTheme.spacing,
            bottom: 0,
          ),
          padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
          decoration: JourneyScreenTheme.glassOverlay(
            radius: JourneyScreenTheme.radiusLarge,
          ),
          child: _expanded
              ? Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _ExpandedControls(replay: replay),
                    const SizedBox(height: 4),
                    _TimelineRow(
                      replay: replay,
                      start: start,
                      end: end,
                      scrubberEvents: _scrubberEvents,
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        _SpeedSelector(replay: replay),
                        const Spacer(),
                        _AutoFollowToggle(replay: replay),
                        IconButton(
                          tooltip: 'Collapse',
                          visualDensity: VisualDensity.compact,
                          onPressed: () => setState(() => _expanded = false),
                          icon: const Icon(
                            Icons.expand_more_rounded,
                            color: JourneyScreenTheme.textMuted,
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ],
                )
              : _CollapsedRow(
                  replay: replay,
                  currentTime: currentTime,
                  start: start,
                  end: end,
                  scrubberEvents: _scrubberEvents,
                  onExpand: () => setState(() => _expanded = true),
                ),
        );
      },
    );
  }
}

/// Single-row collapsed playback — fits within 90px without clipping taps.
class _CollapsedRow extends StatelessWidget {
  const _CollapsedRow({
    required this.replay,
    required this.currentTime,
    required this.start,
    required this.end,
    required this.scrubberEvents,
    required this.onExpand,
  });

  final JourneyReplayController replay;
  final DateTime? currentTime;
  final DateTime? start;
  final DateTime? end;
  final List<JourneyEvent> scrubberEvents;
  final VoidCallback onExpand;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: JourneyScreenTheme.playbackCollapsedHeight - 12,
      child: Row(
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: replay.togglePlayPause,
              borderRadius: BorderRadius.circular(24),
              child: SizedBox(
                width: JourneyScreenTheme.minTouchTarget,
                height: JourneyScreenTheme.minTouchTarget,
                child: Icon(
                  replay.isPlaying
                      ? Icons.pause_rounded
                      : Icons.play_arrow_rounded,
                  color: JourneyScreenTheme.accent,
                  size: 32,
                ),
              ),
            ),
          ),
          if (currentTime != null)
            SizedBox(
              width: 44,
              child: Text(
                DateFormat.Hm().format(currentTime!),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: JourneyScreenTheme.accent,
                ),
              ),
            ),
          Expanded(
            child: _TimelineRow(
              replay: replay,
              start: start,
              end: end,
              scrubberEvents: scrubberEvents,
              compact: true,
            ),
          ),
          _SpeedSelector(replay: replay, compact: true),
          IconButton(
            tooltip: 'Expand controls',
            visualDensity: VisualDensity.compact,
            onPressed: onExpand,
            icon: const Icon(
              Icons.expand_less_rounded,
              color: JourneyScreenTheme.textMuted,
              size: 20,
            ),
          ),
        ],
      ),
    );
  }
}

class _ExpandedControls extends StatelessWidget {
  const _ExpandedControls({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        IconButton(
          tooltip: 'Previous event',
          visualDensity: VisualDensity.compact,
          onPressed: replay.stepBackward,
          icon: const Icon(
            Icons.fast_rewind_rounded,
            size: 20,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
        IconButton(
          tooltip: 'Skip to start',
          visualDensity: VisualDensity.compact,
          onPressed: replay.skipToStart,
          icon: const Icon(
            Icons.skip_previous_rounded,
            size: 22,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
        IconButton(
          tooltip: replay.isPlaying ? 'Pause' : 'Play',
          onPressed: replay.togglePlayPause,
          icon: Icon(
            replay.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
            size: 32,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
        IconButton(
          tooltip: 'Skip to end',
          visualDensity: VisualDensity.compact,
          onPressed: replay.skipToEnd,
          icon: const Icon(
            Icons.skip_next_rounded,
            size: 22,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
        IconButton(
          tooltip: 'Next event',
          visualDensity: VisualDensity.compact,
          onPressed: replay.stepForward,
          icon: const Icon(
            Icons.fast_forward_rounded,
            size: 20,
            color: JourneyScreenTheme.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({
    required this.replay,
    required this.start,
    required this.end,
    required this.scrubberEvents,
    this.compact = false,
  });

  final JourneyReplayController replay;
  final DateTime? start;
  final DateTime? end;
  final List<JourneyEvent> scrubberEvents;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        if (!compact)
          Text(
            start != null ? DateFormat.Hm().format(start!) : '--:--',
            style: JourneyScreenTheme.textStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: JourneyScreenTheme.textSecondary,
            ),
          ),
        Expanded(
          child: SizedBox(
            height: compact ? 24 : 28,
            child: LayoutBuilder(
              builder: (context, constraints) {
                return Stack(
                  alignment: Alignment.center,
                  children: [
                    SliderTheme(
                      data: SliderTheme.of(context).copyWith(
                        trackHeight: 3,
                        activeTrackColor: JourneyScreenTheme.accent,
                        inactiveTrackColor: JourneyScreenTheme.textMuted
                            .withValues(alpha: 0.35),
                        thumbShape: const RoundSliderThumbShape(
                          enabledThumbRadius: 6,
                        ),
                        overlayShape: SliderComponentShape.noOverlay,
                      ),
                      child: Slider(
                        value: replay.progress,
                        onChanged: (value) {
                          replay.seek(value);
                          if (replay.isPlaying) replay.pause();
                        },
                      ),
                    ),
                    ...scrubberEvents.map((event) {
                      final left =
                          eventProgress(event, replay.rawPoints.length) *
                          constraints.maxWidth;
                      return Positioned(
                        left: left.clamp(0, constraints.maxWidth - 8),
                        child: GestureDetector(
                          onTap: () => replay.seekToEvent(event),
                          child: Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(
                              color: JourneyScreenTheme.warning,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: JourneyScreenTheme.textPrimary,
                                width: 1,
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  ],
                );
              },
            ),
          ),
        ),
        if (!compact)
          Text(
            end != null ? DateFormat.Hm().format(end!) : '--:--',
            style: JourneyScreenTheme.textStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: JourneyScreenTheme.textSecondary,
            ),
          ),
      ],
    );
  }
}

class _SpeedSelector extends StatelessWidget {
  const _SpeedSelector({required this.replay, this.compact = false});

  final JourneyReplayController replay;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 6 : 8),
      decoration: BoxDecoration(
        color: JourneyScreenTheme.background.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: JourneyScreenTheme.cardBorder),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<double>(
          value:
              JourneyReplayController.playbackSpeedOptions.contains(
                replay.playbackSpeed,
              )
              ? replay.playbackSpeed
              : 1.0,
          isDense: true,
          style: JourneyScreenTheme.textStyle(fontSize: compact ? 11 : 12),
          dropdownColor: JourneyScreenTheme.cardFill,
          items: JourneyReplayController.playbackSpeedOptions
              .map(
                (speed) => DropdownMenuItem(
                  value: speed,
                  child: Text(
                    '${speed.toStringAsFixed(speed == speed.roundToDouble() ? 0 : 1)}×',
                  ),
                ),
              )
              .toList(),
          onChanged: (value) {
            if (value != null) replay.setPlaybackSpeed(value);
          },
        ),
      ),
    );
  }
}

class _AutoFollowToggle extends StatelessWidget {
  const _AutoFollowToggle({required this.replay});

  final JourneyReplayController replay;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: replay.toggleFollowCamera,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              replay.followCamera
                  ? Icons.gps_fixed_rounded
                  : Icons.gps_off_rounded,
              size: 16,
              color: replay.followCamera
                  ? JourneyScreenTheme.accent
                  : JourneyScreenTheme.textMuted,
            ),
            const SizedBox(width: 4),
            Text(
              'Auto-follow',
              style: JourneyScreenTheme.textStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: replay.followCamera
                    ? JourneyScreenTheme.accent
                    : JourneyScreenTheme.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
