import 'package:flutter/material.dart';

import '../models/care_profile.dart';
import '../models/device.dart';
import '../models/medication_reminder.dart';
import '../services/guardian_services.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_card.dart';
import '../widgets/care/care_profile_card.dart';
import '../widgets/layout/guardian_page_frame.dart';

/// V46/V48/V52 only. Fall detection and medication reminders are TCP
/// downlink commands with no SMS fallback -- the device must currently
/// hold a live connection to the gateway for either to actually reach it.
/// See gateway/src/commands.js and firestore/SCHEMA.md.
class CareSettingsPage extends StatefulWidget {
  const CareSettingsPage({super.key, required this.device});

  final Device device;

  @override
  State<CareSettingsPage> createState() => _CareSettingsPageState();
}

class _CareSettingsPageState extends State<CareSettingsPage> {
  late GuardianCareProfile _adaptiveProfile;
  late Set<String> _adaptivePriorities;

  late bool _fallEnabled;
  late bool _dialMonitor;
  late double _sensitivity;
  bool _savingFall = false;

  late String _locationReportingMode;
  late int _uploadIntervalSeconds;
  bool _savingInterval = false;

  static const _uploadIntervalPresets = [30, 60, 120, 300];

  @override
  void initState() {
    super.initState();
    _adaptiveProfile = GuardianCareProfileX.fromValue(
      widget.device.careProfile,
    );
    _adaptivePriorities = widget.device.carePriorities.isEmpty
        ? {...GuardianCarePriority.defaultsFor(_adaptiveProfile)}
        : {...widget.device.carePriorities};
    _adaptiveProfile = GuardianCareProfileX.fromValue(
      widget.device.careProfile,
    );
    _adaptivePriorities = widget.device.carePriorities.isEmpty
        ? {...GuardianCarePriority.defaultsFor(_adaptiveProfile)}
        : {...widget.device.carePriorities};
    _fallEnabled = widget.device.fallDetectionEnabled ?? false;
    _dialMonitor = widget.device.fallDetectionDialMonitor ?? false;
    _sensitivity = (widget.device.fallDetectionSensitivity ?? 3).toDouble();
    _locationReportingMode = widget.device.locationReportingMode;
    final savedInterval = widget.device.locationReportingIntervalSeconds;
    _uploadIntervalSeconds = _uploadIntervalPresets.contains(savedInterval)
        ? savedInterval!
        : 60;
  }

