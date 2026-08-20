import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/location_history_point.dart';
import 'journey_utils.dart';

/// Builds a plain-text journey summary suitable for clipboard or messaging apps.
String buildJourneyShareText({
  required String deviceName,
  required DateTime day,
  required List<LocationHistoryPoint> points,
}) {
  final stats = buildJourneyStats(points);
  final insights = buildJourneyInsights(points);
  final score = computeJourneyScore(points);
  final dateLabel = DateFormat.yMMMEd().format(day);
  final start = stats.startTime != null
      ? DateFormat.Hm().format(stats.startTime!)
      : '--:--';
  final end = stats.endTime != null
      ? DateFormat.Hm().format(stats.endTime!)
      : '--:--';

  final buffer = StringBuffer()
    ..writeln('🛡️ Guardian Journey — $deviceName')
    ..writeln(dateLabel)
    ..writeln('')
    ..writeln(
      '📍 ${stats.distanceKm.toStringAsFixed(1)} km · ${formatJourneyDuration(stats.duration)}',
    )
    ..writeln('⏱ $start – $end · ${stats.pointCount} GPS fixes')
    ..writeln('⭐ Journey score ${score.overall}/100')
    ..writeln('')
    ..writeln('Route: ${insights.routeSummary}')
    ..writeln('')
    ..writeln('Tracked with Guardian — family GPS safety for Mauritius');

  return buffer.toString().trim();
}

Future<void> copyJourneyToClipboard(String text) async {
  await Clipboard.setData(ClipboardData(text: text));
}

Future<bool> shareViaWhatsApp(String text) async {
  final uri = Uri.parse('https://wa.me/?text=${Uri.encodeComponent(text)}');
  if (await canLaunchUrl(uri)) {
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
  return false;
}

/// Copies summary to clipboard; on mobile also tries WhatsApp deep link.
Future<ShareJourneyResult> shareJourneySummary(String text) async {
  await copyJourneyToClipboard(text);

  if (kIsWeb) {
    return ShareJourneyResult.copiedOnly;
  }

  final whatsAppOk = await shareViaWhatsApp(text);
  return whatsAppOk
      ? ShareJourneyResult.copiedAndWhatsApp
      : ShareJourneyResult.copiedOnly;
}

enum ShareJourneyResult { copiedOnly, copiedAndWhatsApp }
