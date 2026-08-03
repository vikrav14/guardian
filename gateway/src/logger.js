/**
 * Structured logging with context and levels.
 */

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const LEVEL_NAME = {
  0: 'DEBUG',
  1: 'INFO',
  2: 'WARN',
  3: 'ERROR',
};

class Logger {
  constructor(context = {}) {
    this.context = { ...context };
    this.minLevel = process.env.LOG_LEVEL ? LOG_LEVELS[process.env.LOG_LEVEL] : LOG_LEVELS.INFO;
  }

  setCorrelationId(id) {
    this.context.correlationId = id;
    return this;
  }

  withContext(ctx) {
    return new Logger({ ...this.context, ...ctx });
  }

  _format(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const levelName = LEVEL_NAME[level];

    const contextStr = Object.entries(this.context)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');

    const dataStr = Object.keys(data).length > 0 ? JSON.stringify(data) : '';

    return `[${timestamp}] [${levelName}] ${contextStr} ${message} ${dataStr}`.trim();
  }

  debug(message, data) {
    if (this.minLevel <= LOG_LEVELS.DEBUG) {
      console.debug(this._format(LOG_LEVELS.DEBUG, message, data));
    }
  }

  info(message, data) {
    if (this.minLevel <= LOG_LEVELS.INFO) {
      console.log(this._format(LOG_LEVELS.INFO, message, data));
    }
  }

  warn(message, data) {
    if (this.minLevel <= LOG_LEVELS.WARN) {
      console.warn(this._format(LOG_LEVELS.WARN, message, data));
    }
  }

  error(message, data) {
    if (this.minLevel <= LOG_LEVELS.ERROR) {
      console.error(this._format(LOG_LEVELS.ERROR, message, data));
    }
  }
}

module.exports = Logger;
