import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

import '../models/device.dart';
import '../models/geofence.dart';
import '../safe_zones/safe_zone_logic.dart';
import '../theme/app_theme.dart';
import '../widgets/cards/guardian_surface.dart';
import '../widgets/layout/guardian_page_frame.dart';
import '../widgets/safe_zones/safe_zone_map.dart';
import 'location_picker_page.dart';

/// A draft stays on this route until creation succeeds. The enclosing shell
/// retains navigation; this scaffold alone handles the keyboard inset.
class SafeZoneEditorPage extends StatefulWidget {
  const SafeZoneEditorPage({
    super.key,
    required this.devices,
    required this.onCreate,
    this.mapBuilder,
    this.pickerBuilder,
  }) : assert(devices.length > 0);

  final List<Device> devices;
  final Future<void> Function(Geofence zone) onCreate;
  final Widget Function(BuildContext context, Geofence zone)? mapBuilder;
  final Widget Function(LatLng centre, double radius, Color color)?
  pickerBuilder;

  @override
  State<SafeZoneEditorPage> createState() => _SafeZoneEditorPageState();
}

class _SafeZoneEditorPageState extends State<SafeZoneEditorPage> {
  final _name = TextEditingController(text: 'Home');
  final _radius = TextEditingController(text: '150');
  final _nameKey = GlobalKey<FormFieldState<String>>();
  final _radiusKey = GlobalKey<FormFieldState<String>>();
  final _boundaryKey = GlobalKey();
  late String _imei = widget.devices.first.imei;
  LatLng? _centre;
  bool _saving = false;
  bool _locationMissing = false;
  String? _error;

  Device get _device => widget.devices.firstWhere((d) => d.imei == _imei);
  double? get _validRadius {
    final value = double.tryParse(_radius.text.trim());
    return value != null && value.isFinite && value >= 50 && value <= 5000
        ? value
        : null;
  }

  LatLng get _startingPoint {
    final loc = _device.location;
    if (loc != null &&
        loc.lat.isFinite &&
        loc.lng.isFinite &&
        loc.lat.abs() <= 90 &&
        loc.lng.abs() <= 180 &&
        loc.isValid) {
      return LatLng(loc.lat, loc.lng);
    }
    return const LatLng(-20.2642, 57.4791);
  }

  Geofence get _preview => Geofence(
    id: 'safe-zone-draft',
    imei: _imei,
    name: _name.text.trim(),
    active: true,
    lat: (_centre ?? _startingPoint).latitude,
    lng: (_centre ?? _startingPoint).longitude,
    radiusMeters: _validRadius ?? 150,
  );

  @override
  void dispose() {
    _name.dispose();
    _radius.dispose();
    super.dispose();
  }

