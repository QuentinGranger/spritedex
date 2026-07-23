// server/recommendations.js — complementarity recommendations between a user and their friends / squad members.

const { canViewCollection, getRequestingUser, isBlocked } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const compare = require("./compare");

const RARITY_WEIGHTS = {
  mythic: 3,
  legendary: 2.5,
  epic: 1.8,
  rare: 1.2,
  uncommon: 0.9,
  common: 0.6
};

function getRarityWeight(rarity) {
  return RARITY_WEIGHTS[(rarity || "").toLowerCase()] || 1;
}

function getAvailabilityFactor(item) {
  if (item.available === false) return 0.2;
  const status = (item.availabilityStatus || "").toLowerCase();
  if (status === "available") return 1;
  if (status === "seasonal" || status === "event") return 0.7;
  if (status === "unavailable") return 0.2;
  return 0.8;
}

function classifyCollectionEntry(collection, variantId) {
  return compare.compareServerClassify(collection[variantId] || compare.compareServerDefaultEntry());
}

function isPriorityEntry(collection, variantId) {
  return compare.compareServerIsPriority(collection[variantId] || compare.compareServerDefaultEntry());
}

function buildOwnedSet(collection, catalogue) {
  const set = new Set();
  for (const item of catalogue) {
    if (classifyCollectionEntry(collection, item.id) === "owned") set.add(item.id);
  }
  return set;
}

function buildPrioritySet(collection, catalogue) {
  const set = new Set();
  for (const item of catalogue) {
    if (isPriorityEntry(collection, item.id)) set.add(item.id);
  }
  return set;
}

async function fetchCandidateUsers(reqUser) {
  const result = await pool.query(
    `SELECT DISTINCT u.id, u.username, u.display_name, u.avatar_url, u.collection_visibility, u.visibility
     FROM (
       SELECT u.id, u.username, u.display_name, u.avatar_url, u.collection_visibility, u.visibility
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE (f.requester_id = $1 OR f.addressee_id = $1)
         AND f.status = 'accepted'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
       UNION
       SELECT u.id, u.username, u.display_name, u.avatar_url, u.collection_visibility, u.visibility
       FROM squad_members sm
       JOIN squad_members sm2 ON sm.squad_id = sm2.squad_id
       JOIN users u ON u.id = sm2.user_id
       WHERE sm.user_id = $1
         AND sm.status = 'active'
         AND sm2.user_id != $1
         AND sm2.status = 'active'
         AND u.deleted_at IS NULL
         AND (u.suspended_until IS NULL OR u.suspended_until < NOW())
     ) u
     ORDER BY u.username`,
    [reqUser]
  );
  return result.rows;
}

async function fetchUserSquads(reqUser) {
  const result = await pool.query(
    `SELECT s.id, s.code, s.name, ARRAY_AGG(sm.user_id) AS members
     FROM squads s
     JOIN squad_members sm ON sm.squad_id = s.id
     JOIN squad_members me ON me.squad_id = s.id AND me.user_id = $1 AND me.status = 'active'
     WHERE sm.status = 'active'
     GROUP BY s.id, s.code, s.name`,
    [reqUser]
  );
  const squads = result.rows.map(r => ({ id: r.id, code: r.code, name: r.name, members: r.members || [] }));
  for (const squad of squads) {
    const visible = await Promise.all(
      squad.members.map(async (memberId) => ({ memberId, blocked: await isBlocked(reqUser, memberId) }))
    );
    squad.members = visible.filter(v => !v.blocked).map(v => v.memberId);
  }
  return squads;
}

function makeEntry(owned, priority) {
  if (owned) return { status: "owned", priority: "none", note: "" };
  if (priority) return { status: "priority", priority: "high", note: "" };
  return { status: "missing", priority: "none", note: "" };
}

function computeCandidateMetrics(userOwned, userPriority, candidateCollection, catalogue, itemMap) {
  const candidateOwned = buildOwnedSet(candidateCollection, catalogue);
  const candidatePriority = buildPrioritySet(candidateCollection, catalogue);

  const missingForUser = [];
  const priorityMatches = [];
  const records = [];

  for (const item of catalogue) {
    const aOwned = userOwned.has(item.id);
    const bOwned = candidateOwned.has(item.id);
    const aPrio = userPriority.has(item.id);
    const bPrio = candidatePriority.has(item.id);
    records.push({
      ...item,
      userA: makeEntry(aOwned, aPrio),
      userB: makeEntry(bOwned, bPrio)
    });

    if (bOwned && !aOwned) {
      missingForUser.push(item.id);
      if (aPrio) priorityMatches.push(item.id);
    }
  }

  const availableMissing = missingForUser.filter(id => {
    const item = itemMap.get(id);
    return item && item.available !== false && (item.availabilityStatus || "").toLowerCase() !== "unavailable";
  });

  const union = new Set(userOwned);
  for (const variantId of candidateOwned) union.add(variantId);
  const jointCoverage = catalogue.length ? union.size / catalogue.length : 0;

  const inter = new Set([...candidateOwned].filter(v => userOwned.has(v))).size;
  const collectiveOwned = userOwned.size + candidateOwned.size - inter;
  const onlyOne = collectiveOwned - inter;
  const complementarityRate = collectiveOwned ? Math.round((onlyOne / collectiveOwned) * 10000) / 100 : 0;
  const score = compare.computeComplementarityScore(complementarityRate, records);

  const rarityMap = new Map();
  for (const item of catalogue) {
    if (!rarityMap.has(item.rarity)) rarityMap.set(item.rarity, []);
    rarityMap.get(item.rarity).push(item);
  }
  const jointCoverageByRarity = {};
  for (const [rarity, items] of rarityMap) {
    const total = items.length;
    if (!total) continue;
    const owned = items.filter(i => userOwned.has(i.id) || candidateOwned.has(i.id)).length;
    jointCoverageByRarity[rarity] = {
      total,
      owned,
      coverage: total ? Math.round((owned / total) * 10000) / 100 : 0
    };
  }

  return {
    missingCount: missingForUser.length,
    priorityMatchCount: priorityMatches.length,
    availableMissingCount: availableMissing.length,
    complementarityRate,
    score,
    jointCoverage: Math.round(jointCoverage * 10000) / 100,
    jointCoverageByRarity,
    candidateOwned,
    candidatePriority
  };
}

