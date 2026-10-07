// Separate review entry point: recorded synthetic answers, no Firebase startup,
// live wearer, API key, provider call or watch connection.
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:guardian/services/intelligence_service.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/intelligence_view.dart';
import 'package:http/http.dart' as http;

void main() {
  if (Uri.base.host != '127.0.0.1' || Uri.base.port != 9084) {
    throw StateError(
      'Intelligence review requires the isolated local review server.',
    );
  }
  runApp(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: buildGuardianTheme(),
      home: const IntelligenceReview(),
    ),
  );
}

class IntelligenceReview extends StatefulWidget {
  const IntelligenceReview({super.key});
  @override
  State<IntelligenceReview> createState() => _IntelligenceReviewState();
}

class _IntelligenceReviewState extends State<IntelligenceReview> {
  late final _report = _read();
  String? _selected;
  bool _largeText = false;
  Future<Map<String, dynamic>> _read() async {
    final response = await http.get(Uri.base.resolve('/qa-results.json'));
    if (response.statusCode != 200) {
      throw StateError('Review evidence unavailable.');
    }
    final report = jsonDecode(response.body) as Map<String, dynamic>;
    if (report['synthetic'] != true) {
      throw StateError('Synthetic evidence required.');
    }
    return report;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Guardian · historical evidence replay')),
    body: FutureBuilder<Map<String, dynamic>>(
      future: _report,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(
            child: Text(
              'Start the local review server with a completed synthetic report.',
            ),
          );
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final report = snapshot.data!;
        final rows = (report['results'] as List).cast<Map<String, dynamic>>();
        final selected = rows.firstWhere(
          (r) => r['id'] == _selected,
          orElse: () => rows.first,
        );
        final client = _ReplayClient(selected);
        return SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 760),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'SAMPLE DATA · RECORDED TEST REPLAY',
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Historical selector results in the read-only evidence panel. Ask Guardian has been removed. This replay makes no AI calls and cannot contact a watch.',
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${report['passed']} of ${rows.length} scenarios passed · ${report['generations']} model calls in the saved run',
                  ),
                  Text(
                    'Run cost at configured rates: Rs ${(report['planningMur'] as num).toStringAsFixed(2)}. Viewing this replay adds no model usage.',
                  ),
                  const SizedBox(height: 20),
                  DropdownButtonFormField<String>(
                    initialValue: selected['id'] as String,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Choose a test scenario',
                    ),
                    items: rows
                        .map(
                          (row) => DropdownMenuItem(
                            value: row['id'] as String,
                            child: Text(
                              row['question'] as String,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (id) => setState(() => _selected = id),
                  ),
                  SwitchListTile.adaptive(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Check larger text'),
                    value: _largeText,
                    onChanged: (value) => setState(() => _largeText = value),
                  ),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 16),
                    child: Text(
                      'Expected: ${selected['expected']}',
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  MediaQuery(
                    data: MediaQuery.of(context).copyWith(
                      textScaler: TextScaler.linear(_largeText ? 1.5 : 1),
                    ),
                    child: IntelligenceView(
                      key: ValueKey(selected['id']),
                      imei: 'synthetic-review',
                      wearerName: 'Sample wearer',
                      incidentId:
                          (selected['id'] as String).startsWith('incident')
                          ? 'synthetic-incident'
                          : null,
                      client: client,
                      onEvidence: (fact) => showDialog<void>(
                        context: context,
                        builder: (context) => AlertDialog(
                          title: const Text('Sample evidence'),
                          content: Text(
                            '${fact.text}\n\nThis record belongs only to the synthetic test scenario.',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () => Navigator.pop(context),
                              child: const Text('Close'),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    ),
  );
}

class _ReplayClient implements IntelligenceClient {
  _ReplayClient(this.selected);
  final Map<String, dynamic> selected;
  @override
  Stream<void> accessChanges(String imei) => const Stream<void>.empty();
  IntelligenceAnswer _answer(Map<String, dynamic>? row) {
    if (row?['reason'] == 'access_not_shared') {
      throw const IntelligenceException('access_not_shared');
    }
    final now = DateTime.now();
    final facts = ((row?['evidence'] as List?) ?? [])
        .cast<Map<String, dynamic>>();
    return IntelligenceAnswer(
      asOf: now,
      validUntil: now.add(const Duration(minutes: 1)),
      mode: row?['mode'] as String? ?? 'recorded',
      facts: facts.indexed
          .map(
            (entry) => IntelligenceFact(
              id: 'synthetic-${entry.$1}',
              text: entry.$2['text'] as String,
              source: entry.$2['kind'] == 'photo_observation'
                  ? 'photo_ai'
                  : 'watch',
              screen: 'synthetic-record',
            ),
          )
          .toList(),
      gaps: const [
        'Synthetic test replay. A watch record does not confirm a person’s condition or current presence.',
      ],
      suggestions: row == null ? const [] : [row['question'] as String],
      message: row == null
          ? 'This preview replays saved test results. Choose a scenario above; new questions do not call the AI.'
          : row['message'] as String? ??
                (row['reason'] == 'ai_unavailable'
                    ? 'Guardian could not analyse this question right now. You can still check the recorded overview.'
                    : row['answerable'] == true
                    ? null
                    : 'There is not enough recorded information to answer that yet.'),
    );
  }

  @override
  Future<IntelligenceAnswer> load(String imei, {String? incidentId}) async =>
      _answer(selected);
  @override
  void close() {}
}
