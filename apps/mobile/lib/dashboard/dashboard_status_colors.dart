import 'package:flutter/material.dart';

import '../models/device.dart';
import '../theme/colors.dart';
import 'device_connectivity.dart';
import 'linking_story.dart';

/// The four dashboard status chips mapped to Mauritius flag stripes:
/// red (connectivity), blue (GPS), yellow (battery), green (signal).
enum DashboardFlagMetric { connectivity, gps, battery, signal }

/// Battery above this threshold counts as healthy (bold yellow).
const dashboardBatteryHealthyThreshold = 20;

/// Foreground and background colors for a flag-metric chip.
typedef FlagMetricColors = ({Color foreground, Color background});

FlagMetricColors flagMetricColors(DashboardFlagMetric metric, bool active) {
  switch (metric) {
    case DashboardFlagMetric.connectivity:
      return active
          ? (
              foreground: GuardianColors.flagRed,
              background: GuardianColors.flagRedBg,
            )
          : (
              foreground: GuardianColors.flagRedMuted,
              background: GuardianColors.flagRedBgMuted,
            );
    case DashboardFlagMetric.gps:
      return active
          ? (
              foreground: GuardianColors.flagBlue,
              background: GuardianColors.flagBlueBg,
            )
          : (
              foreground: GuardianColors.flagBlueMuted,
              background: GuardianColors.flagBlueBgMuted,
            );
    case DashboardFlagMetric.battery:
      return active
          ? (
              foreground: GuardianColors.flagYellow,
              background: GuardianColors.flagYellowBg,
            )
          : (
              foreground: GuardianColors.flagYellowMuted,
              background: GuardianColors.flagYellowBgMuted,
            );
    case DashboardFlagMetric.signal:
      return active
          ? (
              foreground: GuardianColors.flagGreen,
              background: GuardianColors.flagGreenBg,
            )
          : (
              foreground: GuardianColors.flagGreenMuted,
              background: GuardianColors.flagGreenBgMuted,
            );
  }
}

FlagMetricColors connectivityMetricColors(Device device, {DateTime? now}) {
  return switch (device.connectivityPhase(now: now)) {
    DeviceConnectivityPhase.live => flagMetricColors(
      DashboardFlagMetric.connectivity,
      true,
    ),
    DeviceConnectivityPhase.reconnecting => (
      foreground: GuardianColors.accent,
      background: GuardianColors.accentBg,
    ),
    DeviceConnectivityPhase.offline => flagMetricColors(
      DashboardFlagMetric.connectivity,
      false,
    ),
  };
}

bool dashboardBatteryHealthy(int? percent) =>
    percent != null && percent > dashboardBatteryHealthyThreshold;

FlagMetricColors linkingStoryMetricColors(LinkingStoryMetricState state) {
  return switch (state) {
    LinkingStoryMetricState.complete => flagMetricColors(
      DashboardFlagMetric.signal,
      true,
    ),
    LinkingStoryMetricState.active => (
      foreground: GuardianColors.accent,
      background: GuardianColors.accentBg,
    ),
    LinkingStoryMetricState.pending => (
      foreground: GuardianColors.flagBlueMuted,
      background: GuardianColors.flagBlueBgMuted,
    ),
  };
}
