// catalog.js — extracted from server.js

const { pool } = require("./db");

// ── Stable catalog ID helpers ──
// Collections are keyed by the stable variant id (e.g. sprite_water_holofoil).
// Each entry also carries its base sprite_id (e.g. sprite_water) so the system
// never depends on display names or a "::" separator for matching.
let catalogIdMapCache = null;
let catalogIdMapCacheTs = 0;
const CATALOG_MAP_TTL = 30_000;

async function getCatalogIdMaps() {
  const now = Date.now();
  if (catalogIdMapCache && (now - catalogIdMapCacheTs) < CATALOG_MAP_TTL) {
    return catalogIdMapCache;
  }
  const [variants, sprites] = await Promise.all([
    pool.query("SELECT id, sprite_id, variant_type FROM sprite_variants"),
    pool.query("SELECT id, slug FROM sprites")
  ]);
  const variantMap = {};
  const typeToVariantId = {};
  const spriteBySlug = {};
  const spriteById = {};
  for (const row of variants.rows) {
    variantMap[row.id] = { spriteId: row.sprite_id, type: row.variant_type };
    typeToVariantId[`${row.sprite_id}::${row.variant_type}`] = row.id;
  }
  for (const row of sprites.rows) {
    spriteById[row.id] = row.id;
    if (row.slug) spriteBySlug[row.slug] = row.id;
  }
  catalogIdMapCache = { variantMap, typeToVariantId, spriteBySlug, spriteById };
  catalogIdMapCacheTs = now;
  return catalogIdMapCache;
}

function normalizeVariantIdWithMaps(raw, maps) {
  if (!raw || typeof raw !== "string") return { variantId: raw, spriteId: null };
  if (raw.startsWith("fav_")) return { variantId: raw, spriteId: null };

  // Already a stable variant id
  if (maps.variantMap[raw]) {
    return { variantId: raw, spriteId: maps.variantMap[raw].spriteId };
  }

  // Already a base sprite id (or slug resolves to one): the base variant
  const baseFromId = maps.spriteById[raw];
  if (baseFromId) return { variantId: raw, spriteId: baseFromId };
  if (maps.spriteBySlug[raw]) {
    const sid = maps.spriteBySlug[raw];
    return { variantId: sid, spriteId: sid };
  }

  // Legacy composite "base::VariantType"
  const sepIndex = raw.indexOf("::");
  if (sepIndex !== -1) {
    const baseRaw = raw.slice(0, sepIndex);
    const typeRaw = raw.slice(sepIndex + 2);
    const baseId = maps.spriteById[baseRaw] || maps.spriteBySlug[baseRaw] || baseRaw;
    const key = `${baseId}::${typeRaw}`;
    if (maps.typeToVariantId[key]) {
      return { variantId: maps.typeToVariantId[key], spriteId: baseId };
    }
    // Case-insensitive variant type match
    for (const [k, vid] of Object.entries(maps.typeToVariantId)) {
      const [b, t] = k.split("::");
      if (b === baseId && t.toLowerCase() === typeRaw.toLowerCase()) {
        return { variantId: vid, spriteId: baseId };
      }
    }
    // Unknown variant: keep a stable-looking composite id
    return { variantId: `${baseId}::${typeRaw}`, spriteId: baseId };
  }

  return { variantId: raw, spriteId: raw };
}

async function normalizeVariantId(raw) {
  const maps = await getCatalogIdMaps();
  return normalizeVariantIdWithMaps(raw, maps);
}

async function normalizeCollection(collection) {
  const maps = await getCatalogIdMaps();
  const normalized = {};
  for (const [rawKey, entry] of Object.entries(collection)) {
    if (rawKey.startsWith("fav_")) { normalized[rawKey] = entry; continue; }
    const { variantId, spriteId } = normalizeVariantIdWithMaps(rawKey, maps);
    normalized[variantId] = { ...entry, spriteId };
  }
  return normalized;
}

// Backward-compatible alias
async function normalizeSpriteEntryId(spriteId) {
  const { variantId } = await normalizeVariantId(spriteId);
  return variantId;
}

const ACQUISITION_TYPES = new Set(["quest", "event", "exploration", "interaction", "reward", "challenge", "purchase", "automatic", "unknown"]);

function normalizeAcquisitionType(type) {
  if (!type) return "unknown";
  const lower = String(type).toLowerCase();
  if (ACQUISITION_TYPES.has(lower)) return lower;
  if (lower === "in_game" || lower === "ingame" || lower === "world" || lower === "spawn") return "exploration";
  if (lower === "shop" || lower === "store" || lower === "buy" || lower === "bought") return "purchase";
  if (lower === "mission" || lower === "questline") return "quest";
  if (lower === "battlepass" || lower === "pass" || lower === "bp") return "reward";
  if (lower === "minigame" || lower === "boss" || lower === "vault") return "challenge";
  if (lower === "npc" || lower === "character" || lower === "merchant") return "interaction";
  return "unknown";
}

