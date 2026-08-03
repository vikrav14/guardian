/**
 * Context relevance evaluator
 * Determines if external weather/events are relevant to a specific person
 * Uses deterministic rules before involving AI
 */

const Logger = require('../logger');

const logger = new Logger('context-evaluator');

class ContextEvaluator {
  /**
   * Evaluate if weather is relevant to a person
   * @param {object} weather - Normalized weather from weatherProvider
   * @param {object} person - Person object {age, displayName, careContext}
   * @param {object} device - Device state {online, lastSeenMinutesAgo, batteryPercent}
   * @param {object} location - Last known location {lat, lng, freshnessMinutes, accuracyClass}
   * @returns {object} Evaluation result with relevance, severity, reasoning
   */
  evaluateWeatherRelevance(weather, person, device, location) {
    const result = {
      relevant: false,
      severity: 'none',
      reasons: [],
      uncertainty: [],
      deviceState: {
        online: device?.online,
        lastSeenMinutes: device?.lastSeenMinutesAgo,
        battery: device?.batteryPercent,
      },
      locationFreshness: location?.freshnessMinutes,
      message: null,
    };

    // If no severe weather, not relevant
    if (!weather?.alerts?.length || weather.severity !== 'severe') {
      result.message = `No significant local concerns detected. Weather: ${weather?.temperature}°C, ${weather?.condition || 'unknown'}.`;
      return result;
    }

    // Check location freshness - critical for relevance
    const locationFresh = location?.freshnessMinutes <= 15;
    if (location?.freshnessMinutes > 30) {
      result.uncertainty.push(`Location is stale (${location.freshnessMinutes} mins old)`);
    }

    // Check device connectivity
    const deviceOnline = device?.online;
    if (!deviceOnline) {
      result.uncertainty.push('Device is offline - cannot confirm current location');
    }

    // Age-based relevance adjustments
    const ageGroup = this._getAgeGroup(person?.age);
    const isVulnerable = ageGroup === 'child' || ageGroup === 'elderly';

    // Evaluate each alert
    for (const alert of weather.alerts) {
      const alertRelevance = this._evaluateAlertType(
        alert.type,
        ageGroup,
        location?.accuracyClass,
        locationFresh
      );

      if (alertRelevance.relevant) {
        result.relevant = true;
        result.severity = Math.max(
          result.severity === 'none' ? 0 : this._severityScore(result.severity),
          this._severityScore(alertRelevance.severity)
        );
        result.reasons.push(...alertRelevance.reasons);
      }
    }

    // Convert severity score back to string
    if (typeof result.severity === 'number') {
      result.severity = this._severityFromScore(result.severity);
    }

    // Generate message if relevant
    if (result.relevant) {
      result.message = this._generateMessage(weather, person, location, result);
    }

    logger.info('Weather relevance evaluated', {
      person: person?.displayName,
      relevant: result.relevant,
      severity: result.severity,
    });

    return result;
  }

  /**
   * Evaluate a specific alert type
   * @private
   */
  _evaluateAlertType(alertType, ageGroup, accuracyClass, locationFresh) {
    const result = {
      relevant: false,
      severity: 'none',
      reasons: [],
    };

    switch (alertType) {
      case 'severe_weather':
        result.relevant = true;
        result.severity = locationFresh ? 'check_in' : 'info';
        result.reasons.push('Severe weather applies to area');
        if (ageGroup === 'child') {
          result.reasons.push('Child may need shelter/supervision');
        }
        break;

      case 'heavy_rain':
        result.relevant = true;
        result.severity = locationFresh ? 'check_in' : 'info';
        result.reasons.push('Heavy rain expected');
        if (accuracyClass === 'approximate') {
          result.reasons.push('Location is approximate - verify before alerting');
        }
        break;

      case 'extreme_heat':
        // Only relevant for vulnerable populations
        if (ageGroup === 'elderly' || ageGroup === 'child') {
          result.relevant = true;
          result.severity = 'check_in';
          result.reasons.push(`Heat exposure risk for ${ageGroup}`);
        }
        break;

      case 'extreme_cold':
        if (ageGroup === 'elderly' || ageGroup === 'child') {
          result.relevant = true;
          result.severity = 'check_in';
          result.reasons.push(`Cold exposure risk for ${ageGroup}`);
        }
        break;

      default:
        break;
    }

    return result;
  }

  /**
   * Determine age group from birth year or age
   * @private
   */
  _getAgeGroup(age) {
    if (!age) return 'unknown';
    if (age < 13) return 'child';
    if (age < 18) return 'teenager';
    if (age < 65) return 'adult';
    return 'elderly';
  }

  /**
   * Convert severity string to numeric score
   * @private
   */
  _severityScore(severity) {
    const scores = {
      none: 0,
      info: 1,
      useful_information: 2,
      check_in: 3,
      urgent: 4,
    };
    return scores[severity] || 0;
  }

  /**
   * Convert severity score back to string
   * @private
   */
  _severityFromScore(score) {
    const severities = ['none', 'info', 'useful_information', 'check_in', 'urgent'];
    return severities[Math.min(score, severities.length - 1)];
  }

  /**
   * Generate human-readable message
   * @private
   */
  _generateMessage(weather, person, location, result) {
    const displayName = person?.displayName || 'they';
    const placeName = location?.placeName || 'this area';
    const temperature = weather.temperature ? ` (${weather.temperature}°C)` : '';

    // Determine alert type for better messaging
    let alertLabel = weather.condition;
    if (weather.alerts?.length > 0) {
      const alert = weather.alerts[0];
      if (alert.type === 'extreme_heat') {
        alertLabel = 'Heat';
      } else if (alert.type === 'extreme_cold') {
        alertLabel = 'Cold';
      }
    }

    let message = '';

    const hasStaleLocation = result.uncertainty.some(u => u.startsWith('Location is stale'));
    const hasOfflineDevice = result.uncertainty.some(u => u.includes('Device is offline'));

    if (hasStaleLocation) {
      message = `A ${alertLabel} warning applies to ${displayName}'s last known area (${placeName}). `;
      message += `Guardian has not received a fresh location for ${location.freshnessMinutes} minutes.`;
    } else if (hasOfflineDevice) {
      message = `A ${alertLabel} warning may affect ${displayName}'s area (${placeName}). `;
      message += `The device is currently offline${temperature}.`;
    } else {
      message = `${alertLabel} may affect ${displayName}'s area (${placeName})${temperature}. `;
      message += `${displayName} appears to be there and the pendant is online.`;
    }

    return message;
  }
}

module.exports = ContextEvaluator;
