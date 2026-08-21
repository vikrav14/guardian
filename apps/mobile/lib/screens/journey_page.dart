import 'package:flutter/material.dart';

import '../journey/journey_models.dart';
import '../journey/journey_v2_data.dart';
import '../journey/journey_v2_ui.dart';
import '../models/geofence.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';

class JourneyPage extends StatefulWidget {
  const JourneyPage({
    super.key,
    required this.imei,
    required this.deviceName,
    required this.subscription,
    this.avatarUrl,
  });

  final String imei;
  final String deviceName;
  final GuardianSubscription subscription;
  final String? avatarUrl;

  @override
  State<JourneyPage> createState() => _JourneyPageState();
}

class _JourneyPageState extends State<JourneyPage> {
  late DateTime _day = _today();
  late final Stream<List<Geofence>> _geofenceStream;
  String? _selectedId;
  String? _lastReportedJourneyError;

  @override
  void initState() {
    super.initState();
    _geofenceStream = GeofenceService().watchAll();
  }

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  Future<void> _chooseDay() async {
    final subscription = widget.subscription;
    final firstDate = subscription.historyFirstSelectableDay();
    final initialDate = subscription.canAccessHistoryDay(_day)
        ? _day
        : _today();
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: DateTime.now(),
    );
    if (picked == null || !mounted) return;

    setState(() {
      _day = DateTime(picked.year, picked.month, picked.day);
      _selectedId = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final subscription = widget.subscription;
    final decision = GuardianEntitlementDecision.resolve(
      feature: GuardianFeature.locationHistory,
      subscription: subscription,
    );

    if (!decision.allowed) {
      return Scaffold(
        backgroundColor: colors.canvas,
        body: _JourneyStateMessage(
          icon: Icons.lock_outline_rounded,
          title: decision.title,
          message: decision.message,
          actionLabel: 'Go back',
          onAction: () => Navigator.maybePop(context),
        ),
      );
    }
    final effectiveDay = subscription.canAccessHistoryDay(_day)
        ? _day
        : _today();

    return Scaffold(
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: StreamBuilder<List<JourneyRecord>>(
              key: ValueKey(effectiveDay),
              stream: DeviceService().watchDayJourneys(
                widget.imei,
                effectiveDay,
                subscription: subscription,
              ),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  final errorSignature = '${snapshot.error}';
                  if (_lastReportedJourneyError != errorSignature) {
                    _lastReportedJourneyError = errorSignature;
                    debugPrint(
                      '[journey] Failed to load ${widget.imei} for '
                      '${effectiveDay.toIso8601String()}: ${snapshot.error}',
                    );
                    if (snapshot.stackTrace != null) {
                      debugPrintStack(
                        label: '[journey] Journey stream stack trace',
                        stackTrace: snapshot.stackTrace,
                      );
                    }
                  }
                  return _JourneyStateMessage(
                    icon: Icons.cloud_off_rounded,
                    title: 'Journey unavailable',
                    message:
                        'Guardian could not load recorded journeys for this day.',
                    actionLabel: 'Choose another day',
                    onAction: _chooseDay,
                  );
                }

                if (!snapshot.hasData) {
                  return const Center(
                    child: CircularProgressIndicator(
                      color: GuardianColors.safe,
                    ),
                  );
                }

                _lastReportedJourneyError = null;

                final journeys = snapshot.data!;
                if (journeys.isEmpty) {
                  return _JourneyStateMessage(
                    icon: Icons.route_outlined,
                    title: 'No journey recorded',
                    message:
                        'There is no recorded journey for the selected day.',
                    actionLabel: 'Choose another day',
                    onAction: _chooseDay,
                  );
                }

                final selected = journeyV2SelectRecord(
                  journeys,
                  selectedId: _selectedId,
                );
                return StreamBuilder<JourneyRoutePresentation?>(
                  key: ValueKey('journey-presentation-${selected?.id}'),
                  initialData: null,
                  stream: selected == null
                      ? null
                      : DeviceService().watchJourneyPresentation(
                          widget.imei,
                          selected.id,
                        ),
                  builder: (context, presentationSnapshot) {
                    return StreamBuilder<List<Geofence>>(
                      initialData: const <Geofence>[],
                      stream: _geofenceStream,
                      builder: (context, geofenceSnapshot) {
                        return JourneyV2Dashboard(
                          deviceName: widget.deviceName,
                          deviceImei: widget.imei,
                          avatarUrl: widget.avatarUrl,
                          day: effectiveDay,
                          journeys: journeys,
                          selected: selected,
                          presentation: presentationSnapshot.data,
                          originGeofence: journeyOriginGeofence(
                            selected,
                            geofenceSnapshot.data ?? const <Geofence>[],
                            imei: widget.imei,
                          ),
                          onSelectJourney: (journey) {
                            setState(() => _selectedId = journey.id);
                          },
                          onBack: () => Navigator.maybePop(context),
                          onChooseDay: _chooseDay,
                        );
                      },
                    );
                  },
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

Geofence? journeyOriginGeofence(
  JourneyRecord? journey,
  List<Geofence> geofences, {
  required String imei,
}) {
  if (journey == null) return null;
  final candidates = geofences.where(
    (zone) => zone.active && zone.imei == imei,
  );
  final originId = journey.originGeofenceId?.trim();
  if (originId != null && originId.isNotEmpty) {
    for (final zone in candidates) {
      if (zone.id == originId) return zone;
    }
  }

  final originName = journey.originGeofenceName?.trim().toLowerCase();
  if (originName == null || originName.isEmpty) return null;
  for (final zone in candidates) {
    if (zone.name.trim().toLowerCase() == originName) return zone;
  }
  return null;
}

class _JourneyStateMessage extends StatelessWidget {
  const _JourneyStateMessage({
    required this.icon,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 520),
          padding: const EdgeInsets.all(26),
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(26),
            border: Border.all(color: colors.border),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 34, color: GuardianColors.safe),
              const SizedBox(height: 14),
              Text(
                title,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                message,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: colors.textSecondary,
                  fontSize: 11,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.calendar_month_rounded),
                label: Text(actionLabel),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
