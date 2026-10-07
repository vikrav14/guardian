import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../models/device.dart';
import '../navigation/whatsapp_menu_target.dart';
import '../services/family_sharing_service.dart';
import '../services/intelligence_service.dart';
import '../services/guardian_services.dart';
import '../services/guardian_entitlements_scope.dart';
import '../services/watch_call_actions.dart';
import '../wellness/movement_reminders_page.dart';
import '../wellness/wellness_panel.dart';
import '../wellness/wellness_routine.dart';
import '../widgets/care/voice_medication_card.dart';
import '../widgets/intelligence_view.dart';
import '../widgets/dashboard/incident_photo_action.dart';
import 'account_page.dart';
import 'alerts_page.dart';
import 'family_page.dart';
import 'journey_page.dart';
import 'map_dashboard_page.dart';
import 'safe_zones_page.dart';
import 'voice_messages_page.dart';
import 'watch_settings_page.dart';

/// Resolve every old WhatsApp link against authenticated, current membership.
/// The nested navigator is discarded on access changes, including its details.
class WhatsAppMenuPage extends StatefulWidget {
  const WhatsAppMenuPage({super.key, required this.target});
  final WhatsAppMenuTarget target;
  @override
  State<WhatsAppMenuPage> createState() => _WhatsAppMenuPageState();
}

