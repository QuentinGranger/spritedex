"use strict";

let compareWs = null;
let compareWsReconnectTimer = null;

function logCompareAnalytics(event, details = {}) {
  try {
    fetch(`${API_BASE}/analytics/compare`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ event, details })
    }).catch(() => {});
  } catch (e) {}
}

// ── Règles de statuts pour la comparaison ────────────────────────────────────
const COMPARE_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareIsOwned(status) { return COMPARE_RULES.owned.includes(status); }
function compareIsMissing(status) { return COMPARE_RULES.missing.includes(status); }
function compareIsUnknown(status) { return !status || COMPARE_RULES.unknown.includes(status); }
function compareIsRecommend(status) { return COMPARE_RULES.recommend.includes(status); }

function compareIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  // Un sprite indisponible, déjà possédé ou sans info n’est pas une priorité recommandable
  if (s === "unavailable" || compareIsOwned(s) || compareIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function isVariantReleasedAndActive(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

// Build a stable catalog list keyed by variant.id (e.g. sprite_water_holofoil).
function getCompareCatalogItems() {
  const items = [];
  for (const sprite of SPRITES || []) {
    const variantDetails = sprite.variantDetails || {};
    const entries = Object.entries(variantDetails);
    if (entries.length > 0) {
      for (const [variantType, variant] of entries) {
        const stableVariantId = variant.id || variantId(sprite.id, variantType);
        const legacyKeys = [`${sprite.id}::${variantType}`];
        if ((variantType || "").toLowerCase() === "base" || stableVariantId === sprite.id) {
          legacyKeys.push(sprite.id);
        }
        const type = variant.type || variantType;
        const releaseStatus = variant.releaseStatus || sprite.releaseStatus || "";
        const dataStatus = variant.dataStatus || sprite.dataStatus || "";
        const available = variant.available !== undefined ? variant.available : sprite.available;
        const availabilityStatus = variant.availability?.status || sprite.availability?.status || "";
        const acquisitionMethod = variant.acquisition?.type || sprite.acquisitionMethod?.type || "";
        const releaseDate = variant.availability?.startDate || sprite.availability?.startDate || variant.firstObservedAt || sprite.addedDate || null;
        items.push({
          id: stableVariantId,
          spriteId: sprite.id,
          variantId: stableVariantId,
          variantType: type,
          variantName: variant.name || variantType,
          spriteName: sprite.name || sprite.id,
          img: variant.image || (sprite.images && sprite.images[variantType]) || getSpriteImg(sprite.id, variantType),
          rarity: variant.rarity || sprite.rarity,
          color: sprite.color,
          effect: (typeof variant.effect === "string" ? variant.effect : null) || sprite.effect,
          seasonId: sprite.seasonId,
          eventId: sprite.eventId,
          releaseStatus,
          dataStatus,
          available,
          availabilityStatus,
          acquisitionMethod,
          releaseDate,
          legacyKeys
        });
      }
      continue;
    }
    // Fallback for older catalog payloads
    if (Array.isArray(sprite.variants)) {
      for (const variantType of sprite.variants) {
        const stableVariantId = variantId(sprite.id, variantType);
        const legacyKeys = [`${sprite.id}::${variantType}`];
        if ((variantType || "").toLowerCase() === "base") legacyKeys.push(sprite.id);
        items.push({
          id: stableVariantId,
          spriteId: sprite.id,
          variantId: stableVariantId,
          variantType,
          variantName: variantType,
          spriteName: sprite.name || sprite.id,
          img: getSpriteImg(sprite.id, variantType),
          rarity: sprite.rarity,
          color: sprite.color,
          effect: sprite.effect,
          seasonId: sprite.seasonId,
          eventId: sprite.eventId,
          releaseStatus: sprite.releaseStatus || "",
          dataStatus: sprite.dataStatus || "",
          available: sprite.available,
          availabilityStatus: sprite.availability?.status || "",
          acquisitionMethod: sprite.acquisitionMethod?.type || "",
          releaseDate: sprite.availability?.startDate || sprite.addedDate || null,
          legacyKeys
        });
      }
    }
  }
  return items;
}

function compareClassify(entry) {
  const s = entry?.status;
  if (compareIsOwned(s)) return "owned";
  if (compareIsMissing(s)) return "missing";
  return "unknown";
}

function compareEntry(collection, item) {
  if (!collection) return defaultEntry();
  // Prefer stable variantId, then legacy composite key(s).
  const keys = [item.variantId, item.id, ...(item.legacyKeys || [])];
  for (const key of keys) {
    if (key && collection[key]) return collection[key];
  }
  return defaultEntry();
}

const DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS = {
  mythic: 1.5,
  legendary: 1.2,
  epic: 1,
  rare: 0.7,
  uncommon: 0.4,
  common: 0.1
};

function isItemAvailable(item) {
  if (item.available === false) return false;
  const status = (item.availabilityStatus || "").toLowerCase();
  return status !== "unavailable";
}

function computeComplementarityScore(baseRate, records, options = {}) {
  const rarityWeights = options.rarityWeights || DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS;
  const objectiveVariantIds = options.objectiveVariantIds ? new Set(options.objectiveVariantIds) : null;
  const activeEventIds = options.activeEventIds ? new Set(options.activeEventIds) : null;

  const isOwned = (entry) => compareClassify(entry) === "owned";
  const isMissing = (entry) => compareClassify(entry) === "missing";
  const isPriority = (entry) => compareIsPriority(entry);

  let commonPriorities = 0;
  let availableComplements = 0;
  let objectiveMatches = 0;
  let soughtRarities = 0;
  let activeEvents = 0;

  for (const rec of records) {
    const aOwned = isOwned(rec.userA);
    const bOwned = isOwned(rec.userB);
    const aPrio = isPriority(rec.userA);
    const bPrio = isPriority(rec.userB);
    const aMissing = isMissing(rec.userA);
    const bMissing = isMissing(rec.userB);
    const onlyOne = (aOwned && !bOwned) || (bOwned && !aOwned);

    if (aPrio && bPrio) commonPriorities++;
    if (onlyOne && isItemAvailable(rec)) availableComplements++;

    if (objectiveVariantIds && objectiveVariantIds.has(rec.id) && onlyOne) {
      if ((aOwned && (bMissing || bPrio)) || (bOwned && (aMissing || aPrio))) objectiveMatches++;
    }

    if (onlyOne && ((aOwned && bPrio) || (bOwned && aPrio))) {
      const weight = rarityWeights[(rec.rarity || "").toLowerCase()] || 0;
      if (weight > 0) soughtRarities += weight;
    }

    if (rec.eventId && onlyOne) {
      const isActiveEvent = activeEventIds ? activeEventIds.has(rec.eventId) : isItemAvailable(rec) && (rec.availabilityStatus || "").toLowerCase() === "event";
      if (isActiveEvent) activeEvents++;
    }
  }

  const bonus = (commonPriorities * 0.5) + (availableComplements * 0.3) + (objectiveMatches * 0.7) + (soughtRarities * 0.4) + (activeEvents * 0.5);
  return Math.min(100, Math.round((baseRate + bonus) * 100) / 100);
}

function countExplicitCollectionEntries(collection) {
  if (!collection || typeof collection !== "object") return 0;
  let count = 0;
  for (const [key, entry] of Object.entries(collection)) {
    if (key.startsWith("fav_")) continue;
    if (!entry || typeof entry !== "object") continue;
    if (!COMPARE_RULES.unknown.includes(entry.status)) {
      count++;
    } else if ((entry.note && String(entry.note).trim()) || (entry.priority && entry.priority !== "none" && entry.priority !== "ignored")) {
      count++;
    }
  }
  return count;
}

// ── Moteur de comparaison ───────────────────────────────────────────────────
// userA et userB sont des objets { id, displayName, collection }.
// catalogue est une liste de variants (par défaut tous les variants sortis du catalogue).
// Le résultat est normalisé : comparisonId, generatedAt, users, summary, groups.
