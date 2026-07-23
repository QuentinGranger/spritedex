// compare.js — extracted from server.js

const analytics = require("../analytics");
const secLog = require("../security-logger");
const { areFriends, canViewCollection, checkPrivacyAccess, getCollectionAccessReason, getRequestingUser, getVisibility, isBlocked, shareSquad } = require("./auth");
const { buildAcquisitionMethod, buildAvailability } = require("./catalog");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");
const QRCode = require("qrcode");

// ── Server-side comparison engine (mirrors js/compare.js logic) ──
const COMPARE_SERVER_RULES = {
  owned: ["owned"],
  missing: ["missing", "priority", "spotted", "unavailable"],
  recommend: ["missing", "priority", "spotted"],
  unknown: ["new", "unknown", "unsure"]
};

function compareServerIsOwned(status) { return COMPARE_SERVER_RULES.owned.includes(status); }
function compareServerIsMissing(status) { return COMPARE_SERVER_RULES.missing.includes(status); }
function compareServerIsUnknown(status) { return !status || COMPARE_SERVER_RULES.unknown.includes(status); }
function compareServerIsRecommend(status) { return COMPARE_SERVER_RULES.recommend.includes(status); }

function compareServerIsPriority(entry) {
  if (!entry) return false;
  const s = entry.status;
  if (s === "unavailable" || compareServerIsOwned(s) || compareServerIsUnknown(s)) return false;
  if (s === "priority") return true;
  return !!(entry.priority && entry.priority !== "none" && entry.priority !== "ignored");
}

function compareServerClassify(entry) {
  const s = entry?.status;
  if (compareServerIsOwned(s)) return "owned";
  if (compareServerIsMissing(s)) return "missing";
  return "unknown";
}

function compareServerIsExplicitEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.status && !COMPARE_SERVER_RULES.unknown.includes(entry.status)) return true;
  if (entry.note && String(entry.note).trim()) return true;
  if (entry.priority && entry.priority !== "none" && entry.priority !== "ignored") return true;
  return false;
}

function countServerExplicitCollectionEntries(collection) {
  if (!collection || typeof collection !== "object") return 0;
  let count = 0;
  for (const [key, entry] of Object.entries(collection)) {
    if (key.startsWith("fav_")) continue;
    if (compareServerIsExplicitEntry(entry)) count++;
  }
  return count;
}

function compareServerDefaultEntry() { return { status: "new", priority: "none", note: "" }; }

async function resolveCompareUser(identifier) {
  if (!identifier) return null;
  const raw = String(identifier).trim();
  const isNumeric = /^\d+$/.test(raw);
  const query = isNumeric
    ? `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = $1 AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`
    : `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE (username = $1 OR username_normalized = LOWER($1)) AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`;
  const result = await pool.query(query, isNumeric ? [Number(raw)] : [raw]);
  return result.rows[0] || null;
}

async function buildCompareResult(reqUser, targetUser, source, queryParams = {}) {
  const targetVisibility = getVisibility(targetUser);
  const accessReason = await getCollectionAccessReason(reqUser, targetUser.id, targetVisibility);
  if (accessReason === "blocked") {
    const err = new Error("Vous ne pouvez pas interagir avec cet utilisateur");
    err.status = 403;
    throw err;
  }
  if (accessReason === "denied" || accessReason === "private") {
    const err = new Error("Collection non accessible");
    err.status = 403;
    throw err;
  }

  const [reqUserRes] = await Promise.all([
    pool.query("SELECT id, username, display_name FROM users WHERE id = $1 AND deleted_at IS NULL", [reqUser])
  ]);
  const reqUserRow = reqUserRes.rows[0] || {};
  const reqUserVisibility = getVisibility(reqUserRow);

  const userMap = {
    [String(reqUser)]: { ...reqUserRow, visibility: reqUserVisibility },
    [String(targetUser.id)]: { ...targetUser, visibility: targetVisibility }
  };

  let result = getCachedCompareResult(reqUser, targetUser.id);
  if (!result) {
    const [catalogue, collectionA, collectionB] = await Promise.all([
      getServerCompareCatalogItemsCached(),
      loadServerCompareCollection(reqUser),
      loadServerCompareCollection(targetUser.id)
    ]);

    const userA = { id: reqUser, displayName: reqUserRow.display_name || reqUserRow.username || reqUser, collection: collectionA };
    const userB = { id: targetUser.id, displayName: targetUser.display_name || targetUser.username || targetUser.id, collection: collectionB };

    result = compareCollectionsServer(userA, userB, catalogue);
    setCachedCompareResult(reqUser, targetUser.id, result);
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_created", details: { userAId: reqUser, userBId: targetUser.id, source } });
  }

  result = applyServerCompareFilters(result, queryParams);
  result = await applyCollectionVisibilityFilters(result, reqUser, userMap);
  result.accessReason = accessReason;
  analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_viewed", details: { userAId: reqUser, userBId: targetUser.id, source } });

  return result;
}