class _WhatsAppMenuPageState extends State<WhatsAppMenuPage>
    with WidgetsBindingObserver {
  final _client = FamilySharingService();
  StreamSubscription<dynamic>? _auth, _access;
  Timer? _expiry;
  Widget? _destination;
  GuardianSubscription? _subscription;
  String? _error;
  bool _foreground = true;
  int _generation = 0;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _auth = FirebaseAuth.instance.idTokenChanges().listen((_) => _reload());
    unawaited(_reload());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    unawaited(_reload());
  }

  Future<void> _reload() async {
    if (!mounted) return;
    final generation = ++_generation, uid = _client.uid;
    _expiry?.cancel();
    setState(() {
      _destination = null;
      _error = null;
    });
    if (!_foreground) return;
    try {
      if (uid == null) {
        throw const FamilySharingException('sign_in_required');
      }
      final circle = widget.target.resolve(await _client.load());
      if (circle == null) {
        throw const FamilySharingException('access_not_shared');
      }
      final subscription = GuardianSubscription.fromMap(
        Map<String, dynamic>.from(circle.data['subscription'] as Map),
        ownerUid: circle.ownerUid,
      );
      final device = await DeviceService()
          .watchDevice(circle.imei)
          .first
          .timeout(const Duration(seconds: 12));
      if (device == null || !subscription.serviceActive) {
        throw const FamilySharingException('access_not_shared');
      }
      final settings = widget.target.screen == 'settings'
          ? await _client.loadWatchSettings(device)
          : device;
      if (!mounted ||
          generation != _generation ||
          uid != _client.uid ||
          !_foreground) {
        return;
      }
      _access ??= FirebaseFirestore.instance
          .collection('familyServices')
          .doc(circle.imei)
          .snapshots()
          .listen(
            (_) => _reload(),
            onError: (Object _) {
              if (mounted) {
                _generation++;
                setState(() {
                  _destination = null;
                  _error = 'Shared access could not be checked.';
                });
              }
            },
          );
      final member = circle.members.where((m) => m['uid'] == uid).firstOrNull;
      final expires = <int>[
        if (member?['untilMs'] is num) (member!['untilMs'] as num).toInt(),
        if (subscription.accessUntil != null)
          subscription.accessUntil!.millisecondsSinceEpoch,
      ];
      if (expires.isNotEmpty) {
        expires.sort();
        final delay = expires.first - DateTime.now().millisecondsSinceEpoch;
        if (delay <= 0) {
          throw const FamilySharingException('access_not_shared');
        }
        _expiry = Timer(Duration(milliseconds: delay), _reload);
      }
      setState(() {
        _subscription = subscription;
        _destination = _screen(settings, subscription);
      });
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(
          () => _error = error is FamilySharingException
              ? error.message
              : 'This feature could not be opened. Return to the WhatsApp menu or refresh.',
        );
      }
    }
  }

  Widget _frame(String title, Widget child) => Scaffold(
    appBar: AppBar(title: Text(title)),
    body: SingleChildScrollView(
      padding: const EdgeInsets.all(20),
      child: child,
    ),
  );
  Widget _screen(Device device, GuardianSubscription subscription) {
    switch (widget.target.screen) {
      case 'today':
        if (!guardianIntelligenceEnabled) {
          return device.allowsShared('location')
              ? Scaffold(
                  appBar: AppBar(title: Text(device.displayName)),
                  body: MapDashboardPage(initialImei: device.imei),
                )
              : _alerts(device);
        }
        return _frame(
          'Today with Guardian',
          IntelligenceView(imei: device.imei, wearerName: device.displayName),
        );
      case 'updates':
      case 'location':
      case 'watch':
        return Scaffold(
          appBar: AppBar(title: Text(device.displayName)),
          body: MapDashboardPage(initialImei: device.imei),
        );
      case 'journey':
        return JourneyPage(
          imei: device.imei,
          deviceName: device.displayName,
          subscription: subscription,
          avatarUrl: device.avatarUrl,
        );
      case 'photos':
        return _frame(
          'Photos & AI details',
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              IncidentPhotoAction(
                imei: device.imei,
                wearerName: device.displayName,
              ),
              const SizedBox(height: 20),
              const Text(
                'Saved photos remain inside their incident until they expire or are deleted.',
              ),
              Builder(
                builder: (context) => TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => _alerts(device)),
                  ),
                  child: const Text('View incidents'),
                ),
              ),
            ],
          ),
        );
      case 'alerts':
        return _alerts(device);
      case 'voice':
        return VoiceMessagesPage(
          imei: device.imei,
          wearerName: device.displayName,
          wearerAvatarUrl: device.avatarUrl,
        );
      case 'reminders':
        return _frame(
          'Medicine reminders · ${device.displayName}',
          VoiceMedicationCard(imei: device.imei),
        );
      case 'wellness':
        return _frame(
          'Wellness · ${device.displayName}',
          WellnessPanel(
            imei: device.imei,
            name: device.displayName,
            subscription: subscription,
            activityEnabled: true,
          ),
        );
      case 'routine':
        return WellnessRoutinePage(
          imei: device.imei,
          subscription: subscription,
        );
      case 'movement':
        return MovementRemindersPage(
          imei: device.imei,
          name: device.displayName,
          subscription: subscription,
        );
      case 'settings':
        return WatchSettingsPage(device: device, subscription: subscription);
      case 'zones':
        return SafeZonesPage(initialImei: device.imei);
      case 'family':
        return const FamilyPage();
      case 'account':
        return const AccountPage();
      case 'call':
        return _frame(
          'Call ${device.displayName}',
          FilledButton.icon(
            onPressed: () => callWatch(context, device),
            icon: const Icon(Icons.call),
            label: const Text('Call watch'),
          ),
        );
      default:
        return _frame(
          'Using Guardian',
          const Text(
            'Use the WhatsApp menu for recorded updates and links to shared app features. '
            'Send menu to return to the menu. Photos need an eligible SOS or fall incident. '
            'For urgent help, call the wearer or emergency services directly.',
          ),
        );
    }
  }

  Widget _alerts(Device device) => AlertsPage(
    alertsStream: AlertService().watchLinkedAlerts().map(
      (rows) => rows.where((a) => a.imei == device.imei).toList(),
    ),
    devicesStream: DeviceService().watchLinkedDevices().map(
      (rows) => rows.where((d) => d.imei == device.imei).toList(),
    ),
  );
  @override
  void dispose() {
    _generation++;
    _expiry?.cancel();
    unawaited(_auth?.cancel());
    unawaited(_access?.cancel());
    _client.close();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _destination == null
      ? Scaffold(
          appBar: AppBar(title: const Text('Guardian')),
          body: Center(
            child: _error == null
                ? const CircularProgressIndicator()
                : Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!),
                        const SizedBox(height: 16),
                        OutlinedButton(
                          onPressed: _reload,
                          child: const Text('Refresh'),
                        ),
                      ],
                    ),
                  ),
          ),
        )
      : GuardianEntitlementsScope(
          subscription: _subscription,
          checking: false,
          child: Scaffold(
            body: Column(
              children: [
                SafeArea(
                  bottom: false,
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      onPressed: () => Navigator.of(context).pop(),
                      icon: const Icon(Icons.arrow_back, size: 18),
                      label: const Text('Back to Guardian'),
                    ),
                  ),
                ),
                Expanded(
                  child: Navigator(
                    key: ValueKey(_generation),
                    onGenerateRoute: (_) =>
                        MaterialPageRoute<void>(builder: (_) => _destination!),
                  ),
                ),
              ],
            ),
          ),
        );
}
