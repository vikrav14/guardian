import 'dart:typed_data';
import 'package:record/record.dart';

abstract class ReminderRecorder {
  Future<bool> permission();
  Future<Stream<Uint8List>> start();
  Future<void> stop();
  Future<void> dispose();
}

class MicrophoneReminderRecorder implements ReminderRecorder {
  final _recorder = AudioRecorder();
  @override
  Future<bool> permission() => _recorder.hasPermission();
  @override
  Future<Stream<Uint8List>> start() => _recorder.startStream(
    const RecordConfig(
      encoder: AudioEncoder.pcm16bits,
      sampleRate: 8000,
      numChannels: 1,
      autoGain: true,
      echoCancel: true,
      noiseSuppress: true,
    ),
  );
  @override
  Future<void> stop() async {
    await _recorder.stop();
  }

  @override
  Future<void> dispose() => _recorder.dispose();
}

Uint8List reminderWav(Uint8List pcm) {
  final bytes = Uint8List(44 + pcm.length), view = ByteData.sublistView(bytes);
  void text(int at, String value) =>
      bytes.setRange(at, at + value.length, value.codeUnits);
  text(0, 'RIFF');
  view.setUint32(4, pcm.length + 36, Endian.little);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, Endian.little);
  view.setUint16(20, 1, Endian.little);
  view.setUint16(22, 1, Endian.little);
  view.setUint32(24, 8000, Endian.little);
  view.setUint32(28, 16000, Endian.little);
  view.setUint16(32, 2, Endian.little);
  view.setUint16(34, 16, Endian.little);
  text(36, 'data');
  view.setUint32(40, pcm.length, Endian.little);
  bytes.setRange(44, bytes.length, pcm);
  return bytes;
}
