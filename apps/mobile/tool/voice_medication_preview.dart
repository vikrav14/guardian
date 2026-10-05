// Visual fixture only. No Firebase, gateway or watch calls are possible here.
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:guardian/services/reminder_recording.dart';
import 'package:guardian/services/voice_medication_service.dart';
import 'package:guardian/theme/app_theme.dart';
import 'package:guardian/widgets/care/voice_medication_card.dart';

const sample = VoiceMedicationReminder(
  id: 'visual-fixture',
  time: '18:30',
  text: 'Evening medicine',
  frequency: 2,
  mode: 'voice',
  durationMs: 3480,
  status: 'reply_observed',
  managed: true,
);

class PreviewClient implements VoiceMedicationClient {
  @override
  Future<List<VoiceMedicationReminder>> load(String imei) async => [sample];
  @override
  Future<VoiceMedicationReminder> save(
    String imei,
    Map<String, dynamic> body,
  ) async => sample;
  @override
  Future<Uint8List> audio(String imei, String id) async =>
      reminderWav(Uint8List(16000));
  @override
  void close() {}
}

void main() => runApp(
  MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: buildGuardianTheme(),
    home: Scaffold(
      body: Builder(
        builder: (context) => Center(
          child: SizedBox(
            width: 430,
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                children: [
                  const Text(
                    'Watch preferences',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 24),
                  VoiceMedicationCard(
                    imei: 'visual-only',
                    client: PreviewClient(),
                  ),
                  const SizedBox(height: 20),
                  OutlinedButton(
                    onPressed: () => showDialog<void>(
                      context: context,
                      builder: (_) => VoiceMedicationEditor(
                        imei: 'visual-only',
                        client: PreviewClient(),
                        reminder: sample,
                      ),
                    ),
                    child: const Text('Preview voice editor'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    ),
  ),
);
