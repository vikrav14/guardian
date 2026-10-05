class IncidentPhoto {
  const IncidentPhoto({
    required this.id,
    required this.sequence,
    required this.state,
    this.receivedAt,
    this.expiresAt,
    this.analysis,
  });
  final String id;
  final int sequence;
  final String state;
  final DateTime? receivedAt;
  final DateTime? expiresAt;
  final Map<String, dynamic>? analysis;
  bool get viewable =>
      state == 'available' && (expiresAt?.isAfter(DateTime.now()) ?? false);
  String? get sceneSummary {
    if (analysis?['status'] != 'ready') return null;
    final summary = analysis?['summary'];
    if (summary is String && summary.trim().isNotEmpty) return summary.trim();
    final details = analysis?['visibleDetails'];
    if (details is List) {
      for (final text in details) {
        if (text is String && text.trim().isNotEmpty) return text.trim();
      }
    }
    return null;
  }

  int? get suggestedQuarterTurns {
    if (!['ready', 'too_unclear'].contains(analysis?['status'])) {
      return null;
    }
    final orientation = analysis?['orientation'];
    if (analysis?['basis'] != 'original_photo') {
      final selection = analysis?['orientationSelection'];
      final inputRotation = analysis?['inputRotationClockwiseDegrees'];
      final confirmed =
          orientation is Map &&
          orientation['confidence'] == 'high' &&
          orientation['clockwiseDegrees'] == 0;
      final abstained =
          orientation == null ||
          (orientation is Map &&
              orientation['confidence'] == 'low' &&
              orientation['clockwiseDegrees'] == null);
      if (![
            'rotated_original_photo',
            'decoded_original_photo',
          ].contains(analysis?['basis']) ||
          analysis?['orientationReference'] != 'analysis_input' ||
          selection is! Map ||
          selection['method'] != 'four_views_then_description' ||
          selection['confidence'] != 'high' ||
          !(confirmed &&
                  [null, 'confirmed'].contains(selection['verification']) ||
              abstained && selection['verification'] == 'uncertain') ||
          selection['clockwiseDegrees'] != inputRotation) {
        return null;
      }
      return inputRotation is int && [0, 90, 180, 270].contains(inputRotation)
          ? inputRotation ~/ 90
          : null;
    }
    if (orientation is! Map || orientation['confidence'] != 'high') {
      return null;
    }
    final degrees = orientation['clockwiseDegrees'];
    return degrees is int && [0, 90, 180, 270].contains(degrees)
        ? degrees ~/ 90
        : null;
  }

  factory IncidentPhoto.fromJson(Map<String, dynamic> data) => IncidentPhoto(
    id: data['id'] as String,
    sequence: (data['sequence'] as num).toInt(),
    state: data['state'] as String,
    receivedAt: DateTime.tryParse(data['receivedAt'] as String? ?? ''),
    expiresAt: DateTime.tryParse(data['mediaExpiresAt'] as String? ?? ''),
    analysis: data['analysis'] as Map<String, dynamic>?,
  );
}

class IncidentPhotoAccess {
  IncidentPhotoAccess({
    required this.canRequest,
    this.incidentId,
    this.reason,
    this.endsAt,
    this.retryAt,
    DateTime? serverAt,
  }) : _clockOffset = (serverAt ?? DateTime.now()).difference(DateTime.now());
  final bool canRequest;
  final String? incidentId, reason;
  final DateTime? endsAt, retryAt;
  final Duration _clockOffset;
  DateTime get serverNow => DateTime.now().add(_clockOffset);
  bool get windowOpen =>
      endsAt?.isAfter(serverNow) == true &&
      ![
        'capture_disabled',
        'photo_window_closed',
        'photo_feature_unavailable',
        'photo_window_not_enabled_for_incident',
      ].contains(reason);
  bool get requestEnabled => windowOpen && canRequest;
  int get minutesLeft => endsAt == null
      ? 0
      : (endsAt!.difference(serverNow).inSeconds / 60).ceil().clamp(0, 60);
  String get message {
    if (reason == 'photo_feature_unavailable') {
      return 'Photo requests are not enabled on the service yet.';
    }
    if (reason == 'photo_window_not_enabled_for_incident') {
      return 'This earlier alert has no photo-request window. Check its photos in Alerts.';
    }
    if (reason == 'capture_disabled') {
      return 'Photo requests are switched off for this watch.';
    }
    if (!windowOpen) {
      return 'Available for one hour after an SOS or fall alert.';
    }
    return switch (reason) {
      'camera_busy' ||
      'automatic_photo_pending' => 'Waiting for the watch’s photo…',
      'incident_photo_settling' =>
        retryAt == null
            ? 'Please wait before the next photo.'
            : 'Next request available in ${retryAt!.difference(serverNow).inSeconds.clamp(0, 360)} seconds.',
      _ => 'Each tap requests one photo and its AI analysis.',
    };
  }

  factory IncidentPhotoAccess.fromJson(Map<String, dynamic> data) =>
      IncidentPhotoAccess(
        canRequest: data['canRequest'] == true,
        incidentId: data['incidentId'] as String?,
        reason: data['reason'] as String?,
        endsAt: DateTime.tryParse(data['requestWindowEndsAt'] as String? ?? ''),
        retryAt: DateTime.tryParse(data['retryAt'] as String? ?? ''),
        serverAt: DateTime.tryParse(data['serverAt'] as String? ?? ''),
      );
}

class IncidentPhotoFeed {
  const IncidentPhotoFeed({
    required this.type,
    required this.state,
    required this.photos,
    this.eventAt,
    this.reason,
    this.trial = false,
    this.photoAccess,
  });
  final String type;
  final String state;
  final String? reason;
  final bool trial;
  final DateTime? eventAt;
  final List<IncidentPhoto> photos;
  final IncidentPhotoAccess? photoAccess;
  int get received => photos.where((photo) => photo.viewable).length;
  bool get collecting => ['preparing', 'collecting'].contains(state);
  factory IncidentPhotoFeed.fromJson(Map<String, dynamic> data) =>
      IncidentPhotoFeed(
        type: data['type'] as String,
        state: data['state'] as String,
        reason: data['reason'] as String?,
        trial: data['trial'] == true,
        photoAccess: data['photoAccess'] is Map<String, dynamic>
            ? IncidentPhotoAccess.fromJson(
                data['photoAccess'] as Map<String, dynamic>,
              )
            : null,
        eventAt: DateTime.tryParse(data['eventAt'] as String? ?? ''),
        photos: (data['photos'] as List<dynamic>)
            .map((item) => IncidentPhoto.fromJson(item as Map<String, dynamic>))
            .toList(),
      );
}

String? incidentFromUri(Uri uri) {
  final id = uri.queryParameters['incident'];
  return id != null && RegExp(r'^[A-Za-z0-9_-]{1,80}$').hasMatch(id)
      ? id
      : null;
}