  Future<void> _pickCentre() async {
    FocusManager.instance.primaryFocus?.unfocus();
    // Commit the focus change before the navigator remembers this route's
    // focused field, otherwise returning from the map reopens the keyboard.
    FocusManager.instance.applyFocusChangesIfNeeded();
    final preview = _preview;
    final colour = styleForCategory(categoryFromZoneName(preview.name)).color;
    final initial = LatLng(preview.lat, preview.lng);
    final picked = await Navigator.of(context).push<LatLng>(
      MaterialPageRoute(
        builder: (_) =>
            widget.pickerBuilder?.call(initial, preview.radiusMeters, colour) ??
            LocationPickerPage(
              initialCenter: initial,
              radiusMeters: preview.radiusMeters,
              zoneColor: colour,
            ),
      ),
    );
    if (!mounted) return;
    FocusManager.instance.primaryFocus?.unfocus();
    if (picked == null) return;
    setState(() {
      _centre = picked;
      _locationMissing = false;
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    final nameValid = _nameKey.currentState!.validate();
    final radiusValid = _radiusKey.currentState!.validate();
    if (!nameValid || !radiusValid) {
      await Scrollable.ensureVisible(
        (!nameValid ? _nameKey : _radiusKey).currentContext!,
        duration: const Duration(milliseconds: 200),
        alignment: 0.2,
      );
      return;
    }
    if (_centre == null) {
      setState(() => _locationMissing = true);
      await Scrollable.ensureVisible(
        _boundaryKey.currentContext!,
        duration: const Duration(milliseconds: 200),
      );
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();
    final draft = _preview;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onCreate(draft);
      if (!mounted) return;
      setState(() => _saving = false);
      Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error =
              'Could not save this zone. Your details are kept. Please try again.';
        });
      }
    }
  }

  Widget _sectionTitle(IconData icon, String title) => Row(
    children: [
      Icon(icon, color: context.guardianColors.accent, size: 22),
      const SizedBox(width: 10),
      Expanded(
        child: Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
        ),
      ),
    ],
  );

  Widget _placeCard() => GuardianSurface(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionTitle(Icons.home_outlined, 'A familiar place'),
        const SizedBox(height: 20),
        if (widget.devices.length == 1)
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: context.guardianColors.accentMuted,
              borderRadius: BorderRadius.circular(14),
            ),
            child: Row(
              children: [
                const Icon(Icons.person_outline_rounded),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'For ${_device.displayName}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          )
        else
          DropdownButtonFormField<String>(
            initialValue: _imei,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Who is this zone for?',
            ),
            items: [
              for (final device in widget.devices)
                DropdownMenuItem(
                  value: device.imei,
                  child: Text(device.displayName),
                ),
            ],
            onChanged: _saving
                ? null
                : (value) {
                    if (value != null) {
                      setState(() {
                        _imei = value;
                      });
                    }
                  },
          ),
        const SizedBox(height: 20),
        TextFormField(
          key: _nameKey,
          controller: _name,
          enabled: !_saving,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(
            labelText: 'Place name',
            hintText: 'e.g. Grand-mère’s house',
          ),
          validator: (value) => value == null || value.trim().isEmpty
              ? 'Give this place a name.'
              : null,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final name in ['Home', 'School', 'Grand-mère’s'])
              ChoiceChip(
                label: Text(name),
                selected: _name.text == name,
                onSelected: _saving
                    ? null
                    : (_) => setState(() => _name.text = name),
              ),
          ],
        ),
        const SizedBox(height: 12),
        Text(
          'Choose a name your family will recognise in alerts.',
          style: TextStyle(color: context.guardianColors.textSecondary),
        ),
      ],
    ),
  );

  Widget _boundaryCard() => GuardianSurface(
    key: _boundaryKey,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _sectionTitle(Icons.radar_rounded, 'Set the boundary'),
        const SizedBox(height: 12),
        Text(
          _centre == null
              ? 'Choose the exact centre, then set how far the zone extends around it.'
              : 'The circle shows the area around your chosen centre.',
          style: TextStyle(color: context.guardianColors.textSecondary),
        ),
        const SizedBox(height: 16),
        if (_centre != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(16),
            child: SizedBox(
              height: 180,
              child:
                  widget.mapBuilder?.call(context, _preview) ??
                  SafeZoneMap(zone: _preview),
            ),
          ),
          const SizedBox(height: 12),
        ],
        OutlinedButton.icon(
          onPressed: _saving ? null : _pickCentre,
          icon: Icon(
            _centre == null
                ? Icons.add_location_alt_outlined
                : Icons.edit_location_alt_outlined,
          ),
          label: Text(_centre == null ? 'Choose on map' : 'Adjust location'),
        ),
        if (_locationMissing) ...[
          const SizedBox(height: 8),
          Text(
            'Choose a centre on the map before saving.',
            style: TextStyle(color: Theme.of(context).colorScheme.error),
          ),
        ],
        const SizedBox(height: 20),
        TextFormField(
          key: _radiusKey,
          controller: _radius,
          enabled: !_saving,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          textInputAction: TextInputAction.done,
          decoration: const InputDecoration(
            labelText: 'Radius',
            suffixText: 'metres',
            helperText: 'Distance from the centre · 50–5,000 metres',
            helperMaxLines: 2,
          ),
          validator: (_) => _validRadius == null
              ? 'Enter a radius from 50 to 5,000 metres.'
              : null,
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 4,
          children: [
            for (final radius in [100, 150, 300])
              ChoiceChip(
                label: Text('$radius m'),
                selected: _validRadius == radius,
                onSelected: _saving
                    ? null
                    : (_) => setState(() => _radius.text = '$radius'),
              ),
          ],
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_saving,
    child: Scaffold(
      backgroundColor: context.guardianColors.canvas,
      appBar: AppBar(title: const Text('Add safe zone')),
      body: GuardianPageFrame(
        maxWidth: 1000,
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                keyboardDismissBehavior:
                    ScrollViewKeyboardDismissBehavior.onDrag,
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Home, school or somewhere they know well.',
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: context.guardianColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: 20),
                    LayoutBuilder(
                      builder: (context, constraints) {
                        if (constraints.maxWidth >= 760) {
                          return Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: _placeCard()),
                              const SizedBox(width: 20),
                              Expanded(child: _boundaryCard()),
                            ],
                          );
                        }
                        return Column(
                          children: [
                            _placeCard(),
                            const SizedBox(height: 16),
                            _boundaryCard(),
                          ],
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
            Material(
              color: context.guardianColors.surface,
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      if (_error != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(
                            _error!,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                        ),
                      FilledButton.icon(
                        onPressed: _saving ? null : _save,
                        icon: _saving
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.check_rounded),
                        label: Text(_saving ? 'Saving…' : 'Create safe zone'),
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
}
