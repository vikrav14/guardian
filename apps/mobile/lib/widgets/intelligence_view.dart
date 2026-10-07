import 'dart:async';
import 'package:flutter/material.dart';
import '../services/intelligence_service.dart';
import '../theme/app_theme.dart';
import 'cards/guardian_surface.dart';

/// Home and incident views use the same read-only, permission-aware experience.
/// A foreground refresh only reads facts; it never starts a paid generation.
class IntelligenceView extends StatefulWidget {
  const IntelligenceView({
    super.key,
    required this.imei,
    required this.wearerName,
    this.incidentId,
    this.client,
    this.onEvidence,
    this.showComposer = false,
  });
  final String imei, wearerName;
  final String? incidentId;
  final IntelligenceClient? client;
  final void Function(IntelligenceFact)? onEvidence;
  final bool showComposer;
  @override
  State<IntelligenceView> createState() => _IntelligenceViewState();
}

class _IntelligenceViewState extends State<IntelligenceView>
    with WidgetsBindingObserver {
  late IntelligenceClient _client;
  final _question = TextEditingController();
  StreamSubscription<void>? _access;
  Timer? _expiry;
  ModalRoute<dynamic>? _route;
  IntelligenceAnswer? _answer;
  String? _error, _asked;
  bool _loading = false, _foreground = true;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    _client = widget.client ?? IntelligenceService();
    WidgetsBinding.instance.addObserver(this);
    _subscribe();
    unawaited(_load());
  }

  void _subscribe() {
    _access = _client.accessChanges(widget.imei).listen((_) => _clear());
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _route = ModalRoute.of(context);
  }

  @override
  void didUpdateWidget(IntelligenceView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.imei != oldWidget.imei ||
        widget.incidentId != oldWidget.incidentId) {
      unawaited(_access?.cancel());
      _subscribe();
      _clear();
    }
  }

  void _clear() {
    if (!mounted) return;
    _generation++;
    _expiry?.cancel();
    _question.clear();
    setState(() {
      _answer = null;
      _asked = null;
      _error = null;
      _loading = false;
    });
    if (_foreground) unawaited(_load());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _clear();
  }

  Future<void> _load({String? question}) async {
    if (!_foreground || _loading || _route?.isCurrent == false) return;
    final generation = ++_generation;
    _expiry?.cancel();
    setState(() {
      _loading = true;
      _error = null;
      _answer = null;
      _asked = question;
    });
    try {
      final result = await (question == null
          ? _client.load(widget.imei, incidentId: widget.incidentId)
          : _client.ask(widget.imei, question, incidentId: widget.incidentId));
      if (!mounted || !_foreground || generation != _generation) return;
      if (result.expired) throw const IntelligenceException('evidence_expired');
      setState(() => _answer = result);
      _expiry = Timer(result.validUntil.difference(DateTime.now()), () {
        if (!mounted || generation != _generation) return;
        setState(() {
          _answer = null;
          _asked = null;
        });
        // Never replay a paid question. Refresh the recorded overview only.
        unawaited(_load());
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      setState(
        () => _error = error is IntelligenceException
            ? error.message
            : const IntelligenceException('unavailable').message,
      );
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  void _ask(String value) {
    final question = value.trim();
    if (question.isEmpty || question.length > 500) return;
    _question.clear();
    unawaited(_load(question: question));
  }

  void _openQuestions() {
    Navigator.of(context)
        .push(
          MaterialPageRoute<void>(
            builder: (_) => Scaffold(
              appBar: AppBar(title: const Text('Ask Guardian')),
              body: SafeArea(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: IntelligenceView(
                    imei: widget.imei,
                    wearerName: widget.wearerName,
                    incidentId: widget.incidentId,
                    onEvidence: widget.onEvidence,
                    showComposer: true,
                  ),
                ),
              ),
            ),
          ),
        )
        .then((_) {
          if (mounted) _clear();
        });
  }

  @override
  void dispose() {
    _generation++;
    _expiry?.cancel();
    unawaited(_access?.cancel());
    _question.dispose();
    if (widget.client == null) _client.close();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors, answer = _answer;
    return GuardianSurface(
      radius: 24,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.auto_awesome_outlined, color: colors.accent, size: 25),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.showComposer
                          ? widget.wearerName
                          : widget.incidentId == null
                          ? 'Today with Guardian'
                          : 'Incident brief',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      answer?.basis ?? 'Recorded facts, with their limits',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'Refresh recorded overview',
                onPressed: _loading ? null : () => _load(),
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          const SizedBox(height: 18),
          if (_loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            Text(_error!, style: TextStyle(color: colors.textSecondary)),
          if (_asked != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 14),
              child: Text(
                _asked!,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          if (answer != null) ...[
            if (answer.message != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(answer.message!),
              ),
            for (final fact in answer.facts)
              Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      fact.text,
                      style: TextStyle(color: colors.textPrimary, height: 1.5),
                    ),
                    if (widget.onEvidence != null &&
                        fact.screen.isNotEmpty &&
                        !(widget.incidentId != null &&
                            fact.screen == 'incident'))
                      TextButton.icon(
                        onPressed: () => widget.onEvidence!(fact),
                        icon: const Icon(Icons.arrow_forward, size: 16),
                        label: Text(
                          fact.isPhotoObservation
                              ? 'View photo and limitations'
                              : 'View record',
                        ),
                        style: TextButton.styleFrom(
                          padding: EdgeInsets.zero,
                          minimumSize: const Size(48, 40),
                          alignment: Alignment.centerLeft,
                        ),
                      ),
                  ],
                ),
              ),
            if (answer.gaps.isNotEmpty)
              DecoratedBox(
                decoration: BoxDecoration(
                  color: colors.surfaceMuted,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Text(
                    answer.gaps.join('\n'),
                    style: TextStyle(
                      color: colors.textSecondary,
                      height: 1.4,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 12),
            Text(
              'Updated ${TimeOfDay.fromDateTime(answer.asOf.toUtc().add(const Duration(hours: 4))).format(context)} · Mauritius time',
              style: TextStyle(color: colors.textSecondary, fontSize: 12),
            ),
          ],
          const SizedBox(height: 16),
          if (!widget.showComposer)
            OutlinedButton.icon(
              onPressed: _loading ? null : _openQuestions,
              icon: const Icon(Icons.chat_bubble_outline),
              label: const Text('Ask Guardian'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            )
          else ...[
            if (answer != null)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: answer.suggestions
                    .map(
                      (q) => ActionChip(
                        label: Text(q),
                        onPressed: _loading ? null : () => _ask(q),
                      ),
                    )
                    .toList(),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _question,
              enabled: !_loading,
              maxLength: 500,
              minLines: 1,
              maxLines: 4,
              textInputAction: TextInputAction.send,
              onSubmitted: _ask,
              decoration: const InputDecoration(
                labelText: 'Ask about recorded information',
                hintText: 'What needs my attention?',
              ),
            ),
            FilledButton.icon(
              onPressed: _loading ? null : () => _ask(_question.text),
              icon: const Icon(Icons.send_outlined),
              label: const Text('Ask Guardian'),
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