  Future<void> _saveFallDetection() async {
    setState(() => _savingFall = true);
    try {
      await DeviceService().updateFallDetectionPrefs(
        widget.device.imei,
        enabled: _fallEnabled,
        dialMonitorOnFall: _dialMonitor,
        sensitivityLevel: _sensitivity.round(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Fall detection settings sent to watch')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Could not reach watch: $e')));
    } finally {
      if (mounted) setState(() => _savingFall = false);
    }
  }

  Future<void> _saveUploadInterval() async {
    setState(() => _savingInterval = true);
    try {
      await DeviceService().updateLocationReportingInterval(
        widget.device.imei,
        seconds: _uploadIntervalSeconds,
      );
      if (!mounted) return;
      setState(() => _locationReportingMode = 'manual');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Location update frequency sent to watch'),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Could not reach watch: $e')));
    } finally {
      if (mounted) setState(() => _savingInterval = false);
    }
  }

  Future<void> _enableAutomaticLocationReporting() async {
    setState(() => _savingInterval = true);
    try {
      await DeviceService().setAutomaticLocationReporting(widget.device.imei);
      if (!mounted) return;
      setState(() => _locationReportingMode = 'automatic');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Automatic location reporting enabled. Guardian will adapt to battery and safety events.',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not enable automatic reporting: $e')),
      );
    } finally {
      if (mounted) setState(() => _savingInterval = false);
    }
  }

  Future<void> _showAddReminderDialog() async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => _AddReminderDialog(imei: widget.device.imei),
    );
  }

  void _onCareDraftChanged(
    GuardianCareProfile profile,
    Set<String> priorities,
  ) {
    if (!mounted) return;
    if (_adaptiveProfile == profile &&
        _adaptivePriorities.length == priorities.length &&
        _adaptivePriorities.containsAll(priorities)) {
      return;
    }

    setState(() {
      _adaptiveProfile = profile;
      _adaptivePriorities = {...priorities};
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Scaffold(
      backgroundColor: colors.canvas,
      appBar: AppBar(
        backgroundColor: colors.canvas,
        elevation: 0,
        title: Text('${widget.device.displayName} - Care'),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
          child: GuardianPageFrame(
            maxWidth: 760,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'PROACTIVE WELLBEING',
                  style: TextStyle(
                    color: colors.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 1.1,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  'Care settings',
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'These need the watch to be online right now to take '
                  'effect - there is no SMS fallback for fall detection or '
                  'medication reminders.',
                  style: TextStyle(
                    color: colors.textSecondary,
                    fontSize: 12.5,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: GuardianSpacing.lg),
                CareProfileCard(
                  device: widget.device,
                  onChanged: _onCareDraftChanged,
                ),
                const SizedBox(height: GuardianSpacing.lg),
                _buildAdaptiveCareSections(colors),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildAdaptiveCareSections(GuardianThemeColors colors) {
    final priorities = _adaptivePriorities;

    final widgets = <Widget>[_buildLocationUpdatesCard(colors)];

    void addSection(Widget section) {
      widgets.add(const SizedBox(height: GuardianSpacing.lg));
      widgets.add(section);
    }

    if (priorities.contains(GuardianCarePriority.safeZones)) {
      addSection(
        _buildPriorityInfoCard(
          colors,
          icon: Icons.location_on_outlined,
          title: 'Safe zones',
          subtitle:
              'Important places Guardian can watch for arrivals and departures.',
        ),
      );
    }

    if (priorities.contains(GuardianCarePriority.journeys)) {
      addSection(
        _buildPriorityInfoCard(
          colors,
          icon: Icons.route_outlined,
          title: 'Journeys',
          subtitle:
              'Follow movement between places and make trips easier to understand.',
        ),
      );
    }

    if (priorities.contains(GuardianCarePriority.unusualStops)) {
      addSection(
        _buildPriorityInfoCard(
          colors,
          icon: Icons.pause_circle_outline_rounded,
          title: 'Unusual stops',
          subtitle:
              'Surface unexpected pauses or stops when they matter in context.',
        ),
      );
    }

    if (priorities.contains(GuardianCarePriority.wellbeing)) {
      addSection(_buildWellbeingInfoCard(colors));
    }

    if (priorities.contains(GuardianCarePriority.falls)) {
      addSection(_buildFallDetectionCard(colors));
    }

    if (priorities.contains(GuardianCarePriority.medication)) {
      addSection(_buildMedicationCard(colors));
    }

    if (priorities.contains(GuardianCarePriority.inactivity)) {
      addSection(
        _buildPriorityInfoCard(
          colors,
          icon: Icons.hourglass_empty_rounded,
          title: 'Inactivity',
          subtitle:
              'Surface unusually long periods without meaningful movement.',
        ),
      );
    }

    if (priorities.contains(GuardianCarePriority.wandering)) {
      addSection(
        _buildPriorityInfoCard(
          colors,
          icon: Icons.directions_walk_rounded,
          title: 'Wandering',
          subtitle:
              'Watch for movement that looks unusual for the personâ€™s routine.',
        ),
      );
    }

    return Column(children: widgets);
  }

  Widget _buildPriorityInfoCard(
    GuardianThemeColors colors, {
    required IconData icon,
    required String title,
    required String subtitle,
  }) {
    return GuardianCard(
      child: _CareSectionHeader(
        icon: icon,
        iconColor: colors.accent,
        iconBackground: colors.accentMuted,
        title: title,
        subtitle: subtitle,
      ),
    );
  }

  Widget _buildWellbeingInfoCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: _CareSectionHeader(
        icon: Icons.favorite_border_rounded,
        iconColor: colors.accent,
        iconBackground: colors.accentMuted,
        title: 'Wellbeing context',
        subtitle:
            'Guardian may use supported watch signals to explain patterns, but never as a medical diagnosis.',
      ),
    );
  }

  Widget _buildFallDetectionCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: GuardianColors.dangerBg,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.emergency_outlined,
                  color: GuardianColors.danger,
                  size: 17,
                ),
              ),
              const SizedBox(width: GuardianSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Fall detection',
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    Text(
                      'Alerts the family if a fall is detected',
                      style: TextStyle(color: colors.textMuted, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
              Switch(
                value: _fallEnabled,
                onChanged: (v) => setState(() => _fallEnabled = v),
              ),
            ],
          ),
          if (_fallEnabled) ...[
            const Divider(height: GuardianSpacing.xl),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text(
                'Auto-dial monitor number on fall',
                style: TextStyle(fontSize: 13.5),
              ),
              value: _dialMonitor,
              onChanged: (v) => setState(() => _dialMonitor = v),
            ),
            const SizedBox(height: GuardianSpacing.sm),
            Row(
              children: [
                Text(
                  'Sensitivity',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
                const Spacer(),
                Text(
                  '${_sensitivity.round()} / 6',
                  style: TextStyle(color: colors.textMuted, fontSize: 12.5),
                ),
              ],
            ),
            Slider(
              value: _sensitivity,
              min: 0,
              max: 6,
              divisions: 6,
              label: '${_sensitivity.round()}',
              onChanged: (v) => setState(() => _sensitivity = v),
            ),
            Text(
              'Lower is more sensitive (more false alarms); higher requires a harder fall to trigger.',
              style: TextStyle(color: colors.textMuted, fontSize: 11),
            ),
          ],
          const SizedBox(height: GuardianSpacing.md),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _savingFall ? null : _saveFallDetection,
              child: _savingFall
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Text('Save'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocationUpdatesCard(GuardianThemeColors colors) {
    const presets = <int>[60, 300, 600, 900];

    String labelFor(int seconds) => switch (seconds) {
      60 => '1 min',
      300 => '5 min',
      600 => '10 min',
      900 => '15 min',
      _ => '${seconds ~/ 60} min',
    };

    final automatic = _locationReportingMode == 'automatic';

    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: colors.accentMuted,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.location_searching_rounded,
                  color: colors.accent,
                  size: 17,
                ),
              ),
              const SizedBox(width: GuardianSpacing.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Location reporting',
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    Text(
                      automatic
                          ? 'Automatic is on. Guardian adapts reporting to battery and safety events.'
                          : 'Manual override is on.',
                      style: TextStyle(color: colors.textMuted, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: GuardianSpacing.md),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment<String>(
                value: 'automatic',
                icon: Icon(Icons.auto_awesome_rounded, size: 16),
                label: Text('Automatic'),
              ),
              ButtonSegment<String>(
                value: 'manual',
                icon: Icon(Icons.tune_rounded, size: 16),
                label: Text('Manual'),
              ),
            ],
            selected: {_locationReportingMode},
            onSelectionChanged: _savingInterval
                ? null
                : (selection) {
                    final mode = selection.first;
                    if (mode == 'automatic') {
                      _enableAutomaticLocationReporting();
                    } else {
                      setState(() => _locationReportingMode = 'manual');
                    }
                  },
          ),
          const SizedBox(height: GuardianSpacing.md),
          if (automatic)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(GuardianSpacing.md),
              decoration: BoxDecoration(
                color: colors.accentMuted,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.battery_charging_full_rounded,
                    color: colors.accent,
                    size: 20,
                  ),
                  const SizedBox(width: GuardianSpacing.sm),
                  Expanded(
                    child: Text(
                      'Currently ${labelFor(_uploadIntervalSeconds)}. '
                      'Battery policy: 60%+ = 1 min, 30-59% = 5 min, '
                      '15-29% = 10 min, below 15% = 15 min. '
                      'During SOS, Guardian temporarily increases reporting '
                      'to 1 min, or 5 min if the battery is critically low.',
                      style: TextStyle(
                        color: colors.textSecondary,
                        fontSize: 11.5,
                        height: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
            )
          else ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final seconds in presets)
                  ChoiceChip(
                    selected: _uploadIntervalSeconds == seconds,
                    label: Text(labelFor(seconds)),
                    onSelected: _savingInterval
                        ? null
                        : (_) {
                            setState(() => _uploadIntervalSeconds = seconds);
                          },
                  ),
              ],
            ),
            const SizedBox(height: GuardianSpacing.md),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(
                onPressed: _savingInterval ? null : _saveUploadInterval,
                child: _savingInterval
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Save manual interval'),
              ),
            ),
          ],
          const SizedBox(height: GuardianSpacing.sm),
          Text(
            'Reporting frequency controls how often the watch is asked to send '
            'updates. It does not change GPS A/V interpretation and does not '
            'guarantee a satellite GPS fix.',
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 11,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMedicationCard(GuardianThemeColors colors) {
    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: GuardianColors.warningBg,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.medication_outlined,
                  color: GuardianColors.warning,
                  size: 17,
                ),
              ),
              const SizedBox(width: GuardianSpacing.sm),
              Expanded(
                child: Text(
                  'Medication reminders',
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontWeight: FontWeight.w700,
                    fontSize: 15,
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.add_circle_outline),
                tooltip: 'Add reminder',
                onPressed: _showAddReminderDialog,
              ),
            ],
          ),
          const SizedBox(height: GuardianSpacing.sm),
          StreamBuilder<List<MedicationReminder>>(
            stream: MedicationReminderService().watchForDevice(
              widget.device.imei,
            ),
            builder: (context, snapshot) {
              final reminders = snapshot.data ?? const <MedicationReminder>[];
              if (!snapshot.hasData) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (reminders.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Text(
                    'No reminders yet. Tap + to add one.',
                    style: TextStyle(color: colors.textMuted, fontSize: 12.5),
                  ),
                );
              }
              return Column(
                children: [
                  for (final reminder in reminders)
                    _ReminderTile(
                      reminder: reminder,
                      onToggle: (enabled) => MedicationReminderService()
                          .setEnabled(reminder, enabled),
                      onDelete: () => MedicationReminderService().delete(
                        reminder.id,
                        imei: reminder.imei,
                      ),
                    ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _ReminderTile extends StatelessWidget {
  const _ReminderTile({
    required this.reminder,
    required this.onToggle,
    required this.onDelete,
  });

  final MedicationReminder reminder;
  final ValueChanged<bool> onToggle;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          SizedBox(
            width: 52,
            child: Text(
              reminder.time,
              style: TextStyle(
                color: colors.textPrimary,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  reminder.text,
                  style: TextStyle(color: colors.textPrimary, fontSize: 13),
                ),
                Text(
                  reminder.frequencyLabel,
                  style: TextStyle(color: colors.textMuted, fontSize: 11),
                ),
              ],
            ),
          ),
          Switch(value: reminder.enabled, onChanged: onToggle),
          IconButton(
            icon: const Icon(Icons.delete_outline, size: 19),
            tooltip: 'Delete reminder',
            onPressed: onDelete,
          ),
        ],
      ),
    );
  }
}

