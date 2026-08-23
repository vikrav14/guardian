/**
 * JSON Schema definitions for context intelligence
 * Used for validation and type safety
 */

const weatherSchema = {
  type: 'object',
  properties: {
    location: { type: 'string' },
    temperature: { type: ['number', 'null'] },
    feelsLike: { type: ['number', 'null'] },
    condition: { type: 'string' },
    description: { type: 'string' },
    humidity: { type: ['number', 'null'] },
    windSpeed: { type: ['number', 'null'] },
    cloudiness: { type: ['number', 'null'] },
    alerts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          message: { type: 'string' },
          urgency: { type: 'string' },
        },
        required: ['type', 'message'],
      },
    },
    severity: { type: 'string', enum: ['normal', 'severe', 'unknown'] },
    fetchedAt: { type: 'number' },
    source: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['condition', 'alerts', 'severity', 'fetchedAt', 'source'],
};

const contextEvaluationSchema = {
  type: 'object',
  properties: {
    relevant: { type: 'boolean' },
    severity: { type: 'string', enum: ['none', 'info', 'useful_information', 'check_in', 'urgent'] },
    reasons: {
      type: 'array',
      items: { type: 'string' },
    },
    uncertainty: {
      type: 'array',
      items: { type: 'string' },
    },
    deviceState: {
      type: 'object',
      properties: {
        online: { type: 'boolean' },
        lastSeenMinutes: { type: 'number' },
        battery: { type: 'number' },
      },
    },
    locationFreshness: { type: 'number' },
    message: { type: ['string', 'null'] },
  },
  required: ['relevant', 'severity', 'message'],
};

const officialAlertSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    externalId: { type: 'string' },
    active: { type: 'boolean' },
    eventType: { type: 'string' },
    headline: { type: 'string' },
    urgency: { type: 'string' },
    severity: { type: 'string' },
    certainty: { type: 'string' },
    effectiveAt: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] },
  },
  required: ['id', 'active', 'eventType', 'severity'],
};

const deviceContextSchema = {
  type: 'object',
  properties: {
    device: {
      type: 'object',
      properties: {
        online: { type: 'boolean' },
        lastSeenAt: { type: 'string' },
        batteryPercent: { type: ['number', 'null'] },
      },
      required: ['online'],
    },
    location: {
      type: 'object',
      properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
        placeName: { type: 'string' },
        freshnessMinutes: { type: 'number' },
        accuracyClass: { type: 'string', enum: ['precise', 'good', 'approximate', 'unknown'] },
      },
      required: ['lat', 'lng', 'placeName'],
    },
    weather: weatherSchema,
    officialAlerts: {
      type: 'array',
      items: officialAlertSchema,
    },
    deterministicEvaluation: contextEvaluationSchema,
    contextEvaluation: contextEvaluationSchema,
    contextDecision: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        relevant: { type: 'boolean' },
        confidence: { type: 'number' },
        recommendedSurface: {
          type: 'string',
          enum: ['suppress', 'app', 'whatsapp_template'],
        },
        recommendedAction: {
          type: 'string',
          enum: ['none', 'check_in', 'call_watch', 'monitor_battery'],
        },
        reason: { type: 'string' },
        observeOnly: { type: 'boolean' },
      },
      required: [
        'mode',
        'relevant',
        'recommendedSurface',
        'recommendedAction',
        'observeOnly',
      ],
    },
    delivery: {
      type: 'object',
      properties: {
        mode: { type: 'string' },
        sent: { type: 'boolean' },
      },
      required: ['mode', 'sent'],
    },
    fetchedAt: { type: 'string' },
  },
  required: ['device', 'location', 'weather', 'contextEvaluation', 'fetchedAt'],
};

/**
 * Validate an object against a schema (simplified validation)
 */
function validateSchema(obj, schema) {
  if (!obj || !schema) {
    return { valid: false, errors: ['Missing object or schema'] };
  }

  const errors = [];

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (obj[field] === undefined || obj[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  // Check field types and nested required fields
  if (schema.properties) {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      if (obj[field] !== undefined && obj[field] !== null) {
        if (typeof fieldSchema === 'object' && fieldSchema.type) {
          const expectedType = fieldSchema.type;
          const actualType = typeof obj[field];

          if (Array.isArray(expectedType)) {
            if (!expectedType.includes(actualType)) {
              errors.push(`Field ${field}: expected ${expectedType.join(' or ')}, got ${actualType}`);
            }
          } else if (expectedType === 'array') {
            if (!Array.isArray(obj[field])) {
              errors.push(`Field ${field}: expected array, got ${actualType}`);
            }
          } else if (expectedType === 'object') {
            if (typeof obj[field] !== 'object' || Array.isArray(obj[field])) {
              errors.push(`Field ${field}: expected object, got ${actualType}`);
            } else if (fieldSchema.required && obj[field]) {
              // Check nested required fields
              for (const nestedField of fieldSchema.required) {
                if (obj[field][nestedField] === undefined) {
                  errors.push(`Field ${field}.${nestedField}: required but missing`);
                }
              }
            }
          } else if (actualType !== expectedType) {
            errors.push(`Field ${field}: expected ${expectedType}, got ${actualType}`);
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

module.exports = {
  weatherSchema,
  officialAlertSchema,
  contextEvaluationSchema,
  deviceContextSchema,
  validateSchema,
};
