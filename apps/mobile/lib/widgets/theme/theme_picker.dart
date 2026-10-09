import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../theme/guardian_appearance.dart';
import '../../theme/guardian_theme_scope.dart';

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
  final bool dense, onDarkSurface;

  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (final theme in GuardianThemeId.allThemes)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: ThemePickerTile(
            theme: theme,
            selected: theme == selected,
            dense: dense,
            onDarkSurface: onDarkSurface,
            onTap: () => onSelected(theme),
          ),
        ),
    ],
  );
}

class ThemePickerTile extends StatelessWidget {
  const ThemePickerTile({
    super.key,
    required this.theme,
    required this.selected,
    required this.onTap,
    this.dense = false,
    this.onDarkSurface = false,
  });

  final GuardianThemeId theme;
  final bool selected, dense, onDarkSurface;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? colors.accentMuted : colors.surfaceMuted,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: selected ? colors.accent : colors.border,
            width: selected ? 2 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                ExcludeSemantics(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.asset(
                      theme.sceneAsset,
                      cacheWidth: 156,
                      width: dense ? 38 : 52,
                      height: dense ? 42 : 60,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => SizedBox(
                        width: 52,
                        height: 60,
                        child: ColoredBox(
                          color: theme.semanticColors.accentMuted,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        theme.displayName,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          color: colors.textPrimary,
                        ),
                      ),
                      if (!dense) ...[
                        const SizedBox(height: 3),
                        Text(
                          theme.description,
                          style: TextStyle(
                            fontSize: 12,
                            color: colors.textSecondary,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  selected ? Icons.check_circle_rounded : Icons.circle_outlined,
                  color: selected ? colors.accent : colors.border,
                  size: 22,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> showThemePickerDialog(BuildContext context) => showDialog<void>(
  context: context,
  builder: (_) => const _AppearanceDialog(),
);

class _AppearanceDialog extends StatelessWidget {
  const _AppearanceDialog();

  @override
  Widget build(BuildContext context) {
    final scope = GuardianThemeScope.maybeOf(context);
    final appearance = (scope?.appearance ?? const GuardianAppearance())
        .copyWith(themeId: scope?.themeId);
    final contrast =
        appearance.highContrast || MediaQuery.highContrastOf(context);
    return Theme(
      // showDialog captures inherited themes; rebuild its theme explicitly so
      // the chooser itself updates while it remains open.
      data: buildGuardianTheme(
        themeId: appearance.themeId,
        highContrast: contrast,
      ),
      child: AlertDialog(
        insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
        contentPadding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
        scrollable: true,
        title: const Text('A little Mauritius'),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Choose the place that feels like you.'),
              const SizedBox(height: 16),
              ThemePickerList(
                selected: appearance.themeId,
                onSelected: (theme) => scope?.setTheme(theme),
              ),
              const Divider(height: 24),
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Scenic background'),
                subtitle: Text(
                  contrast
                      ? 'Hidden while high contrast is on'
                      : 'A quiet glimpse of your chosen place',
                ),
                value: appearance.scenery,
                onChanged: (value) => scope?.onAppearanceChanged?.call(
                  appearance.copyWith(scenery: value),
                ),
              ),
              if (appearance.scenery && !contrast) ...[
                Text(
                  'Background visibility · ${(appearance.strength * 100).round()}%',
                ),
                Slider(
                  value: appearance.strength,
                  min: .10,
                  max: .65,
                  divisions: 11,
                  label: '${(appearance.strength * 100).round()}%',
                  semanticFormatterCallback: (value) =>
                      '${(value * 100).round()} percent background visibility',
                  onChanged: (value) => scope?.onAppearanceChanged?.call(
                    appearance.copyWith(strength: value),
                  ),
                ),
              ],
              SwitchListTile.adaptive(
                contentPadding: EdgeInsets.zero,
                title: const Text('Higher contrast'),
                subtitle: const Text(
                  'Stronger text and borders in every theme',
                ),
                value: appearance.highContrast,
                onChanged: (value) => scope?.onAppearanceChanged?.call(
                  appearance.copyWith(highContrast: value),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Done'),
          ),
        ],
      ),
    );
  }
}
