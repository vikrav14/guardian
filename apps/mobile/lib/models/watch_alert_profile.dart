/// The V52 global ring/vibration scene, offered as a call alert preference.
///
/// Medication reminder behavior must not be inferred from this scene.
/// The cached choice is not confirmed watch state; there is no supported
/// profile read-back command. The UI scope does not change the wire command.
enum WatchAlertProfile {
  sound(
    mode: 2,
    wireValue: 'sound',
    label: 'Sound',
    description: 'Ring for incoming calls',
  ),
  soundAndVibration(
    mode: 1,
    wireValue: 'sound_and_vibration',
    label: 'Sound + vibration',
    description: 'Ring and vibrate for incoming calls',
  ),
  vibration(
    mode: 3,
    wireValue: 'vibration',
    label: 'Vibration',
    description: 'Vibrate for incoming calls',
  ),
  silent(
    mode: 4,
    wireValue: 'silent',
    label: 'Silent',
    description: 'No ringing or vibration for incoming calls',
  );

  const WatchAlertProfile({
    required this.mode,
    required this.wireValue,
    required this.label,
    required this.description,
  });

  final int mode;
  final String wireValue;
  final String label;
  final String description;

  static WatchAlertProfile fromWire(String? value) {
    return values.firstWhere(
      (profile) => profile.wireValue == value,
      orElse: () => WatchAlertProfile.soundAndVibration,
    );
  }
}
