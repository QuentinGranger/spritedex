"use strict";

const { pool } = require("./shared");

const COMPARE_SHARE_DURATIONS = new Set(["1h", "24h", "7d", "permanent"]);

function parseCompareShareOptions(value) {
  const body = value == null ? {} : value;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Options de partage invalides" };
  }
  const allowed = new Set([
    "duration", "collectionVisible", "showNotes", "showPriorities", "allowVisitorCompare"
  ]);
  if (Object.keys(body).some(key => !allowed.has(key))) {
    return { ok: false, error: "Option de partage invalide" };
  }
  const duration = body.duration === undefined ? "24h" : body.duration;
  if (typeof duration !== "string" || !COMPARE_SHARE_DURATIONS.has(duration)) {
    return { ok: false, error: "Durée de partage invalide" };
  }
  for (const key of ["collectionVisible", "showNotes", "showPriorities", "allowVisitorCompare"]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") {
      return { ok: false, error: "Option de partage invalide" };
    }
  }
  return {
    ok: true,
    value: {
      duration,
      collectionVisible: body.collectionVisible !== false,
      showNotes: body.showNotes === true,
      showPriorities: body.showPriorities !== false,
      allowVisitorCompare: body.allowVisitorCompare !== false
    }
  };
}

function computeDurationExpiry(duration) {
  const now = Date.now();
  if (duration === "1h") return new Date(now + 60 * 60 * 1000).toISOString();
  if (duration === "24h") return new Date(now + 24 * 60 * 60 * 1000).toISOString();
  if (duration === "7d") return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

async function loadCollectionForShare(userId, options) {
  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  // See loadServerCompareCollection: shared links must also serialize legacy
  // collection keys without invoking Object.prototype's __proto__ setter.
  const collection = Object.create(null);
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: options.show_notes ? (row.note || "") : "",
      priority: options.show_priorities ? (row.priority || "none") : "none",
      obtainedAt: row.obtained_at || null
    };
  }
  return collection;
}


module.exports = { parseCompareShareOptions, computeDurationExpiry, loadCollectionForShare, COMPARE_SHARE_DURATIONS };
