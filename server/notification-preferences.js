// ── SPRITE-INDEX notification preferences ─────────────────────────────────────
// Étape 6: precedence between the general channel, a category and a precise
// type. A notification is only allowed to be SENT (push / email) when ALL three
// levels are enabled:
//   1. the general channel   (users.push_enabled)
//   2. its category          (notification_preferences scope='category')
//   3. its precise type      (notification_preferences scope='type')
//
// Étape 50 — frequency (scope='frequency', value=immediate|daily_digest|disabled)
// gates whether a type fires at all and when friend acquisitions are flushed.
//
// The database row is always stored first (Étape 3): these preferences gate the
// external delivery, not the in-app inbox entry. Preferences are opt-out: the
// absence of a row means "enabled" / default frequency.

const catalog = require("./notification-catalog");

async function ensureNotificationPreferencesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      scope VARCHAR(20) NOT NULL,       -- 'category' | 'type' | 'channel' | 'frequency'
      key VARCHAR(80) NOT NULL,         -- category id, type id, channel id
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      value TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, scope, key)
    );
    CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences (user_id);
  `);
  await pool.query(`
    ALTER TABLE notification_preferences
      ADD COLUMN IF NOT EXISTS value TEXT
  `);
}

// Pure precedence rule (Étape 6). Undefined/absent preferences default to
// enabled (opt-out). Returns true only when every level is enabled.
function evaluateDelivery({ pushEnabled, categoryEnabled, typeEnabled } = {}) {
  return pushEnabled !== false && categoryEnabled !== false && typeEnabled !== false;
}

function evaluateTypeActive({ typeEnabled, frequency } = {}) {
  if (frequency === catalog.NOTIFICATION_FREQUENCIES.DISABLED) return false;
  return typeEnabled !== false;
}

// Resolves whether a notification may be delivered to a user, applying the
// three-level precedence. `pushEnabled` and `category` may be passed in to
// avoid extra lookups (createNotification already has them).
async function isDeliveryAllowed(pool, userId, type, { pushEnabled, category } = {}) {
  if (pushEnabled === false) return false;
  const resolved = await resolveChannelPreferences(pool, userId, type, { category });
  if (!evaluateTypeActive(resolved)) return false;
  return evaluateDelivery({
    pushEnabled,
    categoryEnabled: resolved.categoryEnabled,
    typeEnabled: resolved.typeEnabled
  });
}

// Resolves the subject (category+type) gates, per-channel toggles and frequency
// for a single notification, in one query.
async function resolveChannelPreferences(pool, userId, type, { category } = {}) {
  const cat = category || catalog.getCategory(type) || null;
  const defaults = catalog.getDefaultTypeDelivery(type);
  const res = await pool.query(
    `SELECT scope, key, enabled, value FROM notification_preferences
     WHERE user_id = $1 AND (
       (scope = 'category' AND key = $2) OR
       (scope = 'type' AND key = $3) OR
       (scope = 'frequency' AND key = $3) OR
       (scope = 'type_in_app' AND key = $3) OR
       (scope = 'type_push' AND key = $3) OR
       scope = 'channel'
     )`,
    [userId, cat || "", type || ""]
  );

  let categoryEnabled = true;
  let typeEnabled = true;
  let frequency = catalog.getDefaultFrequency(type);
  let inApp = defaults.inApp !== false;
  let pushMode = defaults.push;
  const channelPrefs = {};
  for (const ch of catalog.NOTIFICATION_CHANNEL_LIST) channelPrefs[ch] = true;

  for (const row of res.rows) {
    if (row.scope === "category" && row.key === cat) categoryEnabled = row.enabled;
    else if (row.scope === "type" && row.key === type) typeEnabled = row.enabled;
    else if (row.scope === "frequency" && row.key === type) {
      frequency = catalog.normalizeFrequency(row.value, type);
    } else if (row.scope === "type_in_app" && row.key === type) {
      inApp = row.enabled !== false;
    } else if (row.scope === "type_push" && row.key === type) {
      pushMode = catalog.normalizePushMode(row.value, type);
    } else if (row.scope === "channel" && row.key in channelPrefs) {
      channelPrefs[row.key] = row.enabled;
    }
  }

  // Frequency "disabled" wins over a leftover type toggle.
  if (frequency === catalog.NOTIFICATION_FREQUENCIES.DISABLED) {
    typeEnabled = false;
  }
  // Étape 51 — turning off in-app for a type disables the subject.
  if (inApp === false) {
    typeEnabled = false;
  }

  return {
    categoryEnabled,
    typeEnabled,
    channelPrefs,
    frequency,
    inApp,
    pushMode,
    delivery: { inApp, push: pushMode }
  };
}

function defaultFrequencies() {
  const out = {};
  for (const type of catalog.FREQUENCY_CONFIGURABLE_TYPES) {
    out[type] = catalog.getDefaultFrequency(type);
  }
  return out;
}

// Returns the fully-resolved preference matrix for a user, defaulting every
// known category/type/channel to enabled. `pushEnabled` reflects push consent.
async function getPreferences(pool, userId) {
  const { normalizeTimeZone, DEFAULT_TIMEZONE } = require("./timezone");
  const userRes = await pool.query(
    `SELECT push_enabled, push_quiet_start, push_quiet_end, push_max_per_day, timezone
     FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const u = userRes.rows[0] || {};
  const pushEnabled = u.push_enabled !== false;
  const timeZone = normalizeTimeZone(u.timezone || DEFAULT_TIMEZONE);

  const categories = {};
  for (const c of catalog.NOTIFICATION_CATEGORY_LIST) categories[c] = true;
  const types = {};
  for (const t of catalog.CONTEXTUAL_NOTIFICATION_TYPES) types[t] = true;
  const channels = {};
  for (const ch of catalog.NOTIFICATION_CHANNEL_LIST) channels[ch] = true;
  const frequencies = defaultFrequencies();
  const delivery = defaultTypeDelivery();

  const res = await pool.query("SELECT scope, key, enabled, value FROM notification_preferences WHERE user_id = $1", [
    userId
  ]);
  for (const row of res.rows) {
    if (row.scope === "category" && row.key in categories) categories[row.key] = row.enabled;
    else if (row.scope === "type" && row.key in types) types[row.key] = row.enabled;
    else if (row.scope === "channel" && row.key in channels) channels[row.key] = row.enabled;
    else if (row.scope === "frequency" && row.key in frequencies) {
      frequencies[row.key] = catalog.normalizeFrequency(row.value, row.key);
    } else if (row.scope === "type_in_app" && delivery[row.key]) {
      delivery[row.key].inApp = row.enabled !== false;
    } else if (row.scope === "type_push" && delivery[row.key]) {
      delivery[row.key].push = catalog.normalizePushMode(row.value, row.key);
    }
  }

  // Keep type toggles aligned with frequency=disabled / in-app off for settings UI.
  for (const [type, freq] of Object.entries(frequencies)) {
    if (freq === catalog.NOTIFICATION_FREQUENCIES.DISABLED) types[type] = false;
  }
  for (const [type, d] of Object.entries(delivery)) {
    if (d.inApp === false) types[type] = false;
    else if (types[type] !== false) types[type] = true;
  }

  return {
    pushEnabled,
    categories,
    types,
    channels,
    frequencies,
    delivery,
    quietHours: {
      start: u.push_quiet_start ?? null,
      end: u.push_quiet_end ?? null
    },
    timeZone,
    timezone: timeZone,
    maxPushPerDay: catalog.resolvePushDailyLimit(
      u.push_max_per_day == null ? catalog.DEFAULT_PUSH_MAX_PER_DAY : u.push_max_per_day
    ),
    pushDailyLimitExemptTypes: [...catalog.PUSH_DAILY_LIMIT_EXEMPT_TYPES]
  };
}

