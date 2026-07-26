"use strict";

/** Pure passport math helpers (no DB) — shared by passport + achievements. */

function passportReliability(explicitCount, totalCount) {
  const rate = totalCount ? Math.round((explicitCount / totalCount) * 10000) / 100 : 0;
  const level = rate >= 90 ? "complete" : (rate >= 60 ? "usable" : "insufficient");
  return {
    rate,
    level,
    explicitVariantCount: explicitCount,
    totalVariantCount: totalCount
  };
}

const PROGRESS_MILESTONES = [10, 25, 50, 75, 90, 100];

function computePassportProgress(ownedVariantCount, releasedVariantCount) {
  const owned = Math.max(0, Number(ownedVariantCount) || 0);
  const total = Math.max(0, Number(releasedVariantCount) || 0);
  const precise = total ? (owned / total) * 100 : 0;
  const completionRate = Math.round(precise * 100) / 100;
  const completionRateDisplay = Math.round(completionRate * 10) / 10;
  let nextStep = null;
  if (total > 0) {
    const target = PROGRESS_MILESTONES.find((m) => precise < m - 1e-9) ?? null;
    if (target == null) {
      nextStep = {
        targetPercent: 100,
        remainingVariants: 0,
        label: "Collection complète sur le catalogue publié."
      };
    } else {
      const neededOwned = Math.ceil((target / 100) * total);
      const remaining = Math.max(0, neededOwned - owned);
      nextStep = {
        targetPercent: target,
        remainingVariants: remaining,
        label: remaining === 0
          ? `Prochaine étape : ${target} %.`
          : `Plus que ${remaining} variante${remaining > 1 ? "s" : ""} avant ${target} %.`
      };
    }
  }
  return {
    ownedVariantCount: owned,
    releasedVariantCount: total,
    completionRatePrecise: precise,
    completionRate,
    completionRateDisplay,
    nextStep
  };
}

// Étape 21 — official SpriteDex rarities only (never Gold/Gummy/Galaxy/Holofoil).
const OFFICIAL_RARITY_SCORE = Object.freeze({
  common: 1,
  commun: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  epique: 4,
  legendary: 5,
  legendaire: 5,
  mythic: 6,
  mythique: 6
});

const OFFICIAL_RARITY_LABEL_FR = Object.freeze({
  1: "Commune",
  2: "Peu commune",
  3: "Rare",
  4: "Épique",
  5: "Légendaire",
  6: "Mythique"
});

const OFFICIAL_RARITY_KEY = Object.freeze({
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
  6: "mythic"
});

// Étape 22 — special variant types (distinct from rarity).
const SPECIAL_VARIANT_SCORE = Object.freeze({
  gold: 1,
  gummy: 2,
  galaxy: 3,
  holofoil: 4
});

const SPECIAL_VARIANT_LABEL = Object.freeze({
  gold: "Gold",
  gummy: "Gummy",
  galaxy: "Galaxy",
  holofoil: "Holofoil"
});

function normalizeToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function officialRarityScore(rarity) {
  return OFFICIAL_RARITY_SCORE[normalizeToken(rarity)] || 0;
}

function specialVariantScore(variantType, variantName) {
  const type = normalizeToken(variantType);
  if (SPECIAL_VARIANT_SCORE[type]) return SPECIAL_VARIANT_SCORE[type];
  const name = normalizeToken(variantName);
  if (SPECIAL_VARIANT_SCORE[name]) return SPECIAL_VARIANT_SCORE[name];
  return 0;
}

/**
 * Étapes 21–23 / 61 — official rarity + special variant type among owned items.
 * Also returns full breakdowns (owned/released) with checklist filter keys.
 */
function computeOwnedRarityStats(catalogue, ownedIds) {
  const owned = ownedIds instanceof Set ? ownedIds : new Set((ownedIds || []).map(String));
  let bestScore = 0;
  const ownedByScore = Object.create(null);
  const releasedByScore = Object.create(null);
  let bestSpecial = null;

  const TYPE_KEYS = ["base", "gold", "gummy", "galaxy", "holofoil"];
  const ownedByType = Object.fromEntries(TYPE_KEYS.map((k) => [k, 0]));
  const releasedByType = Object.fromEntries(TYPE_KEYS.map((k) => [k, 0]));

  function resolveTypeKey(item) {
    const specialScore = specialVariantScore(item.variantType, item.variantName);
    if (specialScore > 0) {
      return Object.keys(SPECIAL_VARIANT_SCORE).find((k) => SPECIAL_VARIANT_SCORE[k] === specialScore) || "base";
    }
    return "base";
  }

  for (const item of catalogue || []) {
    const id = String(item.id);
    const isOwned = owned.has(id);
    const score = officialRarityScore(item.rarity);
    if (score > 0) {
      releasedByScore[score] = (releasedByScore[score] || 0) + 1;
      if (isOwned) {
        ownedByScore[score] = (ownedByScore[score] || 0) + 1;
        if (score > bestScore) bestScore = score;
      }
    }

    const typeKey = resolveTypeKey(item);
    releasedByType[typeKey] = (releasedByType[typeKey] || 0) + 1;
    if (isOwned) {
      ownedByType[typeKey] = (ownedByType[typeKey] || 0) + 1;
      const specialScore = specialVariantScore(item.variantType, item.variantName);
      if (specialScore > 0 && (!bestSpecial || specialScore > bestSpecial.score)) {
        bestSpecial = {
          key: typeKey,
          label: SPECIAL_VARIANT_LABEL[typeKey] || typeKey,
          score: specialScore
        };
      }
    }
  }

  // High → low rarity for display (Mythique first matches collection stats UX).
  const rarityBreakdown = [6, 5, 4, 3, 2, 1]
    .filter((score) => (releasedByScore[score] || 0) > 0)
    .map((score) => {
      const label = OFFICIAL_RARITY_LABEL_FR[score];
      return {
        key: OFFICIAL_RARITY_KEY[score],
        label,
        ownedCount: ownedByScore[score] || 0,
        releasedCount: releasedByScore[score] || 0,
        filter: `rarity:${label}`
      };
    });

  const variantTypeBreakdown = TYPE_KEYS
    .filter((key) => (releasedByType[key] || 0) > 0)
    .map((key) => {
      const label = key === "base" ? "Base" : (SPECIAL_VARIANT_LABEL[key] || key);
      return {
        key,
        label,
        ownedCount: ownedByType[key] || 0,
        releasedCount: releasedByType[key] || 0,
        filter: `variant:${label}`
      };
    });

  if (!bestScore) {
    return {
      highestOfficialRarity: null,
      rarestSpecialVariant: bestSpecial,
      rarityBreakdown,
      variantTypeBreakdown,
      display: "Aucune rareté débloquée"
    };
  }

  const highestOfficialRarity = {
    key: OFFICIAL_RARITY_KEY[bestScore],
    label: OFFICIAL_RARITY_LABEL_FR[bestScore],
    score: bestScore,
    ownedCountAtRarity: ownedByScore[bestScore] || 0
  };

  return {
    highestOfficialRarity,
    rarestSpecialVariant: bestSpecial,
    rarityBreakdown,
    variantTypeBreakdown,
    display: highestOfficialRarity.label
  };
}

module.exports = {
  passportReliability,
  computePassportProgress,
  PROGRESS_MILESTONES,
  OFFICIAL_RARITY_SCORE,
  OFFICIAL_RARITY_KEY,
  OFFICIAL_RARITY_LABEL_FR,
  SPECIAL_VARIANT_SCORE,
  SPECIAL_VARIANT_LABEL,
  officialRarityScore,
  specialVariantScore,
  computeOwnedRarityStats
};