function isVariantReleasedAndActiveServer(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

async function getServerCompareCatalogItems() {
  const [spritesRes, variantsRes] = await Promise.all([
    pool.query(`SELECT id, name, rarity, color, season_id, event_id, acquisition, availability, data_status, is_released, available, added_date FROM sprites`),
    pool.query(`SELECT id, sprite_id, variant_type, name, rarity, release_status, data_status, acquisition, availability, first_observed_at, image_path, suggested_image_path FROM sprite_variants`)
  ]);
  const spriteMap = Object.fromEntries(spritesRes.rows.map(s => [s.id, s]));
  const items = [];
  for (const v of variantsRes.rows) {
    const sprite = spriteMap[v.sprite_id];
    if (!sprite) continue;
    const variantAcquisition = buildAcquisitionMethod(v.acquisition && Object.keys(v.acquisition || {}).length ? v.acquisition : sprite.acquisition);
    const variantAvailability = buildAvailability(v.availability && Object.keys(v.availability || {}).length ? v.availability : sprite.availability);
    items.push({
      id: v.id,
      variantId: v.id,
      spriteId: sprite.id,
      variantType: v.variant_type,
      variantName: v.name || v.variant_type,
      spriteName: sprite.name || sprite.id,
      img: v.image_path || v.suggested_image_path || null,
      rarity: v.rarity || sprite.rarity,
      color: sprite.color,
      seasonId: sprite.season_id,
      eventId: sprite.event_id,
      releaseStatus: v.release_status || "",
      dataStatus: v.data_status || sprite.data_status || "",
      availabilityStatus: variantAvailability.status,
      acquisitionMethod: variantAcquisition.type,
      releaseDate: variantAvailability.startDate || v.first_observed_at || sprite.added_date,
      available: v.available !== undefined ? v.available : sprite.available,
      isReleased: sprite.is_released
    });
  }
  return items;
}

async function loadServerCompareCollection(userId) {
  pruneCollectionCache();
  const uid = String(userId);
  const cached = collectionCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.collection;
  }

  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  const collection = {};
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: row.note || "",
      priority: row.priority || "none",
      obtainedAt: row.obtained_at || null
    };
  }

  collectionCache.set(uid, {
    collection,
    expiresAt: Date.now() + COMPARE_CACHE_TTL_MS,
    createdAt: Date.now()
  });
  return collection;
}

const SQUAD_MATRIX_STATUS = {
  OWNED_BY_EVERYONE: "owned_by_everyone",
  HIGHLY_SHARED: "highly_shared",
  SHARED: "shared",
  SINGLE_OWNER: "single_owner",
  MISSING_ALL: "missing_all",
  UNKNOWN: "unknown"
};

async function buildSquadCollectionMatrix(members, catalogue) {
  if (!members || members.length === 0) return [];
  const memberList = members.map(m => {
    if (m && typeof m === "object" && m.userId !== undefined) {
      return { userId: m.userId, username: m.username || String(m.userId), visible: m.visible !== false };
    }
    return { userId: m, username: String(m), visible: true };
  });

  const activeCatalogue = (catalogue || await getServerCompareCatalogItemsCached()).filter(isVariantReleasedAndActiveServer);
  const collections = await Promise.all(memberList.map(async (m) => {
    if (!m.visible) return {};
    return loadServerCompareCollection(m.userId);
  }));

  const matrix = [];
  for (const item of activeCatalogue) {
    const owners = [];
    const missingMembers = [];
    const unknownMembers = [];
    const memberDetails = [];

    for (let i = 0; i < memberList.length; i++) {
      const m = memberList[i];
      const entry = m.visible
        ? (collections[i][item.id] || compareServerDefaultEntry())
        : { status: "unknown", priority: "none", note: "" };
      const classification = m.visible ? compareServerClassify(entry) : "unknown";

      memberDetails.push({
        userId: m.userId,
        username: m.username,
        status: entry.status || "new",
        priority: entry.priority || "none",
        classification
      });

      if (classification === "owned") {
        owners.push(m.username);
      } else if (classification === "missing") {
        missingMembers.push(m.username);
      } else {
        unknownMembers.push(m.username);
      }
    }

    const ownerCount = owners.length;
    const memberCount = memberList.length;
    const half = Math.ceil(memberCount / 2);
    let status;
    if (ownerCount === 0) {
      status = unknownMembers.length === 0 ? SQUAD_MATRIX_STATUS.MISSING_ALL : SQUAD_MATRIX_STATUS.UNKNOWN;
    } else if (ownerCount === memberCount) {
      status = SQUAD_MATRIX_STATUS.OWNED_BY_EVERYONE;
    } else if (ownerCount >= half) {
      status = SQUAD_MATRIX_STATUS.HIGHLY_SHARED;
    } else if (ownerCount >= 2) {
      status = SQUAD_MATRIX_STATUS.SHARED;
    } else {
      status = SQUAD_MATRIX_STATUS.SINGLE_OWNER;
    }

    matrix.push({
      variantId: item.id,
      spriteId: item.spriteId,
      spriteName: item.spriteName,
      variantName: item.variantName,
      variantType: item.variantType || "Base",
      img: item.img,
      rarity: item.rarity,
      seasonId: item.seasonId,
      eventId: item.eventId,
      availabilityStatus: item.availabilityStatus,
      owners,
      missingMembers,
      unknownMembers,
      ownerCount,
      missingCount: missingMembers.length,
      unknownCount: unknownMembers.length,
      memberCount,
      status,
      members: memberDetails
    });
  }

  return matrix;
}

