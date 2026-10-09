import 'package:flutter/material.dart';

import '../services/theme_service.dart';
import 'app_theme.dart';
import 'guardian_appearance.dart';

class GuardianThemeScope extends InheritedWidget {
  const GuardianThemeScope({
    super.key,
    required this.themeId,
    required this.onThemeChanged,
    required super.child,
    this.appearance = const GuardianAppearance(),
    this.onAppearanceChanged,
  });

  final GuardianThemeId themeId;
  final ValueChanged<GuardianThemeId> onThemeChanged;
  final GuardianAppearance appearance;
  final ValueChanged<GuardianAppearance>? onAppearanceChanged;

  static GuardianThemeScope? maybeOf(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<GuardianThemeScope>();

  void setTheme(GuardianThemeId theme) {
    if (themeId != theme) onThemeChanged(theme);
  }

  @override
  bool updateShouldNotify(GuardianThemeScope oldWidget) =>
      themeId != oldWidget.themeId || appearance != oldWidget.appearance;
}

/// Lives above MaterialApp so pushed routes and dialogs share the palette.
/// Rebuilding the same MaterialApp preserves its Navigator and route state.
class GuardianAppearanceHost extends StatefulWidget {
  const GuardianAppearanceHost({super.key, required this.builder});

  final Widget Function(BuildContext context, GuardianAppearance appearance)
  builder;

  @override
  State<GuardianAppearanceHost> createState() => _GuardianAppearanceHostState();
}

class _GuardianAppearanceHostState extends State<GuardianAppearanceHost> {
  GuardianAppearance _appearance = const GuardianAppearance();
  bool _edited = false;
  Future<void> _saving = Future<void>.value();

  @override
  void initState() {
    super.initState();
    ThemeService.loadAppearance().then((saved) {
      if (mounted && !_edited) setState(() => _appearance = saved);
    });
  }

  void _setAppearance(GuardianAppearance next) {
    setState(() {
      _edited = true;
      _appearance = next;
    });
    // Serialize writes so a rapid palette change cannot save an older choice.
    _saving = _saving
        .then((_) => ThemeService.saveAppearance(next))
        .catchError(
          (Object error) =>
              debugPrint('Appearance preference could not be saved: $error'),
        );
  }

  @override
  Widget build(BuildContext context) => GuardianThemeScope(
    themeId: _appearance.themeId,
    appearance: _appearance,
    onThemeChanged: (theme) =>
        _setAppearance(_appearance.copyWith(themeId: theme)),
    onAppearanceChanged: _setAppearance,
    child: Builder(builder: (context) => widget.builder(context, _appearance)),
  );
}
