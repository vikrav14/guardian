import 'package:flutter/material.dart';

enum GuardianCareProfile { child, senior, adult }

extension GuardianCareProfileX on GuardianCareProfile {
  String get firestoreValue => switch (this) {
    GuardianCareProfile.child => 'child',
    GuardianCareProfile.senior => 'senior',
    GuardianCareProfile.adult => 'adult',
  };

  String get label => switch (this) {
    GuardianCareProfile.child => 'Child',
    GuardianCareProfile.senior => 'Older adult',
    GuardianCareProfile.adult => 'Adult',
  };

  String get description => switch (this) {
    GuardianCareProfile.child =>
      'Prioritises journeys, safe zones, unusual stops and getting home safely.',
    GuardianCareProfile.senior =>
      'Prioritises falls, medication, wellbeing, inactivity and wandering.',
    GuardianCareProfile.adult =>
      'Balanced safety, location and wellbeing support.',
  };

  IconData get icon => switch (this) {
    GuardianCareProfile.child => Icons.school_rounded,
    GuardianCareProfile.senior => Icons.elderly_rounded,
    GuardianCareProfile.adult => Icons.person_rounded,
  };

  static GuardianCareProfile fromValue(String? value) => switch (value) {
    'child' => GuardianCareProfile.child,
    'senior' => GuardianCareProfile.senior,
    _ => GuardianCareProfile.adult,
  };
}

abstract final class GuardianCarePriority {
  static const safeZones = 'safe_zones';
  static const journeys = 'journeys';
  static const unusualStops = 'unusual_stops';
  static const falls = 'falls';
  static const medication = 'medication';
  static const wellbeing = 'wellbeing';
  static const inactivity = 'inactivity';
  static const wandering = 'wandering';

  static const childDefaults = <String>[safeZones, journeys, unusualStops];

  static const seniorDefaults = <String>[
    falls,
    medication,
    wellbeing,
    inactivity,
    wandering,
  ];

  static const adultDefaults = <String>[safeZones, wellbeing];

  static List<String> defaultsFor(GuardianCareProfile profile) =>
      switch (profile) {
        GuardianCareProfile.child => childDefaults,
        GuardianCareProfile.senior => seniorDefaults,
        GuardianCareProfile.adult => adultDefaults,
      };

  static String label(String value) => switch (value) {
    safeZones => 'Safe zones',
    journeys => 'Journeys',
    unusualStops => 'Unusual stops',
    falls => 'Fall detection',
    medication => 'Medication',
    wellbeing => 'Wellbeing',
    inactivity => 'Inactivity',
    wandering => 'Wandering',
    _ => value,
  };
}

abstract final class GuardianCapability {
  static const gps = 'gps';
  static const wifiPositioning = 'wifi_positioning';
  static const lbs = 'lbs';
  static const sos = 'sos';
  static const calling = 'calling';
  static const fallDetection = 'fall_detection';
  static const heartRate = 'heart_rate';
  static const bloodPressure = 'blood_pressure';
  static const spo2 = 'spo2';
  static const temperature = 'temperature';
  static const steps = 'steps';
  static const medicationReminders = 'medication_reminders';
}
