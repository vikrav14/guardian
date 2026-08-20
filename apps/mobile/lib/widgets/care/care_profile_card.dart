import 'package:flutter/material.dart';

import '../../models/care_profile.dart';
import '../../models/device.dart';
import '../../services/guardian_services.dart';
import '../../theme/app_theme.dart';
import '../cards/guardian_card.dart';

class CareProfileCard extends StatelessWidget {
  const CareProfileCard({
    super.key,
    required this.device,
    required this.subscription,
    this.onChanged,
  });

  final Device device;
  final GuardianSubscription subscription;
  final void Function(GuardianCareProfile profile, Set<String> priorities)?
  onChanged;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Device?>(
      stream: DeviceService().watchDevice(device.imei),
      initialData: device,
      builder: (context, snapshot) {
        final latest = snapshot.data ?? device;
        return _CareProfileEditor(
          device: latest,
          subscription: subscription,
          onChanged: onChanged,
        );
      },
    );
  }
}

class _CareProfileEditor extends StatefulWidget {
  const _CareProfileEditor({
    required this.device,
    required this.subscription,
    this.onChanged,
  });

  final Device device;
  final GuardianSubscription subscription;
  final void Function(GuardianCareProfile profile, Set<String> priorities)?
  onChanged;

  @override
  State<_CareProfileEditor> createState() => _CareProfileEditorState();
}

class _CareProfileEditorState extends State<_CareProfileEditor> {
  late GuardianCareProfile _profile;
  late Set<String> _priorities;
  bool _saving = false;
  bool _dirty = false;

  @override
  void initState() {
    super.initState();
    _hydrateFromDevice();
  }

  void _hydrateFromDevice() {
    _profile = GuardianCareProfileX.fromValue(widget.device.careProfile);
    final saved = widget.device.carePriorities;
    _priorities = {
      ...(saved.isEmpty ? GuardianCarePriority.defaultsFor(_profile) : saved),
    };
    _notifyParent();
  }

  void _notifyParent() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      widget.onChanged?.call(_profile, {..._priorities});
    });
  }

  @override
  void didUpdateWidget(covariant _CareProfileEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!_dirty &&
        (oldWidget.device.careProfile != widget.device.careProfile ||
            !_samePriorities(
              oldWidget.device.carePriorities,
              widget.device.carePriorities,
            ))) {
      setState(_hydrateFromDevice);
    }
  }

  bool _samePriorities(List<String> a, List<String> b) {
    if (a.length != b.length) return false;
    final left = {...a};
    final right = {...b};
    return left.length == right.length && left.containsAll(right);
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await DeviceService().updateCareProfile(
        widget.device.imei,
        subscription: widget.subscription,
        careProfile: _profile.firestoreValue,
        carePriorities: _priorities.toList(growable: false),
      );
      if (!mounted) return;
      setState(() => _dirty = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Care profile updated')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not update care profile: $error')),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _changeProfile(GuardianCareProfile profile) {
    setState(() {
      _profile = profile;
      _priorities = {...GuardianCarePriority.defaultsFor(profile)};
      _dirty = true;
      widget.onChanged?.call(_profile, {..._priorities});
    });
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final available = switch (_profile) {
      GuardianCareProfile.child => const [
        GuardianCarePriority.safeZones,
        GuardianCarePriority.journeys,
        GuardianCarePriority.unusualStops,
        GuardianCarePriority.wellbeing,
      ],
      GuardianCareProfile.senior => const [
        GuardianCarePriority.falls,
        GuardianCarePriority.medication,
        GuardianCarePriority.wellbeing,
        GuardianCarePriority.inactivity,
        GuardianCarePriority.wandering,
        GuardianCarePriority.safeZones,
      ],
      GuardianCareProfile.adult => const [
        GuardianCarePriority.safeZones,
        GuardianCarePriority.journeys,
        GuardianCarePriority.wellbeing,
        GuardianCarePriority.falls,
      ],
    };

    return GuardianCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: colors.accentMuted,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  Icons.person_rounded,
                  size: 18,
                  color: colors.accent,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Care profile',
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontWeight: FontWeight.w700,
                        fontSize: 15,
                      ),
                    ),
                    Text(
                      'Guardian adapts what it watches and explains.',
                      style: TextStyle(color: colors.textMuted, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final profile in GuardianCareProfile.values)
                ChoiceChip(
                  selected: profile == _profile,
                  avatar: Icon(profile.icon, size: 16),
                  label: Text(profile.label),
                  onSelected: (_) => _changeProfile(profile),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            _profile.description,
            style: TextStyle(
              color: colors.textSecondary,
              fontSize: 12,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'CARE PRIORITIES',
            style: TextStyle(
              color: colors.textMuted,
              fontSize: 10,
              fontWeight: FontWeight.w800,
              letterSpacing: 1,
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final priority in available)
                FilterChip(
                  selected: _priorities.contains(priority),
                  label: Text(GuardianCarePriority.label(priority)),
                  onSelected: (selected) {
                    setState(() {
                      if (selected) {
                        _priorities.add(priority);
                      } else {
                        _priorities.remove(priority);
                      }
                      _dirty = true;
                      widget.onChanged?.call(_profile, {..._priorities});
                    });
                  },
                ),
            ],
          ),
          const SizedBox(height: 16),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.icon(
              onPressed: _saving ? null : _save,
              icon: _saving
                  ? const SizedBox(
                      width: 15,
                      height: 15,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.check_rounded, size: 17),
              label: Text(_saving ? 'Saving...' : 'Save care profile'),
            ),
          ),
        ],
      ),
    );
  }
}