function getSquadCollectiveCompletion(matrix, squadName = "La squad") {
  const total = matrix.length;
  const covered = matrix.filter(r => r.ownerCount > 0).length;
  const rate = total ? Math.round((covered / total) * 10000) / 100 : 0;
  const formattedRate = rate.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const display = `${squadName} couvre ${formattedRate} % du catalogue.`;
  return {
    collectiveCompletionRate: rate,
    coveredVariantCount: covered,
    totalVariantCount: total,
    display
  };
}

async function getSquadCollectiveCompletionSummary(memberIds, catalogue) {
  if (!memberIds || memberIds.length === 0) {
    return { collectiveCompletionRate: 0, totalVariants: 0, ownedCount: 0 };
  }
  const members = memberIds.map(id => ({ userId: id, username: String(id), visible: true }));
  const matrix = await buildSquadCollectionMatrix(members, catalogue);
  const result = getSquadCollectiveCompletion(matrix, "");
  return {
    collectiveCompletionRate: result.collectiveCompletionRate,
    totalVariants: result.totalVariantCount,
    ownedCount: result.coveredVariantCount
  };
}

async function getSquadRecommendations(memberIds, catalogue) {
  if (!memberIds || memberIds.length < 2) return [];
  const members = memberIds.map(id => ({ userId: id, username: String(id), visible: true }));
  const matrix = await buildSquadCollectionMatrix(members, catalogue);
  const recs = [];
  for (const row of matrix) {
    let wantedBy = 0;
    for (const m of row.members) {
      if (m.classification === "owned") continue;
      const entry = { status: m.status, priority: m.priority };
      if (compareServerIsRecommend(m.status) || compareServerIsPriority(entry)) wantedBy++;
    }
    if (row.ownerCount > 0 && wantedBy > 0) {
      recs.push({
        variantId: row.variantId,
        spriteId: row.spriteId,
        spriteName: row.spriteName,
        variantName: row.variantName,
        img: row.img,
        ownedByCount: row.ownerCount,
        wantedByCount: wantedBy,
        score: wantedBy * 100 + row.ownerCount
      });
    }
  }
  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, 50);
}

function classifySquadMissing(row) {
  if (row.ownerCount !== 0) return null;
  if (row.missingCount === 0) return null;

  if (row.unknownCount === 0 && row.missingCount === row.memberCount) {
    return "confirmed_missing";
  }

  if (row.unknownCount > 0 && row.missingCount >= row.unknownCount) {
    return "possibly_missing";
  }

  return null;
}

function getSquadMissingVariants(matrix, squadName) {
  const missing = [];
  for (const row of matrix) {
    const classification = classifySquadMissing(row);
    if (!classification) continue;

    let display;
    if (classification === "confirmed_missing") {
      display = `Aucun membre de ${squadName} ne possède ${row.spriteName} ${row.variantName}.`;
    } else {
      display = `Cette variante semble manquer à la squad, mais ${row.unknownCount} collection${row.unknownCount > 1 ? 's' : ''} ne ${row.unknownCount > 1 ? 'sont' : 'est'} pas à jour.`;
    }

    missing.push({
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      ownerCount: row.ownerCount,
      missingMemberCount: row.missingCount,
      unknownMemberCount: row.unknownCount,
      classification,
      display
    });
  }

  const groupBy = (key, labelFn) => {
    const groups = {};
    for (const v of missing) {
      const k = (v[key] === null || v[key] === undefined || v[key] === "") ? "_none" : v[key];
      if (!groups[k]) groups[k] = { key: k, label: labelFn(v, k), count: 0, variants: [] };
      groups[k].variants.push(v);
      groups[k].count++;
    }
    return Object.values(groups).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };

  const bySprite = groupBy("spriteId", (v) => v.spriteName || v.spriteId);
  const byRarity = groupBy("rarity", (v, k) => k === "_none" ? "Rareté inconnue" : `Rareté ${k}`);
  const byEvent = groupBy("eventId", (v, k) => k === "_none" ? "Hors événement" : `Événement ${k}`);
  const byAvailability = groupBy("availabilityStatus", (v, k) => k === "_none" ? "Disponibilité inconnue" : `Disponibilité ${k}`);
  const byVariantType = groupBy("variantType", (v, k) => k);

  return {
    totalMissing: missing.length,
    variants: missing,
    bySprite,
    byRarity,
    byEvent,
    byAvailability,
    byVariantType
  };
}

function classifySquadShared(row) {
  if (row.ownerCount < 2) return null;
  const half = Math.ceil(row.memberCount / 2);
  if (row.ownerCount === row.memberCount) return "owned_by_everyone";
  if (row.ownerCount >= half) return "highly_shared";
  return "shared";
}

