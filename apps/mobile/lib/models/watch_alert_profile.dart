/// The V52 watch's global alert scene.
///
/// This changes how the watch presents medication reminders and other watch
/// alerts. It does not select a reminder tone or prove that the watch applied
/// the setting; the device has no supported profile read-back command.
enum WatchAlertProfile {
  sound(
    mode: 2,
    wireValue: 'sound',
    label: 'Sound',
    description: 'A tone from the watch speaker',
  ),
  soundAndVibration(
    mode: 1,
    wireValue: 'sound_and_vibration',
    label: 'Sound + vibration',
    description: 'A tone and vibration together',
  ),
  vibration(
    mode: 3,
    wireValue: 'vibration',
    label: 'Vibration',
    description: 'Vibration without a tone',
  ),
  silent(
    mode: 4,
    wireValue: 'silent',
    label: 'Silent',
    description: 'No watch sound or vibration',
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