function buildAcquisitionMethod(acquisition) {
  const a = acquisition || {};
  return {
    type: normalizeAcquisitionType(a.type),
    description: a.descriptionFr || a.descriptionEn || a.description || null,
    location: a.location || null,
    requirements: Array.isArray(a.requirements) ? a.requirements : [],
    confidence: a.confidence || "unknown",
  };
}

const HONEST_AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);

function normalizeAvailabilityStatus(status, startDate, endDate) {
  const s = (status || "").toLowerCase();
  if (HONEST_AVAILABILITY_STATUSES.has(s)) return s;

  const now = new Date().toISOString();
  const start = startDate ? new Date(startDate).toISOString() : null;
  const end = endDate ? new Date(endDate).toISOString() : null;

  if (s === "available" || s === "active" || s === "live") {
    if (end && end < now) return "ended";
    return "available";
  }
  if (s === "unreleased" || s === "coming_soon" || s === "soon") {
    if (start && start > now) return "upcoming";
    return "unknown";
  }
  if (s === "unavailable" || s === "inactive" || s === "discontinued" || s === "expired" || s === "removed" || s === "over") {
    if (end && end < now) return "ended";
    return "not_observed";
  }
  if (s === "not_observed" || s === "missing" || s === "not_seen") return "not_observed";

  if (end && end < now) return "ended";
  if (start && start > now) return "upcoming";
  return "unknown";
}

function buildAvailability(availability) {
  const a = availability || {};
  return {
    status: normalizeAvailabilityStatus(a.status, a.startDate, a.endDate),
    startDate: a.startDate || null,
    endDate: a.endDate || null,
    recurrence: a.recurrence || "unknown",
    confidence: a.confidence || "unknown",
  };
}

const RECURRENCE_STATUSES = new Set(["confirmed_recurring", "possible_return", "not_confirmed", "unknown"]);

function normalizeRecurrenceStatus(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "_");
  if (RECURRENCE_STATUSES.has(s)) return s;
  if (s.includes("recurring") || s.includes("confirmed_return") || s === "yes") return "confirmed_recurring";
  if (s.includes("possible") || s.includes("maybe") || s.includes("return")) return "possible_return";
  if (s.includes("never") || s.includes("not_confirmed") || s.includes("no_return") || s.includes("exclusive")) return "not_confirmed";
  return "unknown";
}

function buildRecurrence(recurrence) {
  if (recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)) {
    return {
      status: normalizeRecurrenceStatus(recurrence.status),
      officiallyConfirmed: !!recurrence.officiallyConfirmed,
      evidence: recurrence.evidence || null,
    };
  }
  const status = normalizeRecurrenceStatus(recurrence);
  return {
    status,
    officiallyConfirmed: status === "confirmed_recurring",
    evidence: null,
  };
}

function buildDates(dates, firstObservedAt, lastVerifiedAt, officiallyAnnouncedAt) {
  const d = dates || {};
  return {
    firstObservedAt: d.firstObservedAt || firstObservedAt || null,
    officiallyAnnouncedAt: d.officiallyAnnouncedAt || officiallyAnnouncedAt || null,
    lastVerifiedAt: d.lastVerifiedAt || lastVerifiedAt || null,
  };
}

const VALID_DATA_STATUSES = new Set(["complete", "incomplete", "needs_review", "unverified", "disputed", "archived"]);

function normalizeDataStatus(status, missingFields = []) {
  let s = (status || "").toLowerCase();
  if (!VALID_DATA_STATUSES.has(s)) {
    if (s === "confirmed") s = "complete";
    else if (s === "observed") s = "unverified";
    else if (s === "legacy") s = "archived";
    else if (missingFields.length > 0) s = "incomplete";
    else s = "complete";
  }
  if (s === "complete" && missingFields.length > 0) s = "incomplete";
  return s;
}

function computeMissingFields(sprite) {
  const missing = [];
  const a = sprite.acquisitionMethod || sprite.acquisition || {};
  const av = sprite.availability || {};
  const r = sprite.recurrence || {};
  const d = sprite.dates || {};

  if (!sprite.officialName) missing.push("officialName");
  if (!sprite.seasonId) missing.push("seasonId");
  if (!sprite.image) missing.push("image");
  if (a.type === "unknown") missing.push("acquisitionMethod.type");
  if (!a.description) missing.push("acquisitionMethod.description");
  if (av.status === "unknown") missing.push("availability.status");
  if (!av.startDate && av.status !== "unknown" && av.status !== "upcoming") missing.push("availability.startDate");
  if (av.status === "ended" && !av.endDate) missing.push("availability.endDate");
  if (r.status === "unknown") missing.push("recurrence.status");
  if (!d.firstObservedAt) missing.push("dates.firstObservedAt");
  if (!d.lastVerifiedAt) missing.push("dates.lastVerifiedAt");
  if (!d.officiallyAnnouncedAt) missing.push("dates.officiallyAnnouncedAt");
  if (!Array.isArray(sprite.sources) || sprite.sources.length === 0) missing.push("sources");
  if (!Array.isArray(sprite.availabilityPeriods) || sprite.availabilityPeriods.length === 0) missing.push("availabilityPeriods");

  return missing;
}