function getSquadSharedVariants(matrix) {
  const shared = [];
  for (const row of matrix) {
    const classification = classifySquadShared(row);
    if (!classification) continue;

    const display = `${row.spriteName} ${row.variantName} est possédé par ${row.ownerCount} membre${row.ownerCount > 1 ? 's' : ''} sur ${row.memberCount}.`;
    shared.push({
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      owners: row.owners,
      ownerCount: row.ownerCount,
      memberCount: row.memberCount,
      classification,
      display
    });
  }

  const groupBy = (key, labelFn) => {
    const groups = {};
    for (const v of shared) {
      const k = (v[key] === null || v[key] === undefined || v[key] === "") ? "_none" : v[key];
      if (!groups[k]) groups[k] = { key: k, label: labelFn(v, k), count: 0, variants: [] };
      groups[k].variants.push(v);
      groups[k].count++;
    }
    return Object.values(groups).sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  };

  const bySprite = groupBy("spriteId", (v) => v.spriteName || v.spriteId);
  const byRarity = groupBy("rarity", (v, k) => k === "_none" ? "Rareté inconnue" : `Rareté ${k}`);
  const byEvent = groupBy("eventId", (v, k) => k === "_none" ? "Hors événement" : `Événement ${k}`);
  const byAvailability = groupBy("availabilityStatus", (v, k) => k === "_none" ? "Disponibilité inconnue" : `Disponibilité ${k}`);
  const byVariantType = groupBy("variantType", (v, k) => k);
  const byClassification = groupBy("classification", (v, k) => k);

  return {
    totalShared: shared.length,
    variants: shared,
    byClassification,
    bySprite,
    byRarity,
    byEvent,
    byAvailability,
    byVariantType
  };
}

function getSquadUniqueOwners(matrix) {
  const unique = [];
  const byMember = {};

  for (const row of matrix) {
    if (row.ownerCount !== 1) continue;
    const owner = row.members.find(m => m.classification === "owned");
    if (!owner) continue;

    const display = `${owner.username} est le seul membre à posséder ${row.spriteName} ${row.variantName}.`;
    const item = {
      variantId: row.variantId,
      spriteId: row.spriteId,
      spriteName: row.spriteName,
      variantName: row.variantName,
      variantType: row.variantType,
      img: row.img,
      rarity: row.rarity,
      eventId: row.eventId,
      availabilityStatus: row.availabilityStatus,
      uniqueOwnerId: owner.userId,
      uniqueOwnerUsername: owner.username,
      classification: "single_owner",
      display
    };

    unique.push(item);

    if (!byMember[owner.userId]) {
      byMember[owner.userId] = { userId: owner.userId, username: owner.username, count: 0, variants: [] };
    }
    byMember[owner.userId].variants.push(item);
    byMember[owner.userId].count++;
  }

  return {
    totalUnique: unique.length,
    uniqueVariants: unique,
    byMember: Object.values(byMember).sort((a, b) => b.count - a.count || String(a.username).localeCompare(String(b.username)))
  };
}

const DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS = {
  mythic: 1.5,
  legendary: 1.2,
  epic: 1,
  rare: 0.7,
  uncommon: 0.4,
  common: 0.1
};

function isServerItemAvailable(item) {
  if (item.available === false) return false;
  const status = (item.availabilityStatus || "").toLowerCase();
  return status !== "unavailable";
}

function computeComplementarityScore(baseRate, records, options = {}) {
  const rarityWeights = options.rarityWeights || DEFAULT_COMPLEMENTARITY_RARITY_WEIGHTS;
  const objectiveVariantIds = options.objectiveVariantIds ? new Set(options.objectiveVariantIds) : null;
  const activeEventIds = options.activeEventIds ? new Set(options.activeEventIds) : null;

  const isOwned = (entry) => compareServerClassify(entry) === "owned";
  const isMissing = (entry) => compareServerClassify(entry) === "missing";
  const isPriority = (entry) => compareServerIsPriority(entry);

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
    if (onlyOne && isServerItemAvailable(rec)) availableComplements++;

    if (objectiveVariantIds && objectiveVariantIds.has(rec.id) && onlyOne) {
      if ((aOwned && (bMissing || bPrio)) || (bOwned && (aMissing || aPrio))) objectiveMatches++;
    }

    if (onlyOne && ((aOwned && bPrio) || (bOwned && aPrio))) {
      const weight = rarityWeights[(rec.rarity || "").toLowerCase()] || 0;
      if (weight > 0) soughtRarities += weight;
    }

    if (rec.eventId && onlyOne) {
      const isActiveEvent = activeEventIds ? activeEventIds.has(rec.eventId) : isServerItemAvailable(rec) && (rec.availabilityStatus || "").toLowerCase() === "event";
      if (isActiveEvent) activeEvents++;
    }
  }

  const bonus = (commonPriorities * 0.5) + (availableComplements * 0.3) + (objectiveMatches * 0.7) + (soughtRarities * 0.4) + (activeEvents * 0.5);
  return Math.min(100, Math.round((baseRate + bonus) * 100) / 100);
}

