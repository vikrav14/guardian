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
  factory IncidentPhoto.fromJson(Map<String, dynamic> data) => IncidentPhoto(
    id: data['id'] as String,
    sequence: (data['sequence'] as num).toInt(),
    state: data['state'] as String,
    receivedAt: DateTime.tryParse(data['receivedAt'] as String? ?? ''),
    expiresAt: DateTime.tryParse(data['mediaExpiresAt'] as String? ?? ''),
    analysis: data['analysis'] as Map<String, dynamic>?,
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
  });
  final String type;
  final String state;
  final String? reason;
  final bool trial;
  final DateTime? eventAt;
  final List<IncidentPhoto> photos;
  int get received => photos.where((photo) => photo.viewable).length;
  bool get collecting => ['preparing', 'collecting'].contains(state);
  factory IncidentPhotoFeed.fromJson(Map<String, dynamic> data) =>
      IncidentPhotoFeed(
        type: data['type'] as String,
        state: data['state'] as String,
        reason: data['reason'] as String?,
        trial: data['trial'] == true,
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
