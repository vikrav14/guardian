import 'package:flutter/material.dart';

import '../../theme/app_theme.dart';
import '../../weather/profile_weather.dart';

/// Atmospheric presentation only; no Firebase dependency or device actions.
class ProfileWeatherPanel extends StatelessWidget {
  const ProfileWeatherPanel({
    super.key,
    this.weather,
    this.loading = false,
    this.now,
  });

  final ProfileWeather? weather;
  final bool loading;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final clock = now ?? DateTime.now();
    final data = weather;
    final colors = context.guardianColors;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final available = data?.isAvailableAt(clock) == true;
    if (!available) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Text(
          loading ? 'Updating weather…' : 'Weather unavailable',
          style: TextStyle(color: colors.textSecondary, fontSize: 13),
        ),
      );
    }
    final current = data!;
    final highContrast =
        MediaQuery.highContrastOf(context) ||
        colors.border == GuardianThemeColors.elderCare.border;
    final night = current.isDay == false;
    final storm = current.condition == 'thunderstorm';
    final sunny =
        current.isDay == true &&
        (current.condition == 'clear' || current.condition == 'partly_cloudy');
    final tint = dark
        ? const Color(0xFF20394B)
        : night || storm
        ? const Color(0xFFE0E6F5)
        : sunny
        ? const Color(0xFFFFF0CC)
        : const Color(0xFFDBF0F7);
    final artwork = current.artworkIndex;
    final place = current.placeName;
    final locationLabel = place == null
        ? 'Near last known location'
        : 'Near $place';
    final lastKnown = current.locationIsLastKnownAt(clock);
    final observedAge = _age(current.observedAt!, clock);
    final details =
        'Weather observed ${_time(current.observedAt!)}. '
        'Fetched ${_time(current.fetchedAt!)}. '
        'Watch location observed ${_time(current.locationObservedAt!)}. '
        'Weather near an observed location does not confirm current presence. '
        'Weather data: OpenWeather.';

    return Tooltip(
      message: details,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 10, 12, 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          color: highContrast ? colors.surface : null,
          border: highContrast
              ? Border.all(color: colors.border, width: 2)
              : null,
          gradient: highContrast
              ? null
              : LinearGradient(
                  begin: Alignment.topRight,
                  end: Alignment.bottomLeft,
                  colors: [
                    tint.withValues(alpha: dark ? 0.95 : 0.9),
                    colors.surface.withValues(alpha: 0.02),
                  ],
                ),
        ),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final textScale = MediaQuery.textScalerOf(context).scale(14) / 14;
            final information = Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${current.temperatureC!.round()}°C',
                  style: TextStyle(
                    fontSize: 30,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -1,
                    color: colors.textPrimary,
                    height: 1.1,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  current.conditionLabel,
                  style: TextStyle(
                    color: colors.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  locationLabel,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: colors.textPrimary,
                  ),
                ),
                if (lastKnown && place != null)
                  Text(
                    'Last known location · ${_age(current.locationObservedAt!, clock)}',
                    style: TextStyle(color: colors.textSecondary, fontSize: 12),
                  ),
                if (current.windKph != null) ...[
                  const SizedBox(height: 3),
                  Text(
                    'Wind ${current.windKph!.round()} km/h'
                    '${current.gustKph != null ? ' · Gusts ${current.gustKph!.round()} km/h' : ''}',
                    style: TextStyle(color: colors.textSecondary, fontSize: 12),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  'Weather updated $observedAge',
                  style: TextStyle(color: colors.textSecondary, fontSize: 12),
                ),
              ],
            );
            if (artwork == null) return information;
            final illustration = SizedBox(
              width: 88,
              height: 88,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  WeatherArtwork(index: artwork, size: 88),
                  if (current.windy)
                    const Positioned(
                      right: -4,
                      bottom: -1,
                      child: WeatherArtwork(index: 5, size: 34),
                    ),
                ],
              ),
            );
            if (textScale > 1.6 ||
                (constraints.maxWidth < 260 && textScale > 1.3)) {
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  illustration,
                  const SizedBox(height: 6),
                  information,
                ],
              );
            }
            return Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                illustration,
                const SizedBox(width: 10),
                Expanded(child: information),
              ],
            );
          },
        ),
      ),
    );
  }

  static String _age(DateTime at, DateTime now) {
    final minutes = now.difference(at).inMinutes;
    return minutes < 1 ? 'just now' : '${minutes}m ago';
  }

  static String _time(DateTime at) => at.toUtc().toIso8601String();
}

/// Decorative 3D artwork from a single equal-cell atlas. The condition and
/// measurements are always available as text, including when images fail.
class WeatherArtwork extends StatelessWidget {
  const WeatherArtwork({super.key, required this.index, required this.size});

  final int index;
  final double size;

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: SizedBox.square(
      dimension: size,
      child: ClipRect(
        child: OverflowBox(
          alignment: Alignment.topLeft,
          minWidth: size * 3,
          maxWidth: size * 3,
          minHeight: size * 3,
          maxHeight: size * 3,
          child: Transform.translate(
            offset: Offset(-(index % 3) * size, -(index ~/ 3) * size),
            child: Image.asset(
              'assets/weather/weather_atlas.webp',
              width: size * 3,
              height: size * 3,
              fit: BoxFit.fill,
              filterQuality: FilterQuality.medium,
              errorBuilder: (_, _, _) => const SizedBox.shrink(),
            ),
          ),
        ),
      ),
    ),
  );
}
