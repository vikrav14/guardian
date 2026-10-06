import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import '../models/device.dart';

const familyPermissionLabels = <String, String>{
  'location': 'Current location and watch status',
  'alerts': 'Safety alerts, including the alert location',
  'history': 'Journey history',
  'wellbeing': 'Wellbeing and activity',
  'voice': 'Voice messages',
  'reminders': 'Manage reminders',
  'zones': 'Manage safe zones',
  'settings': 'Change watch settings',
  'photos': 'Eligible incident photos',
};
const familyRoleLabels = {
  'caregiver': 'Caregiver',
  'viewer': 'Viewer',
  'alerts': 'Alerts only',
};
Map<String, bool> familyPreset(String role) => {
  for (final key in familyPermissionLabels.keys)
    key: switch (role) {
      'caregiver' => ['location', 'alerts', 'voice'].contains(key),
      'viewer' => ['location', 'alerts'].contains(key),
      _ => key == 'alerts',
    },
};

class FamilySharingException implements Exception {
  const FamilySharingException(this.code);
  final String code;
  String get message => switch (code) {
    'family_setup_pending' =>
      'Family access controls are awaiting service setup. Existing access stays as it is.',
    'verified_email_required' =>
      'Verify your Guardian account email before accepting this invitation.',
    'invitation_not_available' =>
      'This invitation is for another email address or is no longer available.',
    'invitation_expired_or_cancelled' =>
      'This invitation has expired or was cancelled. Ask the owner for a new one.',
    'people_limit_reached' || 'pending_invitations_fill_circle' =>
      'All places are used or reserved by pending invitations. Review your circle before adding someone.',
    'invitation_already_pending' =>
      'An invitation is already waiting for this email address.',
    'already_a_member' => 'This person already has access.',
    'owner_required' => 'Only the service owner can change family access.',
    'access_not_shared' => 'Your access to this wearer is no longer available.',
    'whatsapp_recipient_limit' =>
      'Your plan’s WhatsApp recipient places are full. Deselect someone first.',
    'recipient_must_link_and_consent' =>
      'This person must link their WhatsApp number and agree to safety messages first.',
    'location_required' =>
      'Journey history and safe zones also require location access.',
    'invalid_email' =>
      'Enter the email address they use to sign in to Guardian.',
    'sign_in_required' => 'Sign in again to manage your family.',
    'active_service_required' =>
      'An active service is required. Existing access can still be reviewed or removed.',
    _ =>
      'Guardian could not save or confirm this change. Refresh and try again.',
  };
  @override
  String toString() => message;
}

class FamilyCircle {
  FamilyCircle(this.data);
  final Map<String, dynamic> data;
  String get imei => data['imei'] as String;
  String get name => data['wearerName'] as String? ?? 'Family member';
  String get ownerUid => data['ownerUid'] as String;
  String get plan => (data['subscription'] as Map)['plan'] as String;
  List<Map<String, dynamic>> get members =>
      (data['members'] as List).cast<Map<String, dynamic>>();
  List<Map<String, dynamic>> get pending =>
      (data['pending'] as List).cast<Map<String, dynamic>>();
  Map<String, dynamic> get limits => data['limits'] as Map<String, dynamic>;
  Map<String, dynamic> get usage => data['usage'] as Map<String, dynamic>;
  bool get overLimit => data['overLimit'] == true;
  bool active(Map<String, dynamic> member) =>
      member['status'] == 'active' &&
      (member['untilMs'] == null ||
          (member['untilMs'] as num) > DateTime.now().millisecondsSinceEpoch);
  List<Map<String, dynamic>> get activeMembers =>
      members.where(active).toList();
}

class FamilySharingSnapshot {
  FamilySharingSnapshot(this.circles, {this.phone});
  final List<FamilyCircle> circles;
  final String? phone;
  factory FamilySharingSnapshot.fromJson(Map<String, dynamic> data) =>
      FamilySharingSnapshot(
        (data['services'] as List)
            .map((v) => FamilyCircle(v as Map<String, dynamic>))
            .toList(),
        phone: (data['channel'] as Map?)?['number'] as String?,
      );
}

abstract class FamilySharingClient {
  String? get uid;
  Future<FamilySharingSnapshot> load();
  Future<Map<String, dynamic>> change(
    String action,
    Map<String, dynamic> body, {
    String? imei,
  });
  void close();
}

class FamilySharingService implements FamilySharingClient {
  FamilySharingService({
    http.Client? client,
    FirebaseAuth? auth,
    this.gatewayUrl = const String.fromEnvironment('GUARDIAN_GATEWAY_URL'),
  }) : _http = client ?? http.Client(),
       _auth = auth ?? FirebaseAuth.instance;
  final http.Client _http;
  final FirebaseAuth _auth;
  final String gatewayUrl;
  @override
  String? get uid => _auth.currentUser?.uid;
  Future<Map<String, dynamic>> _request(
    String? action,
    Map<String, dynamic>? body,
    String? imei,
  ) async {
    if (gatewayUrl.isEmpty) {
      throw const FamilySharingException('family_setup_pending');
    }
    final token = await _auth.currentUser?.getIdToken();
    if (token == null) throw const FamilySharingException('sign_in_required');
    final uri = Uri.parse(
      '$gatewayUrl/app/family${action == null ? '' : '/$action'}',
    ).replace(queryParameters: imei == null ? null : {'imei': imei});
    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };
    final response =
        await (action == null
                ? _http.get(uri, headers: headers)
                : _http.post(uri, headers: headers, body: jsonEncode(body)))
            .timeout(const Duration(seconds: 20));
    final result = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200) {
      throw FamilySharingException(
        result['error'] as String? ?? 'gateway_unavailable',
      );
    }
    return result;
  }

  @override
  Future<FamilySharingSnapshot> load() async =>
      FamilySharingSnapshot.fromJson(await _request(null, null, null));
  @override
  Future<Map<String, dynamic>> change(
    String action,
    Map<String, dynamic> body, {
    String? imei,
  }) => _request(action, body, imei);
  @override
  void close() => _http.close();

  Future<Device> loadWatchSettings(Device device) async {
    final result = await change('settings', {}, imei: device.imei);
    return Device.fromData(
      device.imei,
      result['settings'] as Map<String, dynamic>,
      sharedPermissions: device.sharedPermissions,
      sharedSubscription: device.sharedSubscription,
    );
  }
}
