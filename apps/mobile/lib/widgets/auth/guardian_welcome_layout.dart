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
            final wide =
                constraints.maxWidth >= 1080 &&
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
                      SizedBox(height: wide ? 48 : 20),
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
                        const SizedBox(height: 16),
                        const _FamilyPhoto(compact: true),
                        const SizedBox(height: 20),
                        form,
                      ],
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
  const _FamilyStory();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [_WelcomeHeadline(), SizedBox(height: 28), _FamilyPhoto()],
    );
  }
}

class _FamilyPhoto extends StatelessWidget {
  const _FamilyPhoto({this.compact = false});

  final bool compact;

  @override
  Widget build(BuildContext context) {
    final photo = Image.asset(
      GuardianWelcomeLayout.familyImage,
      fit: BoxFit.cover,
      alignment: const Alignment(0, -0.7),
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
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(compact ? 20 : 24),
      child: compact
          ? LayoutBuilder(
              builder: (context, constraints) => SizedBox(
                width: double.infinity,
                height: (constraints.maxWidth / 2.2).clamp(150.0, 240.0),
                child: photo,
              ),
            )
          : AspectRatio(aspectRatio: 1.75, child: photo),
    );
  }
}
