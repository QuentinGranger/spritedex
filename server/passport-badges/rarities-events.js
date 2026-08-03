"use strict";

const { pool } = require("../db");
const { awardBadgeByCode } = require("./unlocking");

/** Étape 49 — official rarities present in the published catalogue (versioned list). */
function requiredRaritiesFromCatalogue(catalogue) {
  const { officialRarityScore, OFFICIAL_RARITY_KEY } = require("../passport-math");
  const present = new Map();
  for (const item of catalogue || []) {
    const score = officialRarityScore(item.rarity);
    if (score > 0 && OFFICIAL_RARITY_KEY[score]) {
      present.set(score, OFFICIAL_RARITY_KEY[score]);
    }
  }
  return [...present.entries()].sort((a, b) => a[0] - b[0]).map(([, key]) => key);
}

function evaluateAllRaritiesOwned(catalogue, ownedIds) {
  const { officialRarityScore, OFFICIAL_RARITY_KEY } = require("../passport-math");
  const required = requiredRaritiesFromCatalogue(catalogue);
  if (!required.length) return { qualified: false, required, ownedRarities: [] };
  const owned = ownedIds instanceof Set ? ownedIds : new Set((ownedIds || []).map(String));
  const ownedRarities = new Set();
  for (const item of catalogue || []) {
    if (!owned.has(String(item.id))) continue;
    const score = officialRarityScore(item.rarity);
    if (score > 0 && OFFICIAL_RARITY_KEY[score]) ownedRarities.add(OFFICIAL_RARITY_KEY[score]);
  }
  const qualified = required.every((r) => ownedRarities.has(r));
  return { qualified, required, ownedRarities: [...ownedRarities] };
}

/** Étape 50 — award one event_completed badge per completed event version. */
async function awardEventCompletedBadges(
  userId,
  completions,
  { catalogueVersion = null, db = pool, notify = true } = {}
) {
  const awarded = [];
  for (const row of completions || []) {
    const badge = await awardBadgeByCode(userId, "event_completed", {
      catalogueVersion: catalogueVersion || row.catalogueVersion || null,
      contextType: "event_version",
      contextId: row.eventVersionId,
      evidence: {
        eventId: row.eventId,
        eventName: row.eventName,
        eventVersionId: row.eventVersionId,
        version: row.version,
        catalogueVersion: catalogueVersion || row.catalogueVersion || null
      },
      db,
      notify: false
    });
    if (badge) {
      awarded.push({
        ...badge,
        badgeCode: "event_completed",
        code: "event_completed",
        label: row.eventName ? `Événement complété · ${row.eventName}` : "Événement complété",
        contextType: "event_version",
        contextId: row.eventVersionId
      });
    }
  }
  if (notify && awarded.length) {
    try {
      const { notifyBadgeUnlocks } = require("../badge-engine");
      await notifyBadgeUnlocks(userId, awarded, { batch: awarded.length > 1, db });
    } catch (err) {
      console.error("[passport-badges] event badge notify failed", err.message);
    }
  }
  return awarded;
}

function precisePercent(count, total) {
  const n = Number(count) || 0;
  const d = Number(total) || 0;
  return d > 0 ? (n / d) * 100 : 0;
}

module.exports = {
  requiredRaritiesFromCatalogue,
  evaluateAllRaritiesOwned,
  awardEventCompletedBadges,
  precisePercent
};
