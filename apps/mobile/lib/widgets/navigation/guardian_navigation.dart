import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../main.dart';
import '../../theme/app_theme.dart';
import '../brand/dodo_ai_icon.dart';
import '../theme/theme_picker.dart';

typedef GuardianDestination = ({IconData icon, String label});

List<GuardianDestination> guardianDestinations(BuildContext context) {
  final t = AppLocalizations.of(context)!;
  return [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.map_outlined, label: t.navSafeZones),
    (icon: Icons.notifications_none_rounded, label: t.navAlerts),
    (icon: Icons.person_outline_rounded, label: t.navAccount),
  ];
}

class GuardianBrand extends StatelessWidget {
  const GuardianBrand({super.key, this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        GuardianBrandMark(size: compact ? 34 : 38),
        if (!compact) ...[
          const SizedBox(width: 10),
          Text('Guardian', style: Theme.of(context).textTheme.titleLarge),
        ],
      ],
    );
  }
}

class DesktopSidebar extends StatefulWidget {
  const DesktopSidebar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  State<DesktopSidebar> createState() => _DesktopSidebarState();
}

class _DesktopSidebarState extends State<DesktopSidebar> {
  bool _themeExpanded = false;

  void _toggleThemeSection() {
    setState(() => _themeExpanded = !_themeExpanded);
  }

  void _selectTheme(GuardianThemeId theme) {
    GuardianApp.setTheme(context, theme);
    setState(() => _themeExpanded = false);
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final items = guardianDestinations(context);
    final currentTheme =
        GuardianApp.themeOf(context) ?? GuardianThemeId.defaultTheme;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          width: 84,
          decoration: BoxDecoration(
            color: colors.sidebar,
            border: Border(
              right: BorderSide(
                color: _themeExpanded ? Colors.transparent : colors.border,
              ),
            ),
          ),
          child: SafeArea(
            child: Column(
              children: [
                const Padding(
                  padding: EdgeInsets.only(top: 16, bottom: 18),
                  child: GuardianBrand(compact: true),
                ),
                for (var index = 0; index < items.length; index++)
                  _SidebarItem(
                    item: items[index],
                    selected: widget.currentIndex == index,
                    onTap: () => widget.onTap(index),
                  ),
                _SidebarThemeToggle(
                  expanded: _themeExpanded,
                  onTap: _toggleThemeSection,
                ),
                const Spacer(),
                const Padding(
                  padding: EdgeInsets.only(bottom: 18),
                  child: _SidebarItem(
                    item: (icon: Icons.help_outline_rounded, label: 'Help'),
                    selected: false,
                  ),
                ),
              ],
            ),
          ),
        ),
        if (_themeExpanded)
          Material(
            elevation: 8,
            color: colors.sidebar,
            child: Container(
              width: 196,
              decoration: BoxDecoration(
                border: Border(
                  right: BorderSide(color: colors.border),
                  left: BorderSide(color: colors.border),
                ),
              ),
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 16, 10, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        'Theme',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: colors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ThemePickerList(
                        selected: currentTheme,
                        dense: true,
                        onSelected: _selectTheme,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _SidebarThemeToggle extends StatelessWidget {
  const _SidebarThemeToggle({
    required this.expanded,
    required this.onTap,
  });

  final bool expanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final color = expanded ? colors.accent : colors.textSecondary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: Material(
        color: expanded ? colors.accentMuted : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            width: 68,
            height: 64,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.palette_outlined, size: 22, color: color),
                const SizedBox(height: 5),
                Text(
                  'Theme',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 9,
                    color: color,
                    fontWeight: expanded ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SidebarItem extends StatelessWidget {
  const _SidebarItem({
    required this.item,
    required this.selected,
    this.onTap,
  });

  final GuardianDestination item;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final color = selected ? colors.accent : colors.textSecondary;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      child: Material(
        color: selected ? colors.accentMuted : Colors.transparent,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: SizedBox(
            width: 68,
            height: 64,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(item.icon, size: 22, color: color),
                const SizedBox(height: 5),
                Text(
                  item.label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 9,
                    color: color,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class MobileBottomBar extends StatelessWidget {
  const MobileBottomBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final items = guardianDestinations(context);
    return Container(
      decoration: BoxDecoration(
        color: colors.glass,
        border: Border(top: BorderSide(color: colors.border)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, -8),
          ),
        ],
      ),
      padding: const EdgeInsets.fromLTRB(10, 8, 10, 7),
      child: SafeArea(
        top: false,
        child: Row(
          children: List.generate(items.length, (index) {
            final active = currentIndex == index;
            final color = active ? colors.accent : colors.textMuted;
            return Expanded(
              child: InkWell(
                onTap: () => onTap(index),
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(items[index].icon, size: 22, color: color),
                      const SizedBox(height: 3),
                      Text(
                        items[index].label,
                        style: TextStyle(
                          fontSize: 9,
                          color: color,
                          fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }
}
