import 'package:flutter_test/flutter_test.dart';
import 'package:guardian/weather/profile_weather.dart';

import 'support/profile_weather_fixture.dart';

void main() {
  test('accepts supported server observation with independent timestamps', () {
    final weather = ProfileWeather.fromMap(weatherTestData());
    expect(weather.isAvailableAt(weatherTestNow), isTrue);
    expect(
      weather.observedAt,
      weatherTestNow.subtract(const Duration(minutes: 8)),
    );
    expect(
      weather.fetchedAt,
      weatherTestNow.subtract(const Duration(minutes: 1)),
    );
    expect(weather.artworkIndex, 1);
  });

  test('new location can use still-current cached weather', () {
    final data = weatherTestData()
      ..['locationObservedAt'] = weatherTestNow.toIso8601String()
      ..['fetchedAt'] = weatherTestNow
          .subtract(const Duration(minutes: 5))
          .toIso8601String()
      ..['observedAt'] = weatherTestNow
          .subtract(const Duration(minutes: 6))
          .toIso8601String();
    expect(ProfileWeather.fromMap(data).isAvailableAt(weatherTestNow), isTrue);
  });

  test('fresh fetch cannot resurrect expired weather or old location', () {
    for (final key in ['observedAt', 'locationObservedAt']) {
      final data = weatherTestData()
        ..[key] = weatherTestNow
            .subtract(const Duration(minutes: 61))
            .toIso8601String()
        ..['fetchedAt'] = weatherTestNow.toIso8601String();
      expect(
        ProfileWeather.fromMap(data).isAvailableAt(weatherTestNow),
        isFalse,
      );
    }
    final weather = ProfileWeather.fromMap(weatherTestData());
    expect(weather.isAvailableAt(weather.expiresAt!), isFalse);
  });

  test('rejects missing, malformed, future and contradictory timestamps', () {
    for (final key in [
      'observedAt',
      'locationObservedAt',
      'fetchedAt',
      'expiresAt',
    ]) {
      for (final value in [null, 'bad-date']) {
        expect(
          ProfileWeather.fromMap(
            weatherTestData()..[key] = value,
          ).isAvailableAt(weatherTestNow),
          isFalse,
        );
      }
    }
    for (final key in ['observedAt', 'locationObservedAt', 'fetchedAt']) {
      final data = weatherTestData()
        ..[key] = weatherTestNow
            .add(const Duration(minutes: 2))
            .toIso8601String();
      expect(
        ProfileWeather.fromMap(data).isAvailableAt(weatherTestNow),
        isFalse,
      );
    }
    final reversed = weatherTestData()
      ..['fetchedAt'] = weatherTestNow
          .subtract(const Duration(minutes: 20))
          .toIso8601String();
    expect(
      ProfileWeather.fromMap(reversed).isAvailableAt(weatherTestNow),
      isFalse,
    );
  });

  test(
    'rejects unsupported state/schema/condition and invalid required values',
    () {
      for (final invalid in [
        {'state': 'unavailable'},
        {'schemaVersion': 2},
        {'condition': 'unknown'},
        {'condition': 'new-provider-code'},
        {'temperatureC': double.nan},
        {'temperatureC': '24'},
        {'temperatureC': 100},
      ]) {
        expect(
          ProfileWeather.fromMap({
            ...weatherTestData(),
            ...invalid,
          }).isAvailableAt(weatherTestNow),
          isFalse,
        );
      }
    },
  );

  test('missing or invalid wind is not represented as calm', () {
    for (final value in [null, -1, double.infinity, '18']) {
      final weather = ProfileWeather.fromMap(
        weatherTestData()..['windKph'] = value,
      );
      expect(weather.isAvailableAt(weatherTestNow), isTrue);
      expect(weather.windKph, isNull);
    }
  });

  test(
    'conditions map independently of wind and clear nights use moon art',
    () {
      final expected = {
        'clear': 0,
        'partly_cloudy': 1,
        'cloudy': 2,
        'rain': 3,
        'thunderstorm': 4,
        'mist': 7,
        'snow': 8,
      };
      for (final entry in expected.entries) {
        final data = weatherTestData(condition: entry.key)..['windKph'] = 40;
        final weather = ProfileWeather.fromMap(data);
        expect(weather.artworkIndex, entry.value);
        expect(weather.windy, isTrue);
      }
      for (final condition in ['clear', 'partly_cloudy']) {
        expect(
          ProfileWeather.fromMap(
            weatherTestData(condition: condition)..['isDay'] = false,
          ).artworkIndex,
          6,
        );
        expect(
          ProfileWeather.fromMap(
            weatherTestData(condition: condition)..['isDay'] = null,
          ).artworkIndex,
          isNull,
        );
      }
      expect(
        ProfileWeather.fromMap(
          weatherTestData(condition: 'rain')..['isDay'] = false,
        ).artworkIndex,
        3,
      );
    },
  );
}
