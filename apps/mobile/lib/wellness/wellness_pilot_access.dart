import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'linked_wellness_stream.dart';
import 'wellness_card.dart';

class WellnessPilotGrant {
  const WellnessPilotGrant(this.createdAt, this.expiresAt, this.enabled);
  final DateTime createdAt, expiresAt;
  final bool enabled;
  bool validAt(DateTime now) =>
      enabled &&
      !createdAt.isAfter(now) &&
      expiresAt.isAfter(now) &&
      expiresAt.difference(createdAt) <= const Duration(days: 1);
}

/// A build flag requests preview; only the server-owned account grant allows it.
/// The boundary is also used on the pushed history route, and expires locally.
class WellnessPilotAccess extends StatefulWidget {
  const WellnessPilotAccess({
    super.key,
    required this.imei,
    required this.child,
    this.grants,
    this.unavailableChild,
    this.loadingChild,
  });
  final String imei;
  final Widget child;
  final Stream<List<WellnessPilotGrant>>? grants;
  final Widget? unavailableChild;
  final Widget? loadingChild;
  @override
  State<WellnessPilotAccess> createState() => _WellnessPilotAccessState();
}

class _WellnessPilotAccessState extends State<WellnessPilotAccess> {
  StreamSubscription<List<WellnessPilotGrant>>? _subscription;
  Timer? _expiry;
  WellnessPilotGrant? _grant;
  bool _loading = true;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _connect();
  }

  void _connect() {
    final generation = ++_generation;
    final stream =
        widget.grants ??
        watchLinkedWellnessData<WellnessPilotGrant>(
          FirebaseFirestore.instance,
          FirebaseAuth.instance,
          widget.imei,
          () => FirebaseFirestore.instance
              .collection('wellnessPilots')
              .doc(widget.imei)
              .snapshots()
              .map((doc) {
                final d = doc.data();
                if (d == null ||
                    d['version'] != 1 ||
                    d['managedBy'] != 'guardian_admin' ||
                    d['viewerUid'] != FirebaseAuth.instance.currentUser?.uid ||
                    d['createdAt'] is! Timestamp ||
                    d['expiresAt'] is! Timestamp) {
                  return <WellnessPilotGrant>[];
                }
                return [
                  WellnessPilotGrant(
                    (d['createdAt'] as Timestamp).toDate(),
                    (d['expiresAt'] as Timestamp).toDate(),
                    d['enabled'] == true,
                  ),
                ];
              }),
        );
    _subscription = stream.listen(
      (values) {
        if (!mounted || generation != _generation) return;
        _expiry?.cancel();
        setState(() {
          _loading = false;
          _grant = values.firstOrNull;
        });
        final grant = _grant;
        if (grant != null && grant.validAt(DateTime.now())) {
          _expiry = Timer(grant.expiresAt.difference(DateTime.now()), () {
            if (mounted && generation == _generation) {
              setState(() => _grant = null);
            }
          });
        }
      },
      onError: (Object error) {
        if (!mounted || generation != _generation) return;
        _expiry?.cancel();
        setState(() {
          _loading = false;
          _grant = null;
        });
      },
    );
  }

  @override
  void didUpdateWidget(covariant WellnessPilotAccess oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imei != widget.imei || oldWidget.grants != widget.grants) {
      _subscription?.cancel();
      _expiry?.cancel();
      _grant = null;
      _loading = true;
      _connect();
    }
  }

  @override
  void dispose() {
    ++_generation;
    _subscription?.cancel();
    _expiry?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _grant?.validAt(DateTime.now()) == true
      ? widget.child
      : _loading && widget.loadingChild != null
      ? widget.loadingChild!
      : !_loading && widget.unavailableChild != null
      ? widget.unavailableChild!
      : WellnessSurface(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const WellnessHeading(
                title: 'Wellness',
                subtitle: 'Private pilot preview',
              ),
              const SizedBox(height: 12),
              Text(
                _loading
                    ? 'Checking preview access…'
                    : 'Preview access is unavailable or has expired.',
              ),
            ],
          ),
        );
}

