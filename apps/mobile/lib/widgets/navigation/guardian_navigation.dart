import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../l10n/app_localizations.dart';
import '../../main.dart';
import '../../theme/app_theme.dart';
import '../brand/dodo_ai_icon.dart';
import '../theme/theme_picker.dart';

typedef GuardianDestination = ({IconData icon, String label});

/// Scenic Le Morne / Mauritius coast — bundled for desktop sidebar only.
const _sidebarBackgroundAsset = 'assets/navigation/sidebar_le_morne.jpg';

const _sidebarExpandedWidth = 240.0;
const _sidebarCollapsedWidth = 72.0;
const _sidebarAnimDuration = Duration(milliseconds: 250);

const _sidebarOverlay = Color(0x990A1210);
const _sidebarActivePill = Color(0x661A3D2E);
const _sidebarAccentGreen = Color(0xFF3DD68C);
const _sidebarTextPrimary = Colors.white;
const _sidebarTextMuted = Color(0xB3FFFFFF);

List<GuardianDestination> guardianDestinations(BuildContext context) {
  final t = AppLocalizations.of(context)!;
  return [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.map_outlined, label: t.navSafeZones),
    (icon: Icons.notifications_none_rounded, label: t.navAlerts),
    (icon: Icons.person_outline_rounded, label: t.navAccount),
  ];
}

IconData _sidebarOutlinedIcon(IconData icon) {
  if (icon == Icons.home_rounded) return Icons.home_outlined;
  if (icon == Icons.notifications_none_rounded) {
    return Icons.notifications_none_outlined;
  }
  if (icon == Icons.person_outline_rounded) return Icons.person_outlined;
  return icon;
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
    required this.collapsed,
    required this.onCollapsedChanged,
    required this.onTap,
  });

  final int currentIndex;
  final bool collapsed;
  final ValueChanged<bool> onCollapsedChanged;
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

  void _toggleCollapsed() {
    final next = !widget.collapsed;
    if (next) setState(() => _themeExpanded = false);
    widget.onCollapsedChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final items = guardianDestinations(context);
    final currentTheme =
        GuardianApp.themeOf(context) ?? GuardianThemeId.defaultTheme;
    final sidebarWidth = widget.collapsed
        ? _sidebarCollapsedWidth
        : _sidebarExpandedWidth;
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AnimatedContainer(
          duration: _sidebarAnimDuration,
          curve: Curves.easeInOut,
          width: sidebarWidth,
          child: ClipRect(
            child: LayoutBuilder(
            builder: (context, constraints) {
              // Follow animated width so icon-only layout kicks in before labels
              // would overflow during the expand/collapse transition.
              final compact = constraints.maxWidth < 160;
              return Stack(
                clipBehavior: Clip.none,
                fit: StackFit.expand,
                children: [
                  const _SidebarScenicBackground(),
                  SafeArea(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Padding(
                          padding: EdgeInsets.fromLTRB(
                            compact ? 10 : 18,
                            20,
                            compact ? 10 : 18,
                            compact ? 16 : 24,
                          ),
                          child: _SidebarBrandHeader(compact: compact),
                        ),
                        for (var index = 0; index < items.length; index++)
                          _SidebarItem(
                            item: items[index],
                            selected: widget.currentIndex == index,
                            compact: compact,
                            onTap: () => widget.onTap(index),
                          ),
                        _SidebarThemeToggle(
                          expanded: _themeExpanded,
                          compact: compact,
                          onTap: _toggleThemeSection,
                        ),
                        const Spacer(),
                        Padding(
                          padding: EdgeInsets.fromLTRB(
                            compact ? 10 : 18,
                            12,
                            compact ? 10 : 18,
                            10,
                          ),
                          child: _SidebarFooter(compact: compact),
                        ),
                        Padding(
                          padding: EdgeInsets.fromLTRB(
                            compact ? 8 : 12,
                            0,
                            compact ? 8 : 12,
                            16,
                          ),
                          child: _SidebarItem(
                            item: (
                              icon: Icons.help_outline_rounded,
                              label: 'Help',
                            ),
                            selected: false,
                            compact: compact,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Positioned(
                    top: 14,
                    right: compact ? 6 : 8,
                    child: _SidebarCollapseToggle(
                      collapsed: widget.collapsed,
                      onTap: _toggleCollapsed,
                    ),
                  ),
                ],
              );
            },
            ),
          ),
        ),
        if (_themeExpanded)
          Material(
            elevation: 8,
            color: _sidebarOverlay,
            child: Container(
              width: 196,
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(color: Colors.white.withValues(alpha: 0.12)),
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
                          color: _sidebarTextPrimary,
                        ),
                      ),
                      const SizedBox(height: 8),
                      ThemePickerList(
                        selected: currentTheme,
                        dense: true,
                        onDarkSurface: true,
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

class _SidebarScenicBackground extends StatelessWidget {
  const _SidebarScenicBackground();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        image: DecorationImage(
          image: AssetImage(_sidebarBackgroundAsset),
          fit: BoxFit.cover,
          alignment: Alignment.centerLeft,
        ),
      ),
      child: const ColoredBox(color: _sidebarOverlay),
    );
  }
}

class _SidebarCollapseToggle extends StatelessWidget {
  const _SidebarCollapseToggle({
    required this.collapsed,
    required this.onTap,
  });

  final bool collapsed;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black.withValues(alpha: 0.35),
      borderRadius: BorderRadius.circular(8),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: SizedBox(
          width: 28,
          height: 28,
          child: Icon(
            collapsed ? Icons.chevron_right_rounded : Icons.chevron_left_rounded,
            size: 18,
            color: _sidebarTextPrimary.withValues(alpha: 0.9),
          ),
        ),
      ),
    );
  }
}

