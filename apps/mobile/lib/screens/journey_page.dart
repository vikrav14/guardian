import 'package:flutter/material.dart';

import '../journey/journey_models.dart';
import '../journey/journey_v2_data.dart';
import '../journey/journey_v2_ui.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';

class JourneyPage extends StatefulWidget {
  const JourneyPage({
    super.key,
    required this.imei,
    required this.deviceName,
    this.avatarUrl,
  });

  final String imei;
  final String deviceName;
  final String? avatarUrl;

  @override
  State<JourneyPage> createState() => _JourneyPageState();
}

class _JourneyPageState extends State<JourneyPage> {
  late DateTime _day = _today();
  String? _selectedId;

  static DateTime _today() {
    final now = DateTime.now();
    return DateTime(now.year, now.month, now.day);
  }

  Future<void> _chooseDay() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
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

    return Scaffold(
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1180),
            child: StreamBuilder<List<JourneyRecord>>(
              key: ValueKey(_day),
              stream: DeviceService().watchDayJourneys(widget.imei, _day),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
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

                return JourneyV2Dashboard(
                  deviceName: widget.deviceName,
                  avatarUrl: widget.avatarUrl,
                  day: _day,
                  journeys: journeys,
                  selected: selected,
                  onSelectJourney: (journey) {
                    setState(() => _selectedId = journey.id);
                  },
                  onBack: () => Navigator.maybePop(context),
                  onChooseDay: _chooseDay,
                );
              },
            ),
          ),
        ),
      ),
    );
  }
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
