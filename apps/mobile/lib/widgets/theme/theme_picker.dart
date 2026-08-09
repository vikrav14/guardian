import 'package:flutter/material.dart';

import '../../main.dart';
import '../../theme/app_theme.dart';

/// Sidebar scenic overlay — unselected labels on the theme flyout.
const _darkSurfaceLabel = Color(0xB3FFFFFF);
const _darkSurfaceLabelHover = Colors.white;

class ThemePickerList extends StatelessWidget {
  const ThemePickerList({
    super.key,
    required this.selected,
    required this.onSelected,
    this.dense = false,
    this.onDarkSurface = false,
  });

  final GuardianThemeId selected;
  final ValueChanged<GuardianThemeId> onSelected;
  final bool dense;
  final bool onDarkSurface;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final theme in GuardianThemeId.allThemes)
          ThemePickerTile(
            theme: theme,
            selected: theme == selected,
            dense: dense,
            onDarkSurface: onDarkSurface,
            onTap: () => onSelected(theme),
          ),
      ],
    );
  }
}

class ThemePickerTile extends StatefulWidget {
  const ThemePickerTile({
    super.key,
    required this.theme,
    required this.selected,
    required this.onTap,
    this.dense = false,
    this.onDarkSurface = false,
  });

  final GuardianThemeId theme;
  final bool selected;
  final VoidCallback onTap;
  final bool dense;
  final bool onDarkSurface;

  @override
  State<ThemePickerTile> createState() => _ThemePickerTileState();
}

class _ThemePickerTileState extends State<ThemePickerTile> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final accent = widget.selected ? colors.accent : colors.textSecondary;
    final labelColor = widget.selected
        ? GuardianColors.safeText
        : widget.onDarkSurface
        ? (_hovered ? _darkSurfaceLabelHover : _darkSurfaceLabel)
        : colors.textPrimary;
    return MouseRegion(
      onEnter: widget.onDarkSurface && !widget.selected
          ? (_) => setState(() => _hovered = true)
          : null,
      onExit: widget.onDarkSurface && !widget.selected
          ? (_) => setState(() => _hovered = false)
          : null,
      child: Material(
        color: widget.selected ? colors.accentMuted : Colors.transparent,
        borderRadius: BorderRadius.circular(widget.dense ? 10 : 12),
        child: InkWell(
          onTap: widget.onTap,
          hoverColor: widget.onDarkSurface && !widget.selected
              ? Colors.white.withValues(alpha: 0.08)
              : null,
          borderRadius: BorderRadius.circular(widget.dense ? 10 : 12),
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: widget.dense ? 10 : 14,
              vertical: widget.dense ? 8 : 12,
            ),
            child: Row(
              children: [
                if (widget.selected)
                  Icon(Icons.check, size: widget.dense ? 16 : 18, color: accent)
                else
                  SizedBox(width: widget.dense ? 16 : 18),
                SizedBox(width: widget.dense ? 6 : 8),
                Expanded(
                  child: Text(
                    widget.theme.displayName,
                    style: TextStyle(
                      fontSize: widget.dense ? 11 : 13,
                      fontWeight: widget.selected
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: labelColor,
                    ),
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

Future<void> showThemePickerDialog(BuildContext context) async {
  final themeScope = GuardianThemeScope.maybeOf(context);
  final current = themeScope?.themeId ?? GuardianThemeId.defaultTheme;
  await showDialog<void>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Theme'),
      content: ThemePickerList(
        selected: current,
        onSelected: (theme) {
          themeScope?.setTheme(theme);
          Navigator.pop(ctx);
        },
      ),
    ),
  );
}
