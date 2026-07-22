import 'package:flutter/material.dart';

import '../../main.dart';
import '../../theme/app_theme.dart';
class ThemePickerList extends StatelessWidget {
  const ThemePickerList({
    super.key,
    required this.selected,
    required this.onSelected,
    this.dense = false,
  });

  final GuardianThemeId selected;
  final ValueChanged<GuardianThemeId> onSelected;
  final bool dense;

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
            onTap: () => onSelected(theme),
          ),
      ],
    );
  }
}

class ThemePickerTile extends StatelessWidget {
  const ThemePickerTile({
    super.key,
    required this.theme,
    required this.selected,
    required this.onTap,
    this.dense = false,
  });

  final GuardianThemeId theme;
  final bool selected;
  final VoidCallback onTap;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final accent = selected ? colors.accent : colors.textSecondary;
    return Material(
      color: selected ? colors.accentMuted : Colors.transparent,
      borderRadius: BorderRadius.circular(dense ? 10 : 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(dense ? 10 : 12),
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: dense ? 10 : 14,
            vertical: dense ? 8 : 12,
          ),
          child: Row(
            children: [
              if (selected)
                Icon(Icons.check, size: dense ? 16 : 18, color: accent)
              else
                SizedBox(width: dense ? 16 : 18),
              SizedBox(width: dense ? 6 : 8),
              Expanded(
                child: Text(
                  theme.displayName,
                  style: TextStyle(
                    fontSize: dense ? 11 : 13,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                    color: selected ? GuardianColors.safeText : colors.textPrimary,
                  ),
                ),
              ),
            ],
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