function inferSourceType(sourceId) {
  const s = (sourceId || "").toLowerCase();
  if (s.includes("official") || s.includes("epic") || s.includes("fortnite.com") || s.includes("fortnite-api")) return "official";
  if (s.includes("in_game") || s.includes("observed")) return "in_game";
  if (s.includes("creator") || s.includes("youtuber") || s.includes("streamer")) return "creator";
  if (s.includes("community") || s.includes("discord") || s.includes("reddit")) return "community";
  if (s.includes("gg") || s.includes("database") || s.includes("wiki")) return "database";
  return "unknown";
}

function inferSourceReliability(type) {
  if (type === "official") return "primary";
  if (type === "in_game") return "primary";
  if (type === "creator") return "secondary";
  if (type === "community") return "secondary";
  if (type === "database") return "tertiary";
  return "unknown";
}

async function ensureSource(sourceId, options = {}) {
  if (!sourceId) return;
  const type = options.type || inferSourceType(sourceId);
  const reliability = options.reliability || inferSourceReliability(type);
  const title = options.title || sourceId;
  const publisher = options.publisher || null;
  const url = options.url || null;
  const publishedAt = options.publishedAt || null;
  const observedAt = options.observedAt || null;
  const lastVerifiedAt = options.lastVerifiedAt || null;

  await pool.query(
    `INSERT INTO sprite_sources (id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, NOW())
     ON CONFLICT (id) DO UPDATE SET
       type = COALESCE($2, sprite_sources.type),
       publisher = COALESCE($3, sprite_sources.publisher),
       title = COALESCE($4, sprite_sources.title),
       url = COALESCE($5, sprite_sources.url),
       published_at = COALESCE($6::timestamptz, sprite_sources.published_at),
       observed_at = COALESCE($7::timestamptz, sprite_sources.observed_at),
       last_verified_at = COALESCE($8::timestamptz, sprite_sources.last_verified_at),
       reliability = COALESCE($9, sprite_sources.reliability),
       updated_at = NOW()`,
    [sourceId, type, publisher, title, url, publishedAt, observedAt, lastVerifiedAt, reliability]
  );
}

// Collapse sprites that share the same slug into a single canonical entry.
// Prefers the "sprite_"-prefixed id (the stable scheme used by collections and
// migrations) and backfills any missing / "unknown" fields from the twin so no
// real catalog data (rarity, effect, images, variants…) is lost.
function dedupeSpritesBySlug(sprites) {
  const isUnknown = (v) => v === null || v === undefined || v === "" || v === "unknown";

  function mergePreferring(canonical, other) {
    const merged = { ...canonical };
    // Scalar fields: keep canonical value unless it is unknown/empty.
    for (const key of ["rarity", "effect", "color", "image", "officialName", "seasonId", "eventId", "addedDate"]) {
      if (isUnknown(merged[key]) && !isUnknown(other[key])) merged[key] = other[key];
    }
    // Arrays: prefer the richer (longer) one.
    for (const key of ["variants", "variantIds", "availabilityPeriods", "sourceIds", "sources"]) {
      const a = Array.isArray(merged[key]) ? merged[key] : [];
      const b = Array.isArray(other[key]) ? other[key] : [];
      if (b.length > a.length) merged[key] = b;
    }
    // Objects (images / variantDetails): prefer the one with more keys.
    for (const key of ["images", "variantDetails"]) {
      const a = merged[key] && typeof merged[key] === "object" ? merged[key] : {};
      const b = other[key] && typeof other[key] === "object" ? other[key] : {};
      if (Object.keys(b).length > Object.keys(a).length) merged[key] = b;
    }
    return merged;
  }

  const groups = new Map();
  for (const sprite of sprites) {
    const slug = sprite.slug || sprite.id.replace(/^sprite_/, "").replace(/_/g, "-");
    if (!groups.has(slug)) groups.set(slug, []);
    groups.get(slug).push(sprite);
  }

  const result = [];
  for (const group of groups.values()) {
    if (group.length === 1) { result.push(group[0]); continue; }
    // Canonical: the "sprite_"-prefixed row if present, else the first.
    const canonical = group.find(s => s.id.startsWith("sprite_")) || group[0];
    let merged = canonical;
    for (const other of group) {
      if (other === canonical) continue;
      merged = mergePreferring(merged, other);
    }
    result.push(merged);
  }
  return result;
}

module.exports = { ACQUISITION_TYPES, CATALOG_MAP_TTL, HONEST_AVAILABILITY_STATUSES, RECURRENCE_STATUSES, VALID_DATA_STATUSES, buildAcquisitionMethod, buildAvailability, buildDates, buildRecurrence, catalogIdMapCache, catalogIdMapCacheTs, computeMissingFields, dedupeSpritesBySlug, ensureSource, getCatalogIdMaps, inferSourceReliability, inferSourceType, normalizeAcquisitionType, normalizeAvailabilityStatus, normalizeCollection, normalizeDataStatus, normalizeRecurrenceStatus, normalizeSpriteEntryId, normalizeVariantId, normalizeVariantIdWithMaps };
