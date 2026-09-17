import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../wellness/linked_wellness_stream.dart';
import '../widgets/dashboard/profile_weather_panel.dart';
import 'profile_weather.dart';

typedef ProfileWeatherSource =
    Stream<Map<String, dynamic>> Function(String imei);

Stream<Map<String, dynamic>> watchProfileWeather(String imei) =>
    watchLinkedWellnessData(
      FirebaseFirestore.instance,
      FirebaseAuth.instance,
      imei,
      () => FirebaseFirestore.instance
          .collection('devices')
          .doc(imei)
          .collection('weather')
          .doc('current')
          .snapshots()
          .map((doc) => [doc.data() ?? <String, dynamic>{}]),
    ).map((rows) => rows.firstOrNull ?? <String, dynamic>{});

/// Owns the selected-profile subscription. Switching profile, unlinking,
/// signing out or a denied read clears the previous profile's weather.
class LinkedProfileWeather extends StatefulWidget {
  const LinkedProfileWeather({
    super.key,
    required this.imei,
    this.source = watchProfileWeather,
    this.clock = DateTime.now,
  });

  final String imei;
  final ProfileWeatherSource source;
  final DateTime Function() clock;

  @override
  State<LinkedProfileWeather> createState() => _LinkedProfileWeatherState();
}

class _LinkedProfileWeatherState extends State<LinkedProfileWeather> {
  StreamSubscription<Map<String, dynamic>>? _subscription;
  Timer? _ageTimer;
  Timer? _expiryTimer;
  ProfileWeather? _weather;
  var _loading = true;
  var _generation = 0;

  @override
  void initState() {
    super.initState();
    _bind();
    _ageTimer = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void didUpdateWidget(LinkedProfileWeather oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.imei != widget.imei || oldWidget.source != widget.source) {
      _bind();
    }
  }

  void _bind() {
    final generation = ++_generation;
    unawaited(_subscription?.cancel());
    _expiryTimer?.cancel();
    _weather = null;
    _loading = true;
    _subscription = widget
        .source(widget.imei)
        .listen(
          (map) {
            if (!mounted || generation != _generation) return;
            setState(() {
              _weather = ProfileWeather.fromMap(map);
              _loading = false;
            });
            _scheduleExpiry();
          },
          onError: (Object error, StackTrace stack) {
            if (!mounted || generation != _generation) return;
            _expiryTimer?.cancel();
            setState(() {
              _weather = null;
              _loading = false;
            });
          },
        );
  }

  void _scheduleExpiry() {
    _expiryTimer?.cancel();
    final weather = _weather;
    final now = widget.clock();
    if (weather == null || !weather.isAvailableAt(now)) return;
    final deadlines = [
      weather.expiresAt!,
      weather.observedAt!.add(ProfileWeather.maxAge),
      weather.locationObservedAt!.add(ProfileWeather.maxLocationAge),
      weather.fetchedAt!.add(ProfileWeather.maxAge),
    ]..sort();
    final remaining = deadlines.first.difference(now);
    _expiryTimer = Timer(remaining, () {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    ++_generation;
    unawaited(_subscription?.cancel());
    _ageTimer?.cancel();
    _expiryTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ProfileWeatherPanel(
    weather: _weather,
    loading: _loading,
    now: widget.clock(),
  );
}