function pickCandidateSummary(c) {
  return {
    userId: c.id,
    username: c.username,
    displayName: c.display_name,
    avatarUrl: c.avatar_url || "",
    score: c.score,
    missingCount: c.missingCount,
    priorityMatchCount: c.priorityMatchCount,
    availableMissingCount: c.availableMissingCount,
    jointCoverage: c.jointCoverage,
    jointCoverageByRarity: c.jointCoverageByRarity
  };
}

async function getRecommendations(reqUser) {
  const [catalogueAll, userCollection] = await Promise.all([
    compare.getServerCompareCatalogItemsCached(),
    compare.loadServerCompareCollection(reqUser)
  ]);
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const itemMap = new Map(catalogue.map(i => [i.id, i]));
  const total = catalogue.length;

  const userOwned = buildOwnedSet(userCollection, catalogue);
  const userPriority = buildPrioritySet(userCollection, catalogue);

  const collectionCache = new Map([[String(reqUser), userCollection]]);

  const candidateRows = await fetchCandidateUsers(reqUser);
  const candidates = [];

  for (const row of candidateRows) {
    if (String(row.id) === String(reqUser)) continue;
    if (!(await canViewCollection(reqUser, row.id))) continue;

    let cCollection = collectionCache.get(String(row.id));
    if (!cCollection) {
      cCollection = await compare.loadServerCompareCollection(row.id);
      collectionCache.set(String(row.id), cCollection);
    }

    const metrics = computeCandidateMetrics(userOwned, userPriority, cCollection, catalogue, itemMap);
    candidates.push({
      ...row,
      ...metrics,
      collection: cCollection
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const mostComplementary = candidates[0] || null;

  const squads = await fetchUserSquads(reqUser);
  const squadAdditions = [];

  for (const squad of squads) {
    const memberCollections = await Promise.all(
      squad.members.map(async (memberId) => {
        const key = String(memberId);
        if (collectionCache.has(key)) return collectionCache.get(key);
        const c = await compare.loadServerCompareCollection(memberId);
        collectionCache.set(key, c);
        return c;
      })
    );

    const currentOwned = new Set();
    for (const c of memberCollections) {
      for (const item of catalogue) {
        if (classifyCollectionEntry(c, item.id) === "owned") currentOwned.add(item.id);
      }
    }
    const currentRate = total ? currentOwned.size / total : 0;

    let best = null;
    for (const cand of candidates) {
      if (squad.members.some(m => String(m) === String(cand.id))) continue;

      const newOwned = new Set(currentOwned);
      for (const item of catalogue) {
        if (classifyCollectionEntry(cand.collection, item.id) === "owned") newOwned.add(item.id);
      }
      const newRate = total ? newOwned.size / total : 0;
      const gain = newRate - currentRate;

      if (!best || gain > best.gain || (gain === best.gain && cand.score > best.candidate.score)) {
        best = { candidate: cand, newRate, gain };
      }
    }

    if (best && best.gain > 0) {
      squadAdditions.push({
        squadId: squad.id,
        code: squad.code,
        name: squad.name,
        currentRate: Math.round(currentRate * 10000) / 100,
        newRate: Math.round(best.newRate * 10000) / 100,
        gain: Math.round(best.gain * 10000) / 100,
        candidate: pickCandidateSummary(best.candidate)
      });
    }
  }

  return {
    totalVariants: total,
    ownedCount: userOwned.size,
    ownedRate: total ? Math.round((userOwned.size / total) * 10000) / 100 : 0,
    mostComplementary: mostComplementary ? pickCandidateSummary(mostComplementary) : null,
    friends: candidates.slice(0, 20).map(pickCandidateSummary),
    squadAdditions
  };
}

app.get("/api/recommendations", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const result = await getRecommendations(reqUser);
    res.json(result);
  } catch (err) {
    console.error("[/api/recommendations]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { getRecommendations };