function compareCollectionsServer(userA, userB, catalogue) {
  const activeCatalogue = catalogue.filter(isVariantReleasedAndActiveServer);
  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  const records = [];

  for (const item of activeCatalogue) {
    const a = userA.collection[item.variantId] || compareServerDefaultEntry();
    const b = userB.collection[item.variantId] || compareServerDefaultEntry();
    const sa = compareServerClassify(a);
    const sb = compareServerClassify(b);

    const record = {
      ...item,
      userA: { status: a.status, priority: a.priority, note: a.note },
      userB: { status: b.status, priority: b.priority, note: b.note }
    };

    if (sa === "unknown" || sb === "unknown") {
      groups.unknown.push(record);
    } else if (sa === "owned" && sb === "owned") {
      groups.bothOwned.push(record);
    } else if (sa === "owned" && sb !== "owned") {
      groups.onlyUserA.push(record);
    } else if (sb === "owned" && sa !== "owned") {
      groups.onlyUserB.push(record);
    } else if (sa === "missing" && sb === "missing") {
      groups.bothMissing.push(record);
    } else {
      groups.unknown.push(record);
    }
    records.push(record);
  }

  const total = activeCatalogue.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;

  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;
  const aEnteredCount = countServerExplicitCollectionEntries(userA.collection);
  const bEnteredCount = countServerExplicitCollectionEntries(userB.collection);
  const insufficientData = aEnteredCount === 0 || bEnteredCount === 0;
  const comparisonId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `comparison_${crypto.randomBytes(16).toString("hex")}`;
  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);
  const complementarityScore = computeComplementarityScore(complementarityRate, records);

  return {
    comparisonId,
    generatedAt: new Date().toISOString(),
    users: {
      userA: { id: userA.id, displayName: userA.displayName, enteredCount: aEnteredCount },
      userB: { id: userB.id, displayName: userB.displayName, enteredCount: bEnteredCount }
    },
    summary: {
      catalogueVariantCount: total,
      bothOwnedCount,
      onlyUserACount,
      onlyUserBCount,
      bothMissingCount,
      unknownCount,
      aOwnedCount,
      bOwnedCount,
      aPossessionRate: toRate(aOwnedCount, total),
      bPossessionRate: toRate(bOwnedCount, total),
      collectiveOwnedCount,
      collectiveCompletionRate: toRate(collectiveOwnedCount, total),
      complementarityRate,
      complementarityScore,
      aEnteredCount,
      bEnteredCount,
      insufficientData
    },
    groups,
    records
  };
}

const COMPARE_CACHE_TTL_MS = (() => {
  const v = parseInt(process.env.COMPARE_CACHE_TTL_MS, 10);
  if (!isNaN(v)) return Math.max(30000, Math.min(120000, v));
  return 60000;
})();

const compareCatalogCache = { data: null, expiresAt: 0 };
const compareResultCache = new Map();
const MAX_COMPARE_RESULT_CACHE = 500;

const collectionCache = new Map();
const MAX_COLLECTION_CACHE = 200;

function pruneCompareResultCache() {
  const now = Date.now();
  for (const [key, entry] of compareResultCache.entries()) {
    if (entry.expiresAt < now) compareResultCache.delete(key);
  }
  if (compareResultCache.size > MAX_COMPARE_RESULT_CACHE) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of compareResultCache.entries()) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) compareResultCache.delete(oldestKey);
  }
}

function pruneCollectionCache() {
  const now = Date.now();
  for (const [key, entry] of collectionCache.entries()) {
    if (entry.expiresAt < now) collectionCache.delete(key);
  }
  if (collectionCache.size > MAX_COLLECTION_CACHE) {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, entry] of collectionCache.entries()) {
      if (entry.createdAt < oldest) {
        oldest = entry.createdAt;
        oldestKey = key;
      }
    }
    if (oldestKey) collectionCache.delete(oldestKey);
  }
}

function getCompareCacheKey(userAId, userBId) {
  return `${userAId}:${userBId}`;
}

function invalidateCompareCacheForUser(userId) {
  const uid = String(userId);
  const prefix = `${uid}:`;
  const suffix = `:${uid}`;
  for (const key of compareResultCache.keys()) {
    if (key === uid || key.startsWith(prefix) || key.endsWith(suffix)) {
      compareResultCache.delete(key);
    }
  }
  // A collection change also invalidates the cached collection for this user.
  collectionCache.delete(uid);
}

async function getServerCompareCatalogItemsCached() {
  const now = Date.now();
  if (compareCatalogCache.data && compareCatalogCache.expiresAt > now) {
    return compareCatalogCache.data;
  }
  const data = await getServerCompareCatalogItems();
  compareCatalogCache.data = data;
  compareCatalogCache.expiresAt = now + COMPARE_CACHE_TTL_MS;
  return data;
}

