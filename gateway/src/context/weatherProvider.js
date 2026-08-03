/**
 * Weather context provider
 * Fetches and normalizes weather data for device locations
 * Uses OpenWeatherMap API with caching and error handling
 */

const https = require('https');
const Logger = require('../logger');

const logger = new Logger('weather-provider');

class WeatherProvider {
  constructor(apiKey, cacheDurationMinutes = 30) {
    this.apiKey = apiKey;
    this.cacheDurationMinutes = cacheDurationMinutes;
    this.cache = new Map();
  }

  /**
   * Get weather for coordinates
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {string} placeName - Human-readable place name for context
   * @returns {Promise<object>} Normalized weather object
   */
  async getWeather(lat, lng, placeName = '') {
    if (!lat || !lng || !this.apiKey) {
      logger.warn('Missing weather params', { lat, lng, hasKey: !!this.apiKey });
      return this._emptyWeather();
    }

    const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}`;
    const cached = this._getFromCache(cacheKey);
    if (cached) {
      logger.debug('Weather cache hit', { cacheKey });
      return cached;
    }

    try {
      const raw = await this._fetchFromOpenWeatherMap(lat, lng);
      const normalized = this._normalizeWeather(raw, placeName);
      this._setInCache(cacheKey, normalized);
      return normalized;
    } catch (err) {
      logger.error('Weather fetch failed', { error: err.message, lat, lng });
      return this._emptyWeather();
    }
  }

  /**
   * Fetch from OpenWeatherMap API
   * @private
   */
  _fetchFromOpenWeatherMap(lat, lng) {
    return new Promise((resolve, reject) => {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${this.apiKey}&units=metric`;

      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode === 200) {
              resolve(parsed);
            } else {
              reject(new Error(`OpenWeatherMap returned ${res.statusCode}: ${parsed.message}`));
            }
          } catch (err) {
            reject(new Error(`Failed to parse weather response: ${err.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Normalize OpenWeatherMap response to Guardian schema
   * @private
   */
  _normalizeWeather(raw, placeName) {
    const weather = raw.weather?.[0] || {};
    const main = raw.main || {};
    const wind = raw.wind || {};

    // Determine if weather is severe (should trigger alerts)
    const isSevere = this._isSevereWeather(weather.main, main.temp);

    return {
      location: placeName || raw.name || 'Unknown location',
      lat: raw.coord?.lat,
      lng: raw.coord?.lon,
      temperature: Math.round(main.temp),
      feelsLike: Math.round(main.feels_like),
      humidity: main.humidity,
      condition: weather.main,
      description: weather.description,
      windSpeed: Math.round(wind.speed),
      cloudiness: raw.clouds?.all,
      visibility: raw.visibility,
      sunrise: raw.sys?.sunrise,
      sunset: raw.sys?.sunset,
      fetchedAt: Date.now(),

      // Guardian-specific alerts
      alerts: this._extractAlerts(weather.main, main.temp),
      severity: isSevere ? 'severe' : 'normal',

      // Raw metadata
      source: 'openweathermap',
      confidence: 0.95,
    };
  }

  /**
   * Check if weather is severe enough to alert
   * @private
   */
  _isSevereWeather(condition, temp) {
    const severeConditions = [
      'Thunderstorm',
      'Tornado',
      'Hurricane',
      'Cyclone',
      'Squall',
    ];

    const extremeHeat = temp > 35;
    const extremeCold = temp < 5;

    return (
      severeConditions.includes(condition) ||
      extremeHeat ||
      extremeCold
    );
  }

  /**
   * Extract human-readable weather alerts
   * @private
   */
  _extractAlerts(condition, temp) {
    const alerts = [];

    // Weather condition alerts
    if (condition === 'Thunderstorm') {
      alerts.push({
        type: 'severe_weather',
        message: 'Thunderstorm warning',
        urgency: 'high',
      });
    }

    if (condition === 'Rain') {
      alerts.push({
        type: 'heavy_rain',
        message: 'Heavy rain expected',
        urgency: 'medium',
      });
    }

    if (condition === 'Snow') {
      alerts.push({
        type: 'snow',
        message: 'Snow conditions',
        urgency: 'medium',
      });
    }

    // Temperature alerts
    if (temp > 35) {
      alerts.push({
        type: 'extreme_heat',
        message: `High temperature: ${Math.round(temp)}°C`,
        urgency: 'medium',
      });
    }

    if (temp < 5) {
      alerts.push({
        type: 'extreme_cold',
        message: `Low temperature: ${Math.round(temp)}°C`,
        urgency: 'medium',
      });
    }

    return alerts;
  }

  /**
   * Empty weather response (when fetch fails)
   * @private
   */
  _emptyWeather() {
    return {
      temperature: null,
      condition: 'unknown',
      alerts: [],
      severity: 'unknown',
      fetchedAt: Date.now(),
      source: 'openweathermap',
      confidence: 0.0,
      error: 'Could not fetch weather data',
    };
  }

  /**
   * Cache management
   * @private
   */
  _getFromCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.fetchedAt;
    const maxAge = this.cacheDurationMinutes * 60 * 1000;

    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  _setInCache(key, value) {
    this.cache.set(key, value);
  }

  /**
   * Clear all cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('Weather cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats() {
    return {
      entries: this.cache.size,
      maxDurationMinutes: this.cacheDurationMinutes,
    };
  }
}

module.exports = WeatherProvider;
