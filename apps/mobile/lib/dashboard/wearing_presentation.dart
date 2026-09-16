import '../models/wear_check.dart';
import '../models/wear_status.dart';

enum WearingTone { neutral, detected, removal }

/// Display policy only. Manual checks cannot qualify activity or watch readings.
class WearingPresentation {
  const WearingPresentation(this.title, this.detail, this.tone);

  final String title;
  final String detail;
  final WearingTone tone;

  factory WearingPresentation.at({
    required DateTime now,
    required bool connected,
    WearStatus status = const WearStatus(),
    WearCheck? check,
  }) {
    final removal = status.lastRemovalReportedAt;
    final validRemoval = removal != null && !removal.isAfter(now);
    final validCheck = check != null && !check.observedAt.isAfter(now);
    final automatic = connected ? status.stateAt(now) : 'unknown';
    final automaticAt = status.observedAt;

    // A newer family observation or removal report overrides older sensor
    // evidence in this display. Equal-time contradictions never show green.
    if (automatic != 'unknown' && automaticAt != null &&
        (!validCheck || automaticAt.isAfter(check.recordedAt)) &&
        (!validRemoval || automaticAt.isAfter(removal))) {
      return WearingPresentation(
        automatic == 'worn' ? 'Wearing detected' : 'Watch off wrist',
        'Watch sensor · ${wearingAge(automaticAt, now)}',
        automatic == 'worn' ? WearingTone.detected : WearingTone.removal,
      );
    }
    if (validCheck && (!validRemoval || check.observedAt.isAfter(removal))) {
      return WearingPresentation(
        check.state == 'worn' ? 'Last checked on wrist' : 'Last checked off wrist',
        'Family check · ${wearingAge(check.observedAt, now)}',
        WearingTone.neutral,
      );
    }
    if (validRemoval) {
      return WearingPresentation(
        'Removal reported',
        '${wearingAge(removal, now)} · Wearing now is unconfirmed',
        WearingTone.removal,
      );
    }
    return const WearingPresentation(
      'Wearing not confirmed',
      'Tap to view or record a family check',
      WearingTone.neutral,
    );
  }
}

String wearingAge(DateTime observedAt, DateTime now) {
  final age = now.difference(observedAt);
  if (age.inMinutes < 1) return 'just now';
  if (age.inHours < 1) return '${age.inMinutes}m ago';
  if (age.inDays < 1) return '${age.inHours}h ago';
  return '${age.inDays}d ago';
}