function getCachedCompareResult(userAId, userBId) {
  pruneCompareResultCache();
  const entry = compareResultCache.get(getCompareCacheKey(userAId, userBId));
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

function setCachedCompareResult(userAId, userBId, result) {
  pruneCompareResultCache();
  compareResultCache.set(getCompareCacheKey(userAId, userBId), {
    result,
    expiresAt: Date.now() + COMPARE_CACHE_TTL_MS,
    createdAt: Date.now()
  });
}

function applyServerCompareFilters(result, query) {
  let records = result.records;
  const status = query.status;
  if (status) {
    if (result.groups[status]) {
      records = result.groups[status];
    } else if (status === "differences" || status === "missingMatch") {
      records = [...result.groups.onlyUserA, ...result.groups.onlyUserB];
    } else if (status === "priorities") {
      records = records.filter(r => compareServerIsPriority(r.userA) || compareServerIsPriority(r.userB));
    }
  }

  if (query.seasonId) records = records.filter(r => r.seasonId === query.seasonId);
  if (query.eventId) records = records.filter(r => r.eventId === query.eventId);
  if (query.rarity) records = records.filter(r => r.rarity && String(r.rarity).toLowerCase() === String(query.rarity).toLowerCase());
  if (query.variantType) records = records.filter(r => r.variantType && String(r.variantType).toLowerCase() === String(query.variantType).toLowerCase());
  if (query.availability) records = records.filter(r => r.availabilityStatus === query.availability);

  const groups = { bothOwned: [], onlyUserA: [], onlyUserB: [], bothMissing: [], unknown: [] };
  for (const rec of records) {
    const sa = compareServerClassify(rec.userA);
    const sb = compareServerClassify(rec.userB);
    if (sa === "unknown" || sb === "unknown") groups.unknown.push(rec);
    else if (sa === "owned" && sb === "owned") groups.bothOwned.push(rec);
    else if (sa === "owned" && sb !== "owned") groups.onlyUserA.push(rec);
    else if (sb === "owned" && sa !== "owned") groups.onlyUserB.push(rec);
    else if (sa === "missing" && sb === "missing") groups.bothMissing.push(rec);
    else groups.unknown.push(rec);
  }

  const total = records.length;
  const bothOwnedCount = groups.bothOwned.length;
  const onlyUserACount = groups.onlyUserA.length;
  const onlyUserBCount = groups.onlyUserB.length;
  const bothMissingCount = groups.bothMissing.length;
  const unknownCount = groups.unknown.length;
  const aOwnedCount = bothOwnedCount + onlyUserACount;
  const bOwnedCount = bothOwnedCount + onlyUserBCount;
  const collectiveOwnedCount = aOwnedCount + onlyUserBCount;
  const toRate = (n, d) => d ? Math.round((n / d) * 10000) / 100 : 0;

  const complementarityRate = toRate(onlyUserACount + onlyUserBCount, collectiveOwnedCount);
  const complementarityScore = computeComplementarityScore(complementarityRate, records);
  const summary = {
    ...result.summary,
    catalogueVariantCount: total,
    bothOwnedCount,
    onlyUserACount,
    onlyUserBCount,
    bothMissingCount,
    unknownCount,
    aOwnedCount,
    bOwnedCount,
    aPossessionRate: toRate(aOwnedCount, total),
    bPossessionRate: toRate(bOwnedCount, total),
    collectiveOwnedCount,
    collectiveCompletionRate: toRate(collectiveOwnedCount, total),
    complementarityRate,
    complementarityScore,
    insufficientData: result.summary?.insufficientData ?? false
  };

  return { ...result, records, groups, summary };
}

// ── Comparisons : GET comparison between two users ──
app.get("/api/comparisons/users/:userAId/:userBId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const { userAId, userBId } = req.params;
    const usersResult = await pool.query(
      `SELECT id, username, display_name, privacy,
              profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = ANY($1) AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`,
      [[userAId, userBId]]
    );
    const userMap = Object.fromEntries(usersResult.rows.map(u => [u.id, u]));
    if (!userMap[userAId] || !userMap[userBId]) {
      return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    if (await isBlocked(userAId, userBId)) {
      return res.status(403).json({ error: "Comparaison impossible" });
    }

    const canViewA = await canViewCollection(reqUser, userAId);
    const canViewB = await canViewCollection(reqUser, userBId);
    if (!canViewA || !canViewB) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    let result = getCachedCompareResult(userAId, userBId);
    if (!result) {
      const [catalogue, collectionA, collectionB] = await Promise.all([
        getServerCompareCatalogItemsCached(),
        loadServerCompareCollection(userAId),
        loadServerCompareCollection(userBId)
      ]);

      const userA = { id: userAId, displayName: userMap[userAId].display_name || userMap[userAId].username || userAId, collection: collectionA };
      const userB = { id: userBId, displayName: userMap[userBId].display_name || userMap[userBId].username || userBId, collection: collectionB };

      result = compareCollectionsServer(userA, userB, catalogue);
      setCachedCompareResult(userAId, userBId, result);
      analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_created", details: { userAId, userBId, source: "api" } });
    }

    result = applyServerCompareFilters(result, req.query);
    result = await applyCollectionVisibilityFilters(result, reqUser, userMap);

    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_viewed", details: { userAId, userBId, source: "api" } });

    if (await shareSquad(userAId, userBId)) {
      analytics.logProductAnalyticsEvent(pool, { userId: reqUser, event: "squad_member_comparison_opened", details: { userAId, userBId } });
    }

    for (const [key, value] of Object.entries(req.query)) {
      if (value && ["status", "seasonId", "eventId", "rarity", "variantType", "availability"].includes(key)) {
        analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_filter_used", details: { filter: key, value: String(value) } });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[/api/comparisons]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Hide priorities and notes in a compare result when the requesting user is not
// authorized to see them according to each owner's granular visibility settings.
async function applyCollectionVisibilityFilters(result, reqUser, userMap) {
  if (!result || !result.records) return result;
  const view = async (ownerId, key) => {
    return canViewCollection(reqUser, ownerId, { visibilityKey: key });
  };
  const aId = String(result.users.userA.id);
  const bId = String(result.users.userB.id);
  const [seePriorityA, seeNotesA, seePriorityB, seeNotesB] = await Promise.all([
    view(aId, "priorities"),
    view(aId, "notes"),
    view(bId, "priorities"),
    view(bId, "notes")
  ]);

  const filterRecord = (r) => ({
    ...r,
    userA: {
      ...r.userA,
      priority: seePriorityA ? r.userA.priority : "none",
      note: seeNotesA ? r.userA.note : ""
    },
    userB: {
      ...r.userB,
      priority: seePriorityB ? r.userB.priority : "none",
      note: seeNotesB ? r.userB.note : ""
    }
  });

  const records = result.records.map(filterRecord);
  const groups = {};
  for (const [key, list] of Object.entries(result.groups)) {
    groups[key] = list.map(filterRecord);
  }
  return { ...result, records, groups };
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
  const collection = {};
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

// ── Compare share tokens ──
app.post("/api/compare/share", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const ownerRes = await pool.query(
      `SELECT privacy, collection_visibility, visibility FROM users WHERE id = $1 AND deleted_at IS NULL
         AND (suspended_until IS NULL OR suspended_until < NOW())`,
      [reqUser]
    );
    if (!ownerRes.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const ownerVisibility = getVisibility(ownerRes.rows[0]);
    if (ownerVisibility.collection === "private") {
      return res.status(403).json({ error: "Impossible de partager une collection privée" });
    }

    const duration = req.body?.duration || "24h";
    const expiresAt = computeDurationExpiry(duration);
    const token = crypto.randomBytes(32).toString("hex");
    const collectionVisible = req.body?.collectionVisible !== false;
    const showNotes = !!req.body?.showNotes;
    const showPriorities = req.body?.showPriorities !== false;
    const allowVisitorCompare = req.body?.allowVisitorCompare !== false;

    const insert = await pool.query(
      `INSERT INTO compare_share_tokens (token, owner_user_id, expires_at, collection_visible, show_notes, show_priorities, allow_visitor_compare)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7) RETURNING id, token, expires_at, created_at`,
      [token, reqUser, expiresAt, collectionVisible, showNotes, showPriorities, allowVisitorCompare]
    );

    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_created", status: "ok" });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "comparison_shared", details: { duration, source: "compare" } });
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event: "compare_invitation_generated", details: { source: "compare" } });
    const shareUrl = `${req.protocol}://${req.get("host")}/compare/share/${token}`;
    let qr = null;
    try {
      qr = await QRCode.toDataURL(shareUrl, { type: "image/png", margin: 2, width: 300, errorCorrectionLevel: "M" });
    } catch (qrErr) {
      console.error("[/api/compare/share qr]", qrErr);
    }
    res.json({
      token,
      url: shareUrl,
      qr,
      expiresAt: insert.rows[0].expires_at,
      createdAt: insert.rows[0].created_at,
      options: { collectionVisible, showNotes, showPriorities, allowVisitorCompare }
    });
  } catch (err) {
    console.error("[/api/compare/share]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/share/:token", async (req, res) => {
  try {
    const token = req.params.token;
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: "Token invalide" });

    const tokenRes = await pool.query(
      `SELECT t.*, u.username as owner_username, u.collection_visibility, u.privacy, u.visibility
       FROM compare_share_tokens t
       JOIN users u ON u.id = t.owner_user_id
       WHERE t.token = $1 AND t.revoked_at IS NULL
         AND (t.expires_at IS NULL OR t.expires_at > NOW())
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())`,
      [token]
    );
    if (!tokenRes.rows.length) return res.status(404).json({ error: "Lien invalide, expiré ou révoqué" });
    const share = tokenRes.rows[0];
    const visitor = await getRequestingUser(req);
    const canAccess = await canViewCollection(visitor, share.owner_user_id, { shareToken: token });
    if (!canAccess) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    await pool.query("UPDATE compare_share_tokens SET last_used_at = NOW() WHERE id = $1", [share.id]);

    const ownerCollection = await loadCollectionForShare(share.owner_user_id, share);
    let visitorCollection = {};
    let visitorName = "Visiteur";
    if (visitor && share.allow_visitor_compare) {
      visitorCollection = await loadServerCompareCollection(visitor);
      const visitorRes = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [visitor]);
      if (visitorRes.rows.length) visitorName = visitorRes.rows[0].username;
    }

    const userA = { id: share.owner_user_id, displayName: share.owner_username, collection: ownerCollection };
    const userB = { id: visitor || "visitor", displayName: visitorName, collection: visitorCollection };
    const catalogue = await getServerCompareCatalogItemsCached();
    const result = compareCollectionsServer(userA, userB, catalogue);

    analytics.logCompareAnalyticsEvent(pool, { userId: visitor, event: "comparison_viewed", details: { source: "share", ownerId: share.owner_user_id } });

    res.json({
      token,
      accessReason: "shared_link",
      options: {
        collectionVisible: share.collection_visible,
        showNotes: !!share.show_notes,
        showPriorities: !!share.show_priorities,
        allowVisitorCompare: !!share.allow_visitor_compare
      },
      result
    });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.delete("/api/compare/share/:token", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const result = await pool.query(
      "UPDATE compare_share_tokens SET revoked_at = NOW() WHERE token = $1 AND owner_user_id = $2 RETURNING id",
      [req.params.token, reqUser]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Lien non trouvé" });
    secLog.logSecurityEvent(pool, { req, userId: reqUser, event: "compare_share_revoked", status: "ok" });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/compare/share/:token]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/compare/shares", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const result = await pool.query(
      `SELECT token, expires_at, revoked_at, collection_visible, show_notes, show_priorities, allow_visitor_compare, created_at, last_used_at
       FROM compare_share_tokens
       WHERE owner_user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC`,
      [reqUser]
    );
    res.json({ shares: result.rows });
  } catch (err) {
    console.error("[/api/compare/shares]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Quick compare with a target user ──
// GET /api/compare/:friendId compares the current user's collection with another user.
// Accepts a numeric id or a username. Access is determined by the central visibility engine
// (friend, shared_squad, public_profile). The response includes the access reason.
app.get("/api/compare/:friendId", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const targetUser = await resolveCompareUser(req.params.friendId);
    if (!targetUser) return res.status(404).json({ error: "Utilisateur non trouvé" });
    if (String(targetUser.id) === String(reqUser)) {
      return res.status(400).json({ error: "Tu ne peux pas te comparer toi-même" });
    }

    const result = await buildCompareResult(reqUser, targetUser, "quick_compare", req.query);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[/api/compare/:friendId]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Compare two users by username / id ──
// GET /api/compare/:userA/:userB returns the comparison between two users.
// The requesting user must be one of the two users. Access reason is returned.
app.get("/api/compare/:userA/:userB", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });

    const a = await resolveCompareUser(req.params.userA);
    const b = await resolveCompareUser(req.params.userB);
    if (!a || !b) return res.status(404).json({ error: "Utilisateur non trouvé" });

    let targetUser = b;
    if (String(reqUser) === String(a.id)) {
      targetUser = b;
    } else if (String(reqUser) === String(b.id)) {
      targetUser = a;
    } else {
      return res.status(403).json({ error: "Vous ne pouvez pas accéder à cette comparaison" });
    }
    if (String(targetUser.id) === String(reqUser)) {
      return res.status(400).json({ error: "Tu ne peux pas te comparer toi-même" });
    }

    const result = await buildCompareResult(reqUser, targetUser, "user_compare", req.query);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("[/api/compare/:userA/:userB]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Compare analytics ──
const COMPARE_ANALYTICS_EVENTS_SET = analytics.COMPARE_ANALYTICS_EVENTS;

app.post("/api/analytics/compare", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    const { event, details } = req.body || {};
    if (!event || !COMPARE_ANALYTICS_EVENTS_SET.has(event)) {
      return res.status(400).json({ error: "Événement inconnu" });
    }
    const cleanDetails = details && typeof details === "object" ? details : {};
    analytics.logCompareAnalyticsEvent(pool, { userId: reqUser, event, details: cleanDetails });
    res.json({ ok: true });
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/analytics/compare", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const metrics = await analytics.getCompareAnalyticsMetrics(pool, { days });
    res.json(metrics);
  } catch (err) {
    console.error("[/api/analytics/compare]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/analytics/product", async (req, res) => {
  try {
    const reqUser = await getRequestingUser(req);
    if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const metrics = await analytics.getProductAnalyticsMetrics(pool, { days });
    res.json(metrics);
  } catch (err) {
    console.error("[/api/analytics/product]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { COMPARE_ANALYTICS_EVENTS_SET, COMPARE_CACHE_TTL_MS, COMPARE_SERVER_RULES, MAX_COMPARE_RESULT_CACHE, applyServerCompareFilters, buildSquadCollectionMatrix, compareCatalogCache, compareCollectionsServer, compareResultCache, compareServerClassify, compareServerDefaultEntry, compareServerIsExplicitEntry, compareServerIsMissing, compareServerIsOwned, compareServerIsPriority, compareServerIsRecommend, compareServerIsUnknown, computeComplementarityScore, computeDurationExpiry, countServerExplicitCollectionEntries, getCachedCompareResult, getCompareCacheKey, getServerCompareCatalogItems, getServerCompareCatalogItemsCached, getSquadCollectiveCompletion, getSquadCollectiveCompletionSummary, getSquadMissingVariants, getSquadRecommendations, getSquadSharedVariants, getSquadUniqueOwners, invalidateCompareCacheForUser, isVariantReleasedAndActiveServer, loadCollectionForShare, loadServerCompareCollection, pruneCompareResultCache, setCachedCompareResult };