function defaultTypeDelivery() {
  const out = {};
  for (const type of catalog.CONTEXTUAL_NOTIFICATION_TYPES) {
    const d = catalog.getDefaultTypeDelivery(type);
    out[type] = { inApp: d.inApp !== false, push: d.push };
  }
  return out;
}

// Upserts a single preference. Validates scope/key against the catalog.
async function setPreference(pool, userId, scope, key, enabled) {
  if (scope === "category" && !catalog.isKnownCategory(key)) return false;
  if (scope === "type" && !catalog.isKnownType(key)) return false;
  if (scope === "channel" && !catalog.isKnownChannel(key)) return false;
  if (scope !== "category" && scope !== "type" && scope !== "channel") return false;
  await pool.query(
    `INSERT INTO notification_preferences (user_id, scope, key, enabled, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, scope, key)
     DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
    [userId, scope, key, !!enabled]
  );
  return true;
}

async function setFrequency(pool, userId, type, frequency) {
  if (!catalog.isFrequencyConfigurable(type)) return false;
  const freq = catalog.normalizeFrequency(frequency, type);
  await pool.query(
    `INSERT INTO notification_preferences (user_id, scope, key, enabled, value, updated_at)
     VALUES ($1, 'frequency', $2, $3, $4, NOW())
     ON CONFLICT (user_id, scope, key)
     DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value, updated_at = NOW()`,
    [userId, type, freq !== catalog.NOTIFICATION_FREQUENCIES.DISABLED, freq]
  );
  // Mirror onto the type toggle so older gates keep working.
  await setPreference(pool, userId, "type", type, freq !== catalog.NOTIFICATION_FREQUENCIES.DISABLED);
  return true;
}

async function getTypeFrequency(pool, userId, type) {
  if (!catalog.isFrequencyConfigurable(type)) {
    return catalog.getDefaultFrequency(type);
  }
  const res = await pool.query(
    `SELECT value FROM notification_preferences
     WHERE user_id = $1 AND scope = 'frequency' AND key = $2`,
    [userId, type]
  );
  if (!res.rows.length) return catalog.getDefaultFrequency(type);
  return catalog.normalizeFrequency(res.rows[0].value, type);
}

async function setTypeDelivery(pool, userId, type, { inApp, push } = {}) {
  if (!catalog.isKnownType(type)) return false;
  if (typeof inApp === "boolean") {
    await pool.query(
      `INSERT INTO notification_preferences (user_id, scope, key, enabled, updated_at)
       VALUES ($1, 'type_in_app', $2, $3, NOW())
       ON CONFLICT (user_id, scope, key)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = NOW()`,
      [userId, type, inApp]
    );
    await setPreference(pool, userId, "type", type, inApp);
  }
  if (push != null) {
    const mode = catalog.normalizePushMode(push, type);
    await pool.query(
      `INSERT INTO notification_preferences (user_id, scope, key, enabled, value, updated_at)
       VALUES ($1, 'type_push', $2, $3, $4, NOW())
       ON CONFLICT (user_id, scope, key)
       DO UPDATE SET enabled = EXCLUDED.enabled, value = EXCLUDED.value, updated_at = NOW()`,
      [userId, type, mode !== catalog.PUSH_MODES.DISABLED, mode]
    );
  }
  return true;
}

async function getTypeDelivery(pool, userId, type) {
  const resolved = await resolveChannelPreferences(pool, userId, type);
  return resolved.delivery || catalog.getDefaultTypeDelivery(type);
}

module.exports = {
  ensureNotificationPreferencesTable,
  evaluateDelivery,
  evaluateTypeActive,
  isDeliveryAllowed,
  resolveChannelPreferences,
  getPreferences,
  setPreference,
  setFrequency,
  getTypeFrequency,
  setTypeDelivery,
  getTypeDelivery,
  defaultFrequencies,
  defaultTypeDelivery
};
