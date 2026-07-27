import 'package:flutter/material.dart';

import '../../widgets/brand/dodo_ai_icon.dart';
import '../journey_replay_controller.dart';
import 'journey_screen_theme.dart';

/// Small circular "Ask Guardian" button — opens AI narration sheet on tap.
class JourneyAssistantButton extends StatelessWidget {
  const JourneyAssistantButton({
    super.key,
    required this.replay,
  });

  final JourneyReplayController replay;

  String? _narrationMessage() {
    if (replay.isReplayMode && replay.currentNarration != null) {
      return replay.currentNarration;
    }
    if (!replay.isReplayMode) {
      return replay.insights.routeSummary;
    }
    return replay.insights.routeSummary;
  }

  void _openSheet(BuildContext context) {
    final message = _narrationMessage();
    if (message == null || message.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No AI insights available for this journey.')),
      );
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: JourneyScreenTheme.background,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(JourneyScreenTheme.radiusLarge),
        ),
      ),
      builder: (context) => _AssistantSheet(
        message: message,
        confidence: replay.insights.confidenceScore,
        highQuality: replay.insights.highDataQuality,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () => _openSheet(context),
        customBorder: const CircleBorder(),
        child: Container(
          width: JourneyScreenTheme.minTouchTarget,
          height: JourneyScreenTheme.minTouchTarget,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: JourneyScreenTheme.cardFill,
            border: Border.all(color: JourneyScreenTheme.cardBorder),
            boxShadow: const [
              BoxShadow(
                color: Color(0x66000000),
                blurRadius: 12,
                offset: Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const GuardianAiIcon(size: 24),
              Text(
                'Ask',
                style: JourneyScreenTheme.textStyle(
                  fontSize: 8,
                  fontWeight: FontWeight.w700,
                  color: JourneyScreenTheme.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AssistantSheet extends StatelessWidget {
  const _AssistantSheet({
    required this.message,
    required this.confidence,
    required this.highQuality,
  });

  final String message;
  final int confidence;
  final bool highQuality;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(JourneyScreenTheme.spacing2),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: JourneyScreenTheme.textMuted,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: JourneyScreenTheme.spacing2),
            Row(
              children: [
                const GuardianAiIcon(size: 40),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Ask Guardian',
                        style: JourneyScreenTheme.textStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        highQuality
                            ? 'Confidence $confidence% · High data quality'
                            : 'Confidence $confidence%',
                        style: JourneyScreenTheme.textStyle(
                          fontSize: 11,
                          color: JourneyScreenTheme.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: JourneyScreenTheme.spacing2),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: JourneyScreenTheme.glassCard(),
              child: Text(
                message,
                style: JourneyScreenTheme.textStyle(
                  fontSize: 14,
                  height: 1.45,
                  color: JourneyScreenTheme.textSecondary,
                ),
              ),
            ),
            const SizedBox(height: JourneyScreenTheme.spacing2),
          ],
        ),
      ),
    );
  }
}
