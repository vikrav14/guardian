import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../theme/guardian_appearance.dart';
import '../../theme/guardian_theme_scope.dart';
import '../theme/theme_picker.dart';

enum GuardianMenuDestination {
  home('Home', Icons.home_outlined, 0),
  zones('Safe zones', Icons.shield_outlined, 1),
  alerts('Alerts', Icons.notifications_none_outlined, 4),
  account('Account & family', Icons.people_outline, 5),
  journey('Journey', Icons.route_outlined, null),
  wellness('Wellness', Icons.favorite_border, null),
  watch('Watch settings', Icons.watch_outlined, 3),
  preferences('Safety & preferences', Icons.tune_outlined, null),
  wifi('Home Wi-Fi', Icons.wifi_outlined, null),
  contacts('Emergency contacts', Icons.contact_phone_outlined, null);

  const GuardianMenuDestination(this.label, this.icon, this.tab);
  final String label;
  final IconData icon;
  final int? tab;

  String get routeName => '/$name';

  static GuardianMenuDestination forTab(int index) => switch (index) {
    1 => zones,
    2 || 5 => account,
    3 => watch,
    4 => alerts,
    _ => home,
  };
}

/// The same destinations in the full sidebar and the compact phone rail.
/// Expanding the phone menu uses a drawer, preserving the page's width/state.
class GuardianSideMenu extends StatelessWidget {
  const GuardianSideMenu({
    super.key,
    required this.selected,
    required this.onSelected,
    this.watchName,
    this.collapsed = false,
    this.onToggle,
  });

  final GuardianMenuDestination selected;
  final ValueChanged<GuardianMenuDestination> onSelected;
  final String? watchName;
  final bool collapsed;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final scope = GuardianThemeScope.maybeOf(context);
    final scene = Theme.of(context).extension<GuardianSceneTheme>();
    final theme = scope?.themeId ?? GuardianThemeId.defaultTheme;
    return SizedBox(
      width: collapsed ? 56 : 204,
      child: Material(
        color: colors.surface,
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(right: BorderSide(color: colors.border)),
          ),
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (scene != null && scene.enabled && !colors.highContrast)
                ExcludeSemantics(
                  child: IgnorePointer(
                    child: Opacity(
                      opacity: .055,
                      child: Image.asset(scene.asset, fit: BoxFit.cover),
                    ),
                  ),
                ),
              SafeArea(
                top: false,
                right: false,
                child: ListView(
                  padding: EdgeInsets.symmetric(
                    horizontal: collapsed ? 4 : 12,
                    vertical: collapsed ? 8 : 22,
                  ),
                  children: [
                    if (onToggle != null) ...[
                      Align(
                        alignment: collapsed
                            ? Alignment.center
                            : Alignment.centerRight,
                        child: IconButton(
                          tooltip: collapsed ? 'Expand menu' : 'Collapse menu',
                          onPressed: onToggle,
                          icon: Icon(
                            collapsed ? Icons.menu : Icons.menu_open,
                            size: 22,
                          ),
                          color: colors.accent,
                          constraints: const BoxConstraints.tightFor(
                            width: 48,
                            height: 48,
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),
                    ],
                    for (final destination
                        in GuardianMenuDestination.values.where(
                          (item) => item != GuardianMenuDestination.alerts,
                        )) ...[
                      if (destination == GuardianMenuDestination.journey)
                        collapsed
                            ? Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 10,
                                ),
                                child: Divider(color: colors.border, height: 1),
                              )
                            : Padding(
                                padding: const EdgeInsets.fromLTRB(
                                  12,
                                  22,
                                  8,
                                  12,
                                ),
                                child: Text(
                                  watchName == null
                                      ? 'YOUR WATCH'
                                      : "${watchName!.toUpperCase()}'S WATCH",
                                  style: TextStyle(
                                    color: colors.accent,
                                    fontSize: 10,
                                    letterSpacing: 1.2,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: _MenuItem(
                          destination: destination,
                          collapsed: collapsed,
                          selected: destination == selected,
                          onTap: () => onSelected(destination),
                        ),
                      ),
                    ],
                    const SizedBox(height: 24),
                    if (collapsed)
                      IconButton(
                        tooltip: 'Island theme',
                        icon: const Icon(Icons.palette_outlined, size: 22),
                        onPressed: () => showThemePickerDialog(context),
                        constraints: const BoxConstraints.tightFor(
                          width: 48,
                          height: 48,
                        ),
                      )
                    else ...[
                      Divider(color: colors.border),
                      TextButton(
                        onPressed: () => showThemePickerDialog(context),
                        child: Align(
                          alignment: Alignment.centerLeft,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(theme.displayName),
                              const SizedBox(height: 4),
                              Text(
                                theme.description,
                                style: TextStyle(
                                  fontSize: 11,
                                  color: colors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      if (scope?.onAppearanceChanged != null)
                        SwitchListTile.adaptive(
                          contentPadding: const EdgeInsets.only(left: 10),
                          title: const Text(
                            'Scenic background',
                            style: TextStyle(fontSize: 12),
                          ),
                          value: scope!.appearance.scenery,
                          onChanged: (value) => scope.onAppearanceChanged!(
                            scope.appearance.copyWith(scenery: value),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({
    required this.destination,
    required this.collapsed,
    required this.selected,
    required this.onTap,
  });
  final GuardianMenuDestination destination;
  final bool collapsed, selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final color = selected ? colors.accent : colors.textSecondary;
    final button = Semantics(
      label: destination.label,
      selected: selected,
      button: true,
      onTap: onTap,
      child: ExcludeSemantics(
        child: Material(
          color: selected ? colors.accentMuted : Colors.transparent,
          borderRadius: BorderRadius.circular(11),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(11),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Padding(
                padding: EdgeInsets.symmetric(
                  horizontal: collapsed ? 0 : 12,
                  vertical: 10,
                ),
                child: Row(
                  mainAxisAlignment: collapsed
                      ? MainAxisAlignment.center
                      : MainAxisAlignment.start,
                  children: [
                    Icon(destination.icon, size: 21, color: color),
                    if (!collapsed) ...[
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          destination.label,
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.5,
                            color: color,
                            fontWeight: selected
                                ? FontWeight.w600
                                : FontWeight.w400,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
    return collapsed
        ? Tooltip(
            message: destination.label,
            excludeFromSemantics: true,
            child: button,
          )
        : button;
  }
}
