'use strict';

// Fixed vocabularies only. Storage exceptions may contain object paths,
// credential details, request headers and response bodies; never retain those.
const CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'EAI_AGAIN',
  'ENOTFOUND', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'FILE_NO_UPLOAD', 'FILE_NO_UPLOAD_DELETE', 'CONTENT_UPLOAD_MISMATCH',
  'DOWNLOAD_MISMATCH', 'MD5_NOT_AVAILABLE', 'ABORT_ERR',
]);
const REASONS = new Set([
  'forbidden', 'insufficientPermissions', 'authError', 'required', 'invalid',
  'notFound', 'conditionNotMet', 'conflict', 'accountDisabled', 'billingNotEnabled',
  'accessNotConfigured', 'rateLimitExceeded', 'userRateLimitExceeded',
  'backendError', 'internalError', 'retentionPolicyNotMet', 'objectUnderActiveHold',
]);
const NAMES = new Set(['Error', 'ApiError', 'RequestError', 'FetchError', 'GaxiosError',
  'TypeError', 'RangeError', 'AbortError', 'TimeoutError']);

function storageFailureDetails(error) {
  const statusCode = [error?.statusCode, error?.code, error?.status,
    error?.response?.statusCode, error?.response?.status]
    .map(value => typeof value === 'number' ? value :
      (typeof value === 'string' && /^\d{3}$/.test(value) ? Number(value) : null))
    .find(value => Number.isInteger(value) && value >= 100 && value <= 599) ?? null;
  return {
    statusCode,
    code: [error?.code, error?.cause?.code].find(value => CODES.has(value)) ?? null,
    reason: [error?.reason, error?.errors?.[0]?.reason].find(value => REASONS.has(value)) ?? null,
    name: NAMES.has(error?.name) ? error.name : null,
  };
}

function storageRuntimeDetails({ bucketName, projectId, emulatorEnabled }) {
  const bucket = typeof bucketName === 'string' && /^[a-z0-9][a-z0-9._-]{1,221}$/.test(bucketName)
    ? bucketName : null;
  const project = typeof projectId === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)
    ? projectId : null;
  return { bucket, projectId: project,
    standardProjectBucket: bucket && project
      ? [`${project}.firebasestorage.app`, `${project}.appspot.com`].includes(bucket) : null,
    emulatorEnabled: emulatorEnabled === true };
}

module.exports = { storageFailureDetails, storageRuntimeDetails };
