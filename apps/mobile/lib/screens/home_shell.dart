import 'package:flutter/material.dart';
import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../navigation/guardian_navigation_shell.dart';
import '../services/guardian_entitlements_scope.dart';
import '../services/guardian_services.dart';
import '../widgets/layout/guardian_app_header.dart';
import 'account_page.dart';
import 'family_page.dart';
import 'alerts_page.dart';
import 'map_dashboard_page.dart';
import 'safe_zones_page.dart';
import 'voice_messages_page.dart';
import 'incident_photo_page.dart';
import '../services/voice_notification.dart';
import '../services/voice_messages_service.dart';

class HomeShell extends StatefulWidget {
  const HomeShell({super.key, this.initialIndex = 0, this.initialIncidentId});
  final int initialIndex;
  final String? initialIncidentId;

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  final _dashboardKey = GlobalKey<MapDashboardPageState>();
  late final Stream<GuardianSubscription> _subscriptions;
  StreamSubscription<VoiceNotificationTarget>? _voiceReceived;
  bool _openingVoice = false;

  @override
  void initState() {
    super.initState();
    _subscriptions = UserProfileService().watchSubscription();
    VoiceNotifications.opened.addListener(_openVoice);
    _voiceReceived = VoiceNotifications.received.stream.listen((target) {
      if (!mounted ||
          !kIsWeb ||
          target.recipientUid != FirebaseAuth.instance.currentUser?.uid ||
          VoiceNotifications.activeConversation == target.imei) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('New voice message'),
          action: SnackBarAction(
            label: 'Open',
            onPressed: () => VoiceNotifications.opened.value = target,
          ),
        ),
      );
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final incidentId = widget.initialIncidentId;
      if (incidentId != null) {
        unawaited(
          _navigatorKey.currentState!.push(
            MaterialPageRoute<void>(
              builder: (_) => IncidentPhotoPage(incidentId: incidentId),
            ),
          ),
        );
      }
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid != null && VoiceNotifications.opened.value == null) {
        VoiceNotifications.opened.value = VoiceNotificationTarget.fromUri(
          Uri.base,
          uid,
        );
      }
      unawaited(_openVoice());
    });
  }

  Future<void> _openVoice() async {
    final target = VoiceNotifications.opened.value;
    if (!mounted || _openingVoice || target == null) return;
    VoiceNotifications.opened.value = null;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (!target.canOpenFor(uid, voiceMessagesPilotImei)) return;
    if (VoiceNotifications.activeConversation == target.imei) {
      VoiceNotifications.received.add(target);
      return;
    }
    _openingVoice = true;
    final client = VoiceMessagesService();
    try {
      final inbox = await client.load(target.imei);
      if (!inbox.messages.any(
        (m) => m.id == target.messageId && m.available && m.incoming,
      )) {
        throw const VoiceMessageException('message_unavailable');
      }
      final device = await DeviceService()
          .watchDevice(target.imei)
          .first
          .timeout(const Duration(seconds: 8));
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != uid) return;
      if (device == null) {
        throw const VoiceMessageException('device_not_linked');
      }
      unawaited(
        _navigatorKey.currentState!.push(
          MaterialPageRoute<void>(
            builder: (_) => VoiceMessagesPage(
              imei: target.imei,
              wearerName: device.displayName,
              wearerAvatarUrl: device.avatarUrl,
            ),
          ),
        ),
      );
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == uid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('This voice message is no longer available.'),
          ),
        );
      }
    } finally {
      client.close();
      _openingVoice = false;
      if (mounted && VoiceNotifications.opened.value != null) {
        unawaited(_openVoice());
      }
    }
  }

  @override
  void dispose() {
    VoiceNotifications.opened.removeListener(_openVoice);
    unawaited(_voiceReceived?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      MapDashboardPage(key: _dashboardKey),
      SafeZonesPage(),
      const FamilyPage(),
      const AccountPage(watchOnly: true),
      AlertsPage(),
      const AccountPage(),
    ];
    return StreamBuilder<GuardianSubscription>(
      stream: _subscriptions,
      builder: (context, snapshot) {
        return GuardianEntitlementsScope(
          subscription: snapshot.data,
          checking:
              snapshot.connectionState == ConnectionState.waiting &&
              !snapshot.hasData,
          error: snapshot.error,
          child: GuardianNavigationShell(
            navigatorKey: _navigatorKey,
            initialIndex: widget.initialIndex,
            pages: pages,
            headerBuilder: (goToTab) => GuardianAppHeader(
              onHome: () => goToTab(0),
              onAlerts: () => goToTab(4),
              onAccount: () => goToTab(5),
            ),
          ),
        );
      },
    );
  }
}