class _SidebarBrandHeader extends StatelessWidget {
  const _SidebarBrandHeader({required this.compact});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return const Center(
        child: GuardianBrandMark(size: 36, showShadow: false),
      );
    }
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        const GuardianBrandMark(size: 42, showShadow: false),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Guardian',
                style: GoogleFonts.inter(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: _sidebarTextPrimary,
                  height: 1.0,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                "Know they're safe.",
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w400,
                  color: _sidebarTextMuted,
                  height: 1.0,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SidebarFooter extends StatelessWidget {
  const _SidebarFooter({required this.compact});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (compact) {
      return const Center(child: _MauritiusFlagIcon(size: 16));
    }
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Flexible(
          child: Text(
            'Proudly Mauritian',
            textAlign: TextAlign.center,
            style: GoogleFonts.dancingScript(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: _sidebarTextPrimary.withValues(alpha: 0.92),
              height: 1.1,
            ),
          ),
        ),
        const SizedBox(width: 8),
        const _MauritiusFlagIcon(size: 18),
      ],
    );
  }
}

class _MauritiusFlagIcon extends StatelessWidget {
  const _MauritiusFlagIcon({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size * 1.5,
      height: size,
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(2),
          border: Border.all(color: Colors.white.withValues(alpha: 0.35)),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.25),
              blurRadius: 4,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(1.5),
          child: const CustomPaint(
            painter: _MauritiusFlagPainter(),
          ),
        ),
      ),
    );
  }
}

/// Horizontal Mauritius flag stripes (red, blue, yellow, green).
class _MauritiusFlagPainter extends CustomPainter {
  const _MauritiusFlagPainter();

  static const _stripes = <Color>[
    GuardianColors.flagRed,
    GuardianColors.flagBlue,
    GuardianColors.flagYellow,
    GuardianColors.flagGreen,
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final stripeHeight = size.height / _stripes.length;
    for (var i = 0; i < _stripes.length; i++) {
      canvas.drawRect(
        Rect.fromLTWH(0, i * stripeHeight, size.width, stripeHeight),
        Paint()..color = _stripes[i],
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

class _SidebarThemeToggle extends StatelessWidget {
  const _SidebarThemeToggle({
    required this.expanded,
    required this.compact,
    required this.onTap,
  });

  final bool expanded;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = expanded ? _sidebarAccentGreen : _sidebarTextMuted;
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 12,
        vertical: 4,
      ),
      child: Material(
        color: expanded ? _sidebarActivePill : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: 44,
            child: Padding(
              padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 14),
              child: compact
                  ? Center(
                      child: Icon(Icons.palette_outlined, size: 20, color: color),
                    )
                  : Row(
                      children: [
                        Icon(Icons.palette_outlined, size: 20, color: color),
                        const SizedBox(width: 12),
                        Text(
                          'Theme',
                          style: TextStyle(
                            fontSize: 14,
                            color: color,
                            fontWeight:
                                expanded ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
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
    required this.compact,
    this.onTap,
  });

  final GuardianDestination item;
  final bool selected;
  final bool compact;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected ? _sidebarTextPrimary : _sidebarTextMuted;
    return Padding(
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 8 : 12,
        vertical: 4,
      ),
      child: Material(
        color: selected ? _sidebarActivePill : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            height: 44,
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (selected && !compact)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 3,
                      height: 28,
                      decoration: BoxDecoration(
                        color: _sidebarAccentGreen,
                        borderRadius: const BorderRadius.horizontal(
                          right: Radius.circular(2),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: _sidebarAccentGreen.withValues(alpha: 0.95),
                            blurRadius: 10,
                            spreadRadius: 1,
                          ),
                          BoxShadow(
                            color: _sidebarAccentGreen.withValues(alpha: 0.45),
                            blurRadius: 18,
                            spreadRadius: 2,
                          ),
                        ],
                      ),
                    ),
                  ),
                if (selected && compact)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 3,
                      height: 24,
                      decoration: BoxDecoration(
                        color: _sidebarAccentGreen,
                        borderRadius: const BorderRadius.horizontal(
                          right: Radius.circular(2),
                        ),
                      ),
                    ),
                  ),
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: compact ? 0 : 14),
                  child: compact
                      ? Center(
                          child: Icon(
                            _sidebarOutlinedIcon(item.icon),
                            size: 20,
                            color: color,
                          ),
                        )
                      : Row(
                          children: [
                            Icon(
                              _sidebarOutlinedIcon(item.icon),
                              size: 20,
                              color: color,
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Text(
                                item.label,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 14,
                                  color: color,
                                  fontWeight: selected
                                      ? FontWeight.w700
                                      : FontWeight.w500,
                                ),
                              ),
                            ),
                          ],
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
