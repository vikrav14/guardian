import 'dart:async';
import '../../theme/app_theme.dart';
import 'package:flutter/material.dart';
import '../../models/incident_photos.dart';
import '../../screens/incident_photo_page.dart';
import '../../services/safety_snapshot_service.dart';

/// Read-only availability. Opening the card never sends a capture command.
class IncidentPhotoAction extends StatefulWidget {
  const IncidentPhotoAction({
    super.key,
    required this.imei,
    this.service,
    this.wearerName,
    this.onCall,
    this.onLocation,
  });
  final String imei;
  final SafetySnapshotService? service;
  final String? wearerName;
  final VoidCallback? onCall, onLocation;
  @override
  State<IncidentPhotoAction> createState() => _IncidentPhotoActionState();
}

class _IncidentPhotoActionState extends State<IncidentPhotoAction>
    with WidgetsBindingObserver {
  SafetySnapshotService? _service;
  IncidentPhotoAccess? _access;
  String? _error;
  Timer? _timer;
  bool _foreground = true, _loading = false;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    _service =
        widget.service ??
        (guardianSnapshotGatewayUrl.isNotEmpty
            ? SafetySnapshotService()
            : null);
    WidgetsBinding.instance.addObserver(this);
    unawaited(_refresh());
    _timer = Timer.periodic(const Duration(seconds: 15), (_) {
      if (mounted) setState(() {});
      if (_foreground && TickerMode.valuesOf(context).enabled) {
        unawaited(_refresh());
      }
    });
  }

  @override
  void didUpdateWidget(IncidentPhotoAction oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.imei != oldWidget.imei) {
      _generation++;
      _access = null;
      _error = null;
      unawaited(_refresh());
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _generation++;
    setState(() => _access = null);
    if (_foreground) unawaited(_refresh());
  }

  Future<void> _refresh() async {
    if (_loading || !_foreground || _service == null) return;
    final generation = _generation;
    _loading = true;
    try {
      final access = await _service!.activeIncident(widget.imei);
      if (mounted && _foreground && generation == _generation) {
        setState(() {
          _access = access;
          _error = null;
        });
      }
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() {
          _access = null;
          _error = 'Photo access could not be checked.';
        });
      }
    } finally {
      _loading = false;
      if (mounted && _foreground && generation != _generation) {
        unawaited(_refresh());
      }
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    if (widget.service == null) _service?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final open =
        _foreground &&
        _access?.windowOpen == true &&
        _access?.incidentId != null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        OutlinedButton.icon(
          style: GuardianControlStyles.tonal(context),
          key: ValueKey('incident-photos-${widget.imei}'),
          onPressed: open
              ? () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => IncidentPhotoPage(
                        incidentId: _access!.incidentId!,
                        wearerName: widget.wearerName,
                        onCall: widget.onCall,
                        onLocation: widget.onLocation,
                      ),
                    ),
                  );
                  if (mounted) unawaited(_refresh());
                }
              : null,
          icon: const Icon(Icons.camera_alt_outlined),
          label: Text(
            open ? 'Photos · ${_access!.minutesLeft} min left' : 'Photos',
          ),
        ),
        const SizedBox(height: 4),
        Text(
          _error ??
              (open
                  ? 'One automatic photo. Request more when needed.'
                  : _access?.message ??
                        (_service == null
                            ? 'Photo access is not configured in this app.'
                            : 'Checking photo access…')),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        if (_error != null)
          TextButton(
            onPressed: _refresh,
            child: const Text('Retry connection'),
          ),
      ],
    );
  }
}
