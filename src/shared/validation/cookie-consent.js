// ── Consent payload normalization ──────────────────────────────────────────
// Consent is product metadata, not an arbitrary client-side storage bucket.
// Keep the persisted/logged representation deliberately small and predictable
// so a request cannot turn it into an unbounded JSONB/security-log write.

const CONSENT_KEYS = new Set(["necessary", "analytics", "version", "consentedAt"]);
const MAX_CONSENT_VERSION_LENGTH = 64;

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function defaultConsent(now = new Date()) {
  return {
    necessary: true,
    analytics: false,
    consentedAt: now.toISOString()
  };
}

/**
 * Return a compact, server-timestamped consent record, or null for a malformed
 * supplied value. A missing value is a valid opt-out of optional analytics.
 */
function normalizeCookieConsent(value, { now = new Date() } = {}) {
  if (value == null) return defaultConsent(now);
  if (!isPlainRecord(value)) return null;
  if (Object.keys(value).some((key) => !CONSENT_KEYS.has(key))) return null;
  if (value.necessary !== undefined && value.necessary !== true) return null;
  if (value.analytics !== undefined && typeof value.analytics !== "boolean") return null;

  let version = null;
  if (value.version !== undefined) {
    if (typeof value.version !== "string") return null;
    version = value.version.trim();
    if (!version || version.length > MAX_CONSENT_VERSION_LENGTH) return null;
  }

  // The server, rather than a device clock or client-controlled payload,
  // records the legal timestamp. `consentedAt` is accepted only as a legacy
  // input key and deliberately not persisted as supplied.
  return {
    necessary: true,
    analytics: value.analytics === true,
    ...(version ? { version } : {}),
    consentedAt: now.toISOString()
  };
}

module.exports = {
  MAX_CONSENT_VERSION_LENGTH,
  defaultConsent,
  normalizeCookieConsent
};
