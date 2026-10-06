import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../services/family_sharing_service.dart';

class AlertResponsePanel extends StatefulWidget {
  const AlertResponsePanel({
    super.key,
    required this.imei,
    required this.alertId,
    required this.resolved,
    this.responses,
    this.respond,
    this.uid,
  });
  final String imei, alertId;
  final bool resolved;
  final Stream<List<Map<String, dynamic>>>? responses;
  final Future<void> Function()? respond;
  final String? uid;
  @override
  State<AlertResponsePanel> createState() => _AlertResponsePanelState();
}

class _AlertResponsePanelState extends State<AlertResponsePanel> {
  late final Stream<List<Map<String, dynamic>>> _responses;
  late final String? _uid;
  bool _busy = false;
  String? _error;
  @override
  void initState() {
    super.initState();
    _uid = widget.uid ?? FirebaseAuth.instance.currentUser?.uid;
    _responses =
        widget.responses ??
        FirebaseFirestore.instance
            .collection('alerts')
            .doc(widget.alertId)
            .collection('responses')
            .snapshots()
            .map((s) => s.docs.map((d) => d.data()).toList());
  }

  Future<void> _respond() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (widget.respond != null) {
        await widget.respond!();
      } else {
        final client = FamilySharingService();
        try {
          await client.change('respond', {
            'alertId': widget.alertId,
          }, imei: widget.imei);
        } finally {
          client.close();
        }
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Your response could not be confirmed. Try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(
    BuildContext context,
  ) => StreamBuilder<List<Map<String, dynamic>>>(
    stream: _responses,
    builder: (context, snapshot) {
      final rows = snapshot.hasError
          ? <Map<String, dynamic>>[]
          : snapshot.data ?? [];
      final mine = rows.any((r) => r['uid'] == _uid);
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Family response',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          if (snapshot.hasError)
            const Text(
              'Responses are unavailable. Refresh this alert to check access.',
            )
          else if (rows.isEmpty)
            const Text('No response confirmed yet.')
          else
            for (final row in rows)
              Text(
                '${row['name'] ?? 'Family member'} ${widget.resolved ? 'responded' : 'is responding'}',
              ),
          if (!widget.resolved) ...[
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _busy || mine || snapshot.hasError || !snapshot.hasData
                  ? null
                  : _respond,
              icon: Icon(
                mine
                    ? Icons.check_circle_outline
                    : Icons.volunteer_activism_outlined,
              ),
              label: Text(
                _busy
                    ? 'Confirming…'
                    : mine
                    ? 'You are responding'
                    : 'I’m responding',
              ),
            ),
          ],
          const SizedBox(height: 8),
          const Text(
            'This tells your family you are responding. It does not mark the incident as resolved or contact emergency services.',
          ),
          if (_error != null && !mine)
            Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
        ],
      );
    },
  );
}
