import 'package:flutter/material.dart';

import '../../dashboard/device_connectivity.dart';
import '../../dashboard/device_formatters.dart';
import '../../models/device.dart';
import '../../theme/app_theme.dart';
import '../guardian_widgets.dart';

/// Horizontal strip of linked pendants — who / status / short where.
/// Shown when the family has more than one device.
class FamilyDeviceStrip extends StatelessWidget {
  const FamilyDeviceStrip({
    super.key,
    required this.devices,
    required this.selectedImei,
    required this.onSelect,
    this.now,
  });

  final List<Device> devices;
  final String? selectedImei;
  final ValueChanged<String> onSelect;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    if (devices.length < 2) return const SizedBox.shrink();

    final colors = context.guardianColors;
    final subtitle = dashboardSafetySubtitle(devices, now: now);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          subtitle,
          style: TextStyle(
            color: colors.textMuted,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: devices.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (context, index) {
              final device = devices[index];
              final selected = device.imei == selectedImei;
              return _FamilyDeviceChip(
                key: ValueKey('family-strip-${device.imei}'),
                device: device,
                selected: selected,
                now: now,
                onTap: () => onSelect(device.imei),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _FamilyDeviceChip extends StatelessWidget {
  const _FamilyDeviceChip({
    super.key,
    required this.device,
    required this.selected,
    required this.onTap,
    this.now,
  });

  final Device device;
  final bool selected;
  final VoidCallback onTap;
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final colors = context.guardianColors;
    final phase = device.connectivityPhase(now: now);
    final statusLabel = deviceConnectivityLabel(device, now: now);
    final statusColor = switch (phase) {
      DeviceConnectivityPhase.live => GuardianColors.safe,
      DeviceConnectivityPhase.reconnecting => GuardianColors.warning,
      DeviceConnectivityPhase.offline => GuardianColors.warning,
    };
    final statusBg = switch (phase) {
      DeviceConnectivityPhase.live => GuardianColors.safeBg,
      DeviceConnectivityPhase.reconnecting => GuardianColors.warningBg,
      DeviceConnectivityPhase.offline => GuardianColors.warningBg,
    };

    final whereLine = deviceLocationStatusLabel(device);
    final detail = device.mapDisplayLocation?.isValid == true
        ? '$whereLine · ${deviceUpdatedLabel(device, now: now)}'
        : whereLine;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(18),
        child: Ink(
          width: 168,
          padding: const EdgeInsets.fromLTRB(10, 10, 12, 10),
          decoration: BoxDecoration(
            color: colors.surface.withValues(alpha: 0.96),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: selected ? GuardianColors.forest : colors.border,
              width: selected ? 1.8 : 1,
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: GuardianColors.forest.withValues(alpha: 0.12),
                      blurRadius: 14,
                      offset: const Offset(0, 6),
                    ),
                  ]
                : null,
          ),
          child: Row(
            children: [
              AvatarBubble(
                initials: initialsFor(device.displayName),
                color: avatarColorForKey(device.imei),
                size: 40,
                imageUrl: device.avatarUrl,
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      device.displayName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: colors.textPrimary,
                        fontSize: 13,
                        fontWeight: selected
                            ? FontWeight.w800
                            : FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 7,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: statusBg,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        statusLabel,
                        style: TextStyle(
                          color: statusColor,
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      detail,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: colors.textMuted,
                        fontSize: 9,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
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
