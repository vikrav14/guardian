import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/device.dart';
import 'guardian_contact_actions.dart';

/// Normal carrier calling, using the same saved SIM and platform handoff as
/// the dashboard. Calling never updates an alert or dispatches a watch command.
Future<void> callWatch(
  BuildContext context,
  Device device, {
  Future<bool> Function(Uri)? launcher,
}) async {
  final sim = device.simNumber?.trim();
  if (sim == null || sim.isEmpty) {
    _notice(
      context,
      'No SIM number is saved for this watch. Check its settings.',
    );
    return;
  }
  final uri = Uri(scheme: 'tel', path: sim);
  Future<void> open() async {
    try {
      final opened =
          await (launcher?.call(uri) ??
              launchUrl(uri, mode: LaunchMode.externalApplication));
      if (!opened && context.mounted) {
        _notice(
          context,
          'No calling app opened. Call the saved watch number from your phone.',
        );
      }
    } catch (_) {
      if (context.mounted) {
        _notice(
          context,
          'Could not open a calling app. Try calling from your phone.',
        );
      }
    }
  }

  if (isMobileGuardianPlatform) {
    await open();
    return;
  }
  if (!context.mounted) return;
  await showDialog<void>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      scrollable: true,
      title: Text('Call ${device.displayName}'),
      content: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          SelectableText(
            sim,
            style: Theme.of(dialogContext).textTheme.titleLarge,
          ),
          const SizedBox(height: 12),
          const Text(
            'This is a normal voice call to the watch. It does not use the watch’s mobile-data allowance; normal voice charges may apply.',
          ),
          if (!device.isLiveConnected) ...[
            const SizedBox(height: 10),
            const Text(
              'The watch has not checked in recently. Voice may still work if it has mobile network coverage.',
            ),
          ],
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext),
          child: const Text('Cancel'),
        ),
        TextButton.icon(
          onPressed: () async {
            try {
              await Clipboard.setData(ClipboardData(text: sim));
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext);
              if (context.mounted) {
                _notice(
                  context,
                  'Watch number copied. Call it from your phone.',
                );
              }
            } catch (_) {
              if (context.mounted) {
                _notice(
                  context,
                  'Could not copy the number. You can select it above.',
                );
              }
            }
          },
          icon: const Icon(Icons.copy_rounded),
          label: const Text('Copy number'),
        ),
        FilledButton(
          onPressed: () async {
            Navigator.pop(dialogContext);
            await open();
          },
          child: const Text('Try this device'),
        ),
      ],
    ),
  );
}

void _notice(BuildContext context, String text) {
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
}