class _CareSectionHeader extends StatelessWidget {
  const _CareSectionHeader({
    required this.icon,
    required this.iconColor,
    required this.iconBackground,
    required this.title,
    required this.subtitle,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBackground;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: iconBackground,
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: iconColor, size: 17),
        ),
        const SizedBox(width: GuardianSpacing.sm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: TextStyle(
                  color: colors.textPrimary,
                  fontWeight: FontWeight.w700,
                  fontSize: 15,
                ),
              ),
              Text(
                subtitle,
                style: TextStyle(
                  color: colors.textMuted,
                  fontSize: 11.5,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _AddReminderDialog extends StatefulWidget {
  const _AddReminderDialog({required this.imei});

  final String imei;

  @override
  State<_AddReminderDialog> createState() => _AddReminderDialogState();
}

class _AddReminderDialogState extends State<_AddReminderDialog> {
  TimeOfDay _time = const TimeOfDay(hour: 8, minute: 0);
  int _frequency = 2;
  final Set<int> _weekDays = {}; // 0=Sun .. 6=Sat
  final _textCtrl = TextEditingController();
  bool _saving = false;

  static const _dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  @override
  void dispose() {
    _textCtrl.dispose();
    super.dispose();
  }

  String get _timeLabel {
    final h = _time.hour.toString().padLeft(2, '0');
    final m = _time.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  String get _weekMask {
    return List.generate(7, (i) => _weekDays.contains(i) ? '1' : '0').join();
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(context: context, initialTime: _time);
    if (picked != null) setState(() => _time = picked);
  }

  Future<void> _save() async {
    if (_textCtrl.text.trim().isEmpty) return;
    if (_frequency == 3 && _weekDays.isEmpty) return;

    setState(() => _saving = true);
    try {
      await MedicationReminderService().create(
        imei: widget.imei,
        time: _timeLabel,
        frequency: _frequency,
        text: _textCtrl.text,
        week: _frequency == 3 ? _weekMask : null,
      );
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Could not reach watch: $e')));
        setState(() => _saving = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Add medication reminder'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _textCtrl,
              decoration: const InputDecoration(
                labelText: 'Reminder text',
                hintText: 'e.g. Blood pressure tablets',
              ),
            ),
            const SizedBox(height: GuardianSpacing.md),
            Row(
              children: [
                const Text('Time'),
                const Spacer(),
                TextButton(onPressed: _pickTime, child: Text(_timeLabel)),
              ],
            ),
            const SizedBox(height: GuardianSpacing.sm),
            SegmentedButton<int>(
              segments: const [
                ButtonSegment(value: 1, label: Text('Once')),
                ButtonSegment(value: 2, label: Text('Daily')),
                ButtonSegment(value: 3, label: Text('Weekly')),
              ],
              selected: {_frequency},
              onSelectionChanged: (s) => setState(() => _frequency = s.first),
            ),
            if (_frequency == 3) ...[
              const SizedBox(height: GuardianSpacing.sm),
              Wrap(
                spacing: 6,
                children: [
                  for (var i = 0; i < 7; i++)
                    FilterChip(
                      label: Text(_dayLabels[i]),
                      selected: _weekDays.contains(i),
                      onSelected: (sel) => setState(() {
                        if (sel) {
                          _weekDays.add(i);
                        } else {
                          _weekDays.remove(i);
                        }
                      }),
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _saving ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _saving ? null : _save,
          child: _saving
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('Save'),
        ),
      ],
    );
  }
}
