import 'package:flutter/material.dart';

import '../../theme/colors.dart';
import '../brand/guardian_pin_logo.dart';

/// The public welcome surface. Authentication and form state stay in LoginPage.
class GuardianWelcomeLayout extends StatelessWidget {
  const GuardianWelcomeLayout({
    super.key,
    required this.form,
    this.registerMode = false,
  });

  final Widget form;
  final bool registerMode;

  static const familyImage = 'assets/images/guardian_family_welcome.webp';

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Scaffold(
      backgroundColor: colors.canvas,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 1080 &&
                MediaQuery.textScalerOf(context).scale(16) <= 20;
            final gutter = constraints.maxWidth < 600 ? 20.0 : 40.0;
            return SingleChildScrollView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: EdgeInsets.fromLTRB(gutter, wide ? 36 : 24, gutter, 28),
              child: Center(
                child: ConstrainedBox(
                  constraints: BoxConstraints(maxWidth: wide ? 1280 : 520),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _WelcomeBrand(wide: wide),
                      SizedBox(height: wide ? 48 : 28),
                      if (wide)
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            const Expanded(child: _FamilyStory()),
                            const SizedBox(width: 64),
                            SizedBox(width: 440, child: form),
                          ],
                        )
                      else ...[
                        const _WelcomeHeadline(compact: true),
                        const SizedBox(height: 24),
                        form,
                        const SizedBox(height: 32),
                        const _FamilyStory(showHeadline: false),
                      ],
                      const SizedBox(height: 32),
                      const _ServiceNotes(),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _WelcomeBrand extends StatelessWidget {
  const _WelcomeBrand({required this.wide});

  final bool wide;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final logo = MediaQuery.withNoTextScaling(
      child: Semantics(
        label: 'Guardian',
        excludeSemantics: true,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(4),
              decoration: const BoxDecoration(
                color: GuardianColors.ivory,
                shape: BoxShape.circle,
              ),
              child: GuardianPinMark(size: wide ? 40 : 34),
            ),
            const SizedBox(width: 10),
            GuardianWordmark(
              fontSize: wide ? 29 : 26,
              color: colors.textPrimary,
            ),
          ],
        ),
      ),
    );
    if (!wide) return Align(alignment: Alignment.centerLeft, child: logo);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        logo,
        Text(
          'Family safety, made in Mauritius',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            fontSize: 14,
            color: colors.textSecondary,
          ),
        ),
      ],
    );
  }
}

class _WelcomeHeadline extends StatelessWidget {
  const _WelcomeHeadline({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (!compact) ...[
          Text(
            'CLOSER, THROUGH EVERY GENERATION',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.6,
              color: colors.textSecondary,
            ),
          ),
          const SizedBox(height: 16),
        ],
        Semantics(
          header: true,
          child: Text(
            'Their independence.\nYour peace of mind.',
            style: Theme.of(context).textTheme.headlineLarge?.copyWith(
              fontSize: compact ? 29 : 44,
              height: 1.12,
              fontWeight: FontWeight.w700,
              letterSpacing: compact ? -0.8 : -1.6,
              color: colors.textPrimary,
            ),
          ),
        ),
        if (!compact) ...[
          const SizedBox(height: 16),
          Text(
            'Stay connected to the people you love, through the everyday '
            'moments and the important ones.',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              fontSize: 16,
              height: 1.55,
              color: colors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }
}

class _FamilyStory extends StatelessWidget {
  const _FamilyStory({this.showHeadline = true});

  final bool showHeadline;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showHeadline) ...[
          const _WelcomeHeadline(),
          const SizedBox(height: 28),
        ],
        ClipRRect(
          borderRadius: BorderRadius.circular(24),
          child: AspectRatio(
            aspectRatio: 1.75,
            child: Image.asset(
              GuardianWelcomeLayout.familyImage,
              fit: BoxFit.cover,
              alignment: const Alignment(0, -0.2),
              excludeFromSemantics: true,
              // The form and copy remain usable if an asset cannot be decoded.
              errorBuilder: (context, error, stackTrace) => ColoredBox(
                color: context.guardianColors.surfaceMuted,
                child: Center(
                  child: Icon(
                    Icons.favorite_outline_rounded,
                    size: 48,
                    color: context.guardianColors.textSecondary,
                  ),
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 22),
        LayoutBuilder(
          builder: (context, constraints) {
            final stacked = constraints.maxWidth < 460 ||
                MediaQuery.textScalerOf(context).scale(16) > 20;
            const parents = _FamilyMessage(
              icon: Icons.favorite_border_rounded,
              title: 'For your parents',
              message: 'Support the independence they value.',
            );
            const children = _FamilyMessage(
              icon: Icons.wb_sunny_outlined,
              title: 'For your child',
              message: 'Stay close as their world gets bigger.',
            );
            if (stacked) {
              return const Column(
                children: [parents, SizedBox(height: 20), children],
              );
            }
            return const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: parents),
                SizedBox(width: 24),
                Expanded(child: children),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _FamilyMessage extends StatelessWidget {
  const _FamilyMessage({
    required this.icon,
    required this.title,
    required this.message,
  });

  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(top: 2),
          child: ExcludeSemantics(
            child: Icon(icon, size: 21, color: colors.textSecondary),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: colors.textPrimary,
                ),
              ),
              const SizedBox(height: 5),
              Text(
                message,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontSize: 14,
                  height: 1.5,
                  color: colors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ServiceNotes extends StatelessWidget {
  const _ServiceNotes();

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    return Container(
      padding: const EdgeInsets.only(top: 22),
      decoration: BoxDecoration(
        border: Border(top: BorderSide(color: colors.border)),
      ),
      child: Wrap(
        spacing: 28,
        runSpacing: 12,
        children: [
          for (final item in const [
            (Icons.location_on_outlined, 'Location updates'),
            (Icons.call_outlined, 'Family calling'),
            (Icons.notifications_active_outlined, 'SOS alerts'),
          ])
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                ExcludeSemantics(
                  child: Icon(item.$1, size: 17, color: colors.textSecondary),
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    item.$2,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontSize: 14,
                      color: colors.textSecondary,
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
