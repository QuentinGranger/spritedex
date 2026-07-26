// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Collector Passport (Étapes 1–10)
// Run against a live server: node server.js, then npm run test:passport
// ─────────────────────────────────────────────────────────────────
process.env.APP_URL ||= "http://localhost:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const assert = require("node:assert");
const { passportReliability, buildBadges, computePassportProgress, computeOwnedRarityStats } = require("../server/passport");
const { sameVariantSet } = require("../server/passport-achievements");
const { OFFICIAL_RARITY_SCORE, specialVariantScore } = require("../server/passport-math");
const {
  resolveCompareSource,
  isCountableCompareResult,
  recordComparisonSession,
  getComparisonStatsForUser,
  ensureComparisonSessionsTable
} = require("../server/comparison-sessions");
const {
  ensurePassportActivityTable,
  recordOwnedVariants,
  listRecentActivity,
  writeActivity,
  ALLOWED_ACTIVITY_TYPES,
  ACTIVITY_FEED_LIMIT
} = require("../server/passport-activity");
const {
  ensurePassportBadgeTables,
  evaluateBadgeCondition,
  listBadgeDefinitions,
  listUserBadges,
  VERIFICATION_STATUSES,
  meetsCompletionThreshold,
  evaluateAndAwardComplementaryBadge
} = require("../server/passport-badges");
const { pool } = require("../server/db");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const API = `${BASE}/api`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

function rnd() {
  return Math.random().toString(36).slice(2, 10);
}

async function register(username) {
  const email = `${username}_${rnd()}@example.com`;
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password: "password123",
      username,
      ageConfirmed: true,
      cguAccepted: true
    })
  });
  const data = await res.json();
  assert.ok(res.ok, `register failed: ${JSON.stringify(data)}`);
  return { id: data.id, token: data.token, username };
}

function auth(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function cleanup(user) {
  if (!user) return;
  await fetch(`${API}/profile/${user.id}`, { method: "DELETE", headers: auth(user.token) });
}

async function getPassport(token, userId) {
  const res = await fetch(`${API}/profile/${userId}/passport`, { headers: auth(token) });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function setEntry(token, userId, variantId, status) {
  const res = await fetch(`${API}/collection/${userId}/${encodeURIComponent(variantId)}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ status })
  });
  assert.ok(res.ok, `setEntry failed: ${await res.text()}`);
}

async function getActiveVariants(token) {
  const res = await fetch(`${API}/sprites`, { headers: auth(token) });
  assert.ok(res.ok, "sprites failed");
  const { sprites } = await res.json();
  const excluded = new Set(["unreleased", "upcoming", "coming_soon", "soon", "unknown"]);
  const ids = [];
  const bySprite = new Map();
  for (const sprite of sprites) {
    for (const variant of Object.values(sprite.variantDetails || {})) {
      const release = String(variant.releaseStatus || "").toLowerCase();
      if (variant.available === false || excluded.has(release)) continue;
      ids.push(variant.id);
      if (!bySprite.has(sprite.id)) bySprite.set(sprite.id, []);
      bySprite.get(sprite.id).push(variant.id);
    }
  }
  return { ids, bySprite };
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX passport tests against ${BASE}\n`);

  await test("fiabilité : niveaux complete / usable / insufficient", () => {
    assert.strictEqual(passportReliability(90, 100).level, "complete");
    assert.strictEqual(passportReliability(60, 100).level, "usable");
    assert.strictEqual(passportReliability(59.99, 100).level, "insufficient");
    assert.strictEqual(passportReliability(82, 82).rate, 100);
  });

  await test("progression : taux précis + affichage + prochaine étape (Étapes 13–14)", () => {
    const progress = computePassportProgress(64, 82);
    assert.ok(Math.abs(progress.completionRatePrecise - (64 / 82) * 100) < 1e-9);
    assert.strictEqual(progress.completionRate, 78.05);
    assert.strictEqual(progress.completionRateDisplay, 78.1);
    assert.ok(progress.nextStep);
    assert.strictEqual(progress.nextStep.targetPercent, 90);
    assert.strictEqual(progress.nextStep.remainingVariants, 10);
    assert.match(progress.nextStep.label, /10 variantes avant 90/);
  });

  await test("versions d’événement : comparaison de sets (Étape 18)", () => {
    assert.ok(sameVariantSet(["a", "b"], ["b", "a"]));
    assert.ok(!sameVariantSet(["a", "b"], ["a", "b", "c"]));
  });

  await test("sessions de comparaison : source + résultat comptable (Étapes 27–28)", () => {
    assert.strictEqual(resolveCompareSource("quick_compare"), "friends_list");
    assert.strictEqual(resolveCompareSource("passport"), "passport");
    assert.strictEqual(resolveCompareSource("share"), "shared_link");
    assert.strictEqual(resolveCompareSource("api", "direct"), "squad");
    assert.ok(!isCountableCompareResult({ summary: { insufficientData: true, catalogueVariantCount: 10 } }));
    assert.ok(isCountableCompareResult({ summary: { insufficientData: false, catalogueVariantCount: 10 } }));
  });

  await test("activité : types autorisés + regroupement 10 min (Étapes 31–34)", async () => {
    await ensurePassportActivityTable(pool);
    assert.ok(ALLOWED_ACTIVITY_TYPES.includes("variants_owned"));
    assert.ok(!ALLOWED_ACTIVITY_TYPES.includes("missing"));
    assert.strictEqual(ACTIVITY_FEED_LIMIT, 10);

    const blocked = await writeActivity({
      userId: 1,
      activityType: "privacy_changed",
      data: {}
    });
    assert.strictEqual(blocked, null);

    // Use a disposable user via register later for DB writes — pure grouping unit via fake user cleanup.
    const u = await register(`PpAct${rnd()}`);
    try {
      await recordOwnedVariants(u.id, ["v1", "v2", "v3"]);
      await recordOwnedVariants(u.id, ["v4", "v5"]);
      const feed = await listRecentActivity(u.id);
      assert.ok(feed.length >= 1);
      assert.strictEqual(feed[0].activityType, "variants_owned");
      assert.strictEqual(feed[0].data.count, 5, "bulk owned adds must group into one activity");
      assert.ok(feed.length <= 10);
    } finally {
      await cleanup(u);
    }
  });

  await test("badges : définitions officielles + progression (Étapes 35–40)", async () => {
    await ensurePassportBadgeTables(pool);
    const defs = await listBadgeDefinitions();
    assert.ok(defs.length >= 5);
    assert.ok(defs.every((d) => d.ruleType || d.rule_type));
    assert.ok(defs.some((d) => d.code === "first_collection"));
    assert.ok(defs.some((d) => d.code === "collection_25"));
    assert.ok(defs.some((d) => d.code === "collection_50"));
    assert.ok(defs.some((d) => d.code === "collection_75"));
    assert.ok(defs.some((d) => d.code === "collection_100"));
    assert.ok(defs.some((d) => d.code === "squad_founder"));
    assert.ok(defs.some((d) => d.code === "complementary_collection"));
    assert.ok(VERIFICATION_STATUSES.includes("declared"));
    assert.ok(VERIFICATION_STATUSES.includes("system_confirmed"));
    assert.ok(VERIFICATION_STATUSES.includes("community_verified"));
    assert.ok(VERIFICATION_STATUSES.includes("officially_verified"));
    const progression = defs.filter((d) => /^collection_\d+$/.test(d.code));
    assert.ok(progression.every((d) => (d.ruleType || d.rule_type) === "completion_threshold"));
    const first = defs.find((d) => d.code === "first_collection");
    assert.strictEqual(first.ruleType || first.rule_type, "first_owned_transition");
    const founder = defs.find((d) => d.code === "squad_founder");
    assert.strictEqual(founder.ruleType || founder.rule_type, "squad_founder_qualified");
    assert.ok(evaluateBadgeCondition({ type: "owned_variant_count", min: 1 }, { ownedVariantCount: 1 }));
    assert.ok(!evaluateBadgeCondition({ type: "owned_variant_count", min: 1 }, { ownedVariantCount: 0 }));
  });

  await test("badges : précision seuil 75 % (Étape 41)", () => {
    assert.ok(!meetsCompletionThreshold(74.999, 75));
    assert.ok(meetsCompletionThreshold(75, 75));
    assert.ok(meetsCompletionThreshold(75.001, 75));
    assert.ok(!meetsCompletionThreshold(74.9, 75));
    assert.ok(!evaluateBadgeCondition(
      { type: "completion_rate", min: 75 },
      { completionRatePrecise: 74.999, completionRateDisplay: 75 }
    ), "display rounding must not unlock");
    assert.ok(evaluateBadgeCondition(
      { type: "completion_rate", min: 75 },
      { completionRatePrecise: 75, completionRateDisplay: 75 }
    ));
  });

  await test("badges : complémentarité refuse les faux comptes (Étape 45)", async () => {
    const empty = await evaluateAndAwardComplementaryBadge(1, 1, {
      summary: { insufficientData: false, catalogueVariantCount: 10 }
    });
    assert.strictEqual(empty.skippedReason, "same_or_invalid_users");

    const insufficient = await evaluateAndAwardComplementaryBadge(1, 2, {
      summary: { insufficientData: true, catalogueVariantCount: 10 }
    });
    assert.strictEqual(insufficient.skippedReason, "insufficient_data");
  });

  await test("badges : archiviste / early / raretés / événements (Étapes 46–50)", async () => {
    await ensurePassportBadgeTables(pool);
    const {
      EARLY_COLLECTOR_BEFORE,
      recordCatalogueReview,
      evaluateArchivistQualified,
      evaluateEarlyCollectorQualified,
      requiredRaritiesFromCatalogue,
      evaluateAllRaritiesOwned
    } = require("../server/passport-badges");

    const defs = await listBadgeDefinitions();
    assert.ok(defs.some((d) => d.code === "archivist"));
    assert.ok(defs.some((d) => d.code === "early_collector"));
    assert.ok(defs.some((d) => d.code === "all_rarities"));
    assert.ok(defs.some((d) => d.code === "event_completed"));
    const early = defs.find((d) => d.code === "early_collector");
    assert.ok(early.ruleConfig.before || early.rule_config?.before);
    assert.ok(String(EARLY_COLLECTOR_BEFORE).includes("2026-10-01"));

    const rarities = requiredRaritiesFromCatalogue([
      { id: "1", rarity: "common" },
      { id: "2", rarity: "mythic" },
      { id: "3", rarity: "Gold" }
    ]);
    assert.ok(rarities.includes("common"));
    assert.ok(rarities.includes("mythic"));
    assert.ok(!rarities.includes("gold"));

    const all = evaluateAllRaritiesOwned(
      [
        { id: "1", rarity: "rare" },
        { id: "2", rarity: "epic" },
        { id: "3", rarity: "legendary" }
      ],
      ["1", "2"]
    );
    assert.ok(!all.qualified);
    assert.deepStrictEqual(all.required, ["rare", "epic", "legendary"]);

    const u = await register(`PpArch${rnd()}`);
    try {
      await recordCatalogueReview(u.id, "v1", 91);
      await recordCatalogueReview(u.id, "v2", 92);
      assert.ok(!(await evaluateArchivistQualified(u.id)));
      await recordCatalogueReview(u.id, "v3", 93);
      assert.ok(await evaluateArchivistQualified(u.id));

      // Early collector without verified email / owned → false
      assert.ok(!(await evaluateEarlyCollectorQualified(u.id, { before: "2099-01-01T00:00:00.000Z" })));
    } finally {
      await cleanup(u);
    }
  });

  await test("badges : progression locked + moteur sélectif + dédup (Étapes 51–54)", async () => {
    const {
      BADGE_TRIGGERS,
      buildBadgeUnlockDedupeKey,
      liveProgressForBadge,
      evaluateUserBadges
    } = require("../server/badge-engine");

    assert.ok(BADGE_TRIGGERS["collection.variant_acquired"].includes("collection_100"));
    assert.ok(BADGE_TRIGGERS["comparison.generated"].includes("complementary_collection"));
    assert.strictEqual(
      buildBadgeUnlockDedupeKey(42, "first_collection"),
      "badge_unlock:first_collection:42"
    );
    assert.ok(
      buildBadgeUnlockDedupeKey(42, "event_completed", "event_version", "uuid-1")
        .includes("event_version:uuid-1")
    );

    const live = liveProgressForBadge(
      { ruleType: "completion_threshold", ruleConfig: { threshold: 100 } },
      { ownedVariantCount: 64, releasedVariantCount: 82 }
    );
    assert.strictEqual(live.progressValue, 64);
    assert.strictEqual(live.targetValue, 82);
    assert.strictEqual(live.progressRate, 78.05);
    assert.strictEqual(live.remaining, 18);

    await ensurePassportBadgeTables(pool);
    const u = await register(`PpEng${rnd()}`);
    try {
      // Selective eval with empty collection should not throw.
      const result = await evaluateUserBadges(u.id, "account.created", { notify: false });
      assert.strictEqual(result.trigger, "account.created");
      assert.ok(Array.isArray(result.unlocked));

      // Idempotent award: second evaluate of same state unlocks nothing new.
      const again = await evaluateUserBadges(u.id, "account.created", { notify: false });
      assert.strictEqual(again.unlocked.length, 0);
    } finally {
      await cleanup(u);
    }
  });

  await test("instantanés + badge épinglé (Étapes 56 & 59)", async () => {
    const {
      ensurePassportStatSnapshots,
      maybeCreatePassportStatSnapshot,
      getLatestSnapshot,
      SNAPSHOT_REASONS
    } = require("../server/passport-snapshots");
    const { ensureCollectorPassport, resolveFeaturedBadge } = require("../server/passport");

    await ensurePassportStatSnapshots(pool);
    await ensurePassportBadgeTables(pool);
    const u = await register(`PpSnap${rnd()}`);
    try {
      const snap = await maybeCreatePassportStatSnapshot(u.id, {
        catalogueVersion: "test-v1",
        ownedSpriteCount: 1,
        ownedVariantCount: 2,
        releasedVariantCount: 10,
        completionRate: 20,
        collectionCoverageRate: 50,
        completedEventCount: 0,
        comparisonCount: 0
      }, { unlockedCodes: ["collection_25"], collectionChanged: true });
      assert.ok(snap);
      assert.ok([
        SNAPSHOT_REASONS.CATALOGUE_VERSION,
        SNAPSHOT_REASONS.MILESTONE,
        SNAPSHOT_REASONS.DAILY
      ].includes(snap.reason));
      const latest = await getLatestSnapshot(u.id);
      assert.ok(latest);
      assert.strictEqual(String(latest.catalogue_version), "test-v1");

      // Same catalogue + no change → no new snapshot
      const again = await maybeCreatePassportStatSnapshot(u.id, {
        catalogueVersion: "test-v1",
        ownedSpriteCount: 1,
        ownedVariantCount: 2,
        releasedVariantCount: 10,
        completionRate: 20,
        collectionCoverageRate: 50,
        completedEventCount: 0,
        comparisonCount: 0
      }, { unlockedCodes: [], collectionChanged: false });
      assert.strictEqual(again, null);

      await ensureCollectorPassport(u.id);
      const defs = await listBadgeDefinitions();
      const first = defs.find((d) => d.code === "first_collection");
      assert.ok(first);

      // Pin without unlock → reject via resolve (clear)
      await pool.query(
        "UPDATE collector_passports SET featured_badge_id = $1 WHERE user_id = $2",
        [first.id, u.id]
      );
      const cleared = await resolveFeaturedBadge(u.id, first.id);
      assert.strictEqual(cleared, null);
      const row = await pool.query(
        "SELECT featured_badge_id FROM collector_passports WHERE user_id = $1",
        [u.id]
      );
      assert.strictEqual(row.rows[0].featured_badge_id, null);
    } finally {
      await cleanup(u);
    }
  });

  await test("rareté officielle ≠ type de variante (Étapes 21–23)", () => {
    assert.strictEqual(OFFICIAL_RARITY_SCORE.common, 1);
    assert.strictEqual(OFFICIAL_RARITY_SCORE.mythic, 6);
    assert.strictEqual(specialVariantScore("Holofoil", "Base"), 4);
    assert.strictEqual(specialVariantScore("gold", "Gold"), 1);
    assert.strictEqual(specialVariantScore("Base", "Base"), 0);

    const catalogue = [
      { id: "1", rarity: "rare", variantType: "Base", variantName: "Base" },
      { id: "2", rarity: "mythic", variantType: "Gold", variantName: "Gold" },
      { id: "3", rarity: "common", variantType: "Holofoil", variantName: "Holofoil" },
      { id: "4", rarity: "legendary", variantType: "Gummy", variantName: "Gummy" }
    ];
    const empty = computeOwnedRarityStats(catalogue, []);
    assert.strictEqual(empty.display, "Aucune rareté débloquée");
    assert.strictEqual(empty.highestOfficialRarity, null);
    assert.ok(Array.isArray(empty.rarityBreakdown));
    assert.ok(Array.isArray(empty.variantTypeBreakdown));

    const stats = computeOwnedRarityStats(catalogue, ["1", "2", "3"]);
    assert.strictEqual(stats.highestOfficialRarity.key, "mythic");
    assert.strictEqual(stats.highestOfficialRarity.label, "Mythique");
    assert.strictEqual(stats.highestOfficialRarity.ownedCountAtRarity, 1);
    assert.strictEqual(stats.rarestSpecialVariant.key, "holofoil");
    assert.strictEqual(stats.rarestSpecialVariant.label, "Holofoil");
    assert.notStrictEqual(stats.highestOfficialRarity.key, "holofoil");
    assert.ok(stats.rarityBreakdown.some((r) => r.key === "rare" && r.ownedCount === 1));
    assert.ok(stats.variantTypeBreakdown.some((v) => v.key === "gold" && v.ownedCount === 1 && v.filter === "variant:Gold"));
    assert.ok(stats.variantTypeBreakdown.some((v) => v.key === "base"));
  });

  await test("badges déterministes sans classement mondial", () => {
    const badges = buildBadges({
      ownedCount: 3,
      discoveredCount: 5,
      completionRate: 50,
      reliability: { level: "complete" },
      squadCount: 1,
      friendCount: 1,
      eventsCompleted: 1
    });
    const ids = badges.map((b) => b.id);
    assert.ok(ids.includes("first_collection"));
    assert.ok(ids.includes("explorer"));
    assert.ok(ids.includes("collection_50"));
    assert.ok(!ids.some((id) => /rank|leaderboard|mondial/i.test(id)));
  });

  await test("statistiques : filtre catalogue + progression (Étape 80 unit)", () => {
    const { isVariantReleasedAndActiveServer } = require("../server/compare");
    const catalogue = [
      { id: "a1", spriteId: "A", rarity: "common", variantType: "Base", releaseStatus: "released", dataStatus: "active" },
      { id: "a2", spriteId: "A", rarity: "rare", variantType: "Gold", releaseStatus: "released", dataStatus: "active" },
      { id: "b1", spriteId: "B", rarity: "mythic", variantType: "Base", releaseStatus: "released", dataStatus: "active" },
      { id: "u1", spriteId: "U", rarity: "legendary", variantType: "Base", releaseStatus: "unreleased", dataStatus: "active" },
      { id: "x1", spriteId: "X", rarity: "epic", variantType: "Base", releaseStatus: "released", dataStatus: "archived" },
      { id: "y1", spriteId: "Y", rarity: "legendary", variantType: "Base", releaseStatus: "released", dataStatus: "legacy" }
    ];
    const live = catalogue.filter(isVariantReleasedAndActiveServer);
    assert.strictEqual(live.length, 3, "unreleased + archived + legacy excluded");
    assert.ok(!live.some((i) => i.id === "u1" || i.id === "x1" || i.id === "y1"));

    const ownedIds = new Set(["a1", "a2"]); // sprite A both variants
    const releasedSprites = new Set(live.map((i) => i.spriteId));
    const discovered = new Set(live.filter((i) => ownedIds.has(i.id)).map((i) => i.spriteId));
    assert.strictEqual(releasedSprites.size, 2);
    assert.strictEqual(discovered.size, 1, "distinct sprites owned");
    assert.strictEqual(ownedIds.size, 2, "variant count");

    const progress = computePassportProgress(ownedIds.size, live.length);
    assert.ok(Math.abs(progress.completionRatePrecise - (2 / 3) * 100) < 1e-9);

    const empty = computePassportProgress(0, live.length);
    assert.strictEqual(empty.completionRatePrecise, 0);
    assert.strictEqual(passportReliability(0, live.length).level, "insufficient");

    const partial = passportReliability(1, live.length);
    assert.ok(partial.rate < 90);

    const rarity = computeOwnedRarityStats(live, ownedIds);
    assert.strictEqual(rarity.highestOfficialRarity.key, "rare");
  });

  await test("intégrité : flips + imports incohérents + classements reportés (Étapes 77–79)", () => {
    const integrity = require("../server/passport-integrity");
    assert.ok(integrity.isOwnedMissingFlip("owned", "missing"));
    assert.ok(integrity.isOwnedMissingFlip("missing", "owned"));
    assert.ok(!integrity.isOwnedMissingFlip("owned", "priority"));

    const mass = integrity.summarizeChanges(
      Array.from({ length: 60 }, (_, i) => ({
        variantId: `v${i}`,
        oldStatus: "missing",
        newStatus: "owned"
      }))
    );
    assert.strictEqual(mass.changeCount, 60);
    assert.strictEqual(mass.ownedGains, 60);

    const incoherence = integrity.detectImportIncoherence({
      previousCount: 120,
      nextCount: 0,
      deletedCount: 120,
      changes: [],
      ownedRatio: 0
    });
    assert.ok(incoherence.flags.includes("import_large_deletion"));
    assert.ok(incoherence.flags.includes("import_wiped_collection"));

    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.globalLeaderboard, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.collectionTop, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.countryRanking, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.squadRanking, false);
    assert.strictEqual(integrity.PASSPORT_RANKINGS_DEFERRED.declaredCountRewards, false);
  });

  const owner = await register(`PpOwn${rnd()}`);
  const friend = await register(`PpFr${rnd()}`);
  const stranger = await register(`PpSt${rnd()}`);

  try {
    await test("passeport soi-même : contrat Étapes 1–3", async () => {
      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200, JSON.stringify(data));
      assert.ok(data.user && data.user.createdAt, "createdAt from users.created_at required");
      assert.ok(data.catalogue && data.catalogue.version, "catalogue.version required");
      assert.strictEqual(typeof data.catalogue.releasedSpriteCount, "number");
      assert.strictEqual(typeof data.catalogue.releasedVariantCount, "number");
      assert.ok(data.catalogue.releasedVariantCount >= 1);
      assert.ok(data.collection, "collection required");
      assert.strictEqual(typeof data.collection.discoveredSpriteCount, "number");
      assert.strictEqual(typeof data.collection.ownedVariantCount, "number");
      assert.strictEqual(typeof data.collection.completionRate, "number");
      assert.strictEqual(typeof data.collection.completionRatePrecise, "number");
      assert.ok(data.collection.catalogueVersion, "catalogueVersion stamped on collection (Étape 15)");
      assert.ok(data.collection.progress, "progress block required (Étape 14)");
      assert.strictEqual(data.collection.progress.catalogueVersion, data.collection.catalogueVersion);
      assert.ok(data.events, "events sections required (Étape 20)");
      assert.ok(Array.isArray(data.events.completed));
      assert.ok(Array.isArray(data.events.inProgress));
      assert.ok(Array.isArray(data.events.historical));
      assert.ok(data.collection.reliability);
      assert.ok(["complete", "usable", "insufficient"].includes(data.collection.reliability.level));
      assert.ok(Array.isArray(data.badges));
      assert.ok(Array.isArray(data.recentActivity));
      assert.ok(data.recentActivity.length <= 10, "Étape 33 — max 10 activités");
      assert.ok(data.social);
      if (data.social.comparisonCount != null) {
        assert.strictEqual(typeof data.social.distinctCollectorsCompared, "number");
      }
    });

    await test("accomplissements persistants + record historique (Étape 16)", async () => {
      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 1);
      await fetch(`${API}/collection/${owner.id}`, { method: "DELETE", headers: auth(owner.token) });
      // Seed enough owned entries to unlock first_collection, then demote later.
      await setEntry(owner.token, owner.id, ids[0], "owned");
      let pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(pass.data.badges.some((b) => b.id === "first_collection"), "first_collection should unlock");
      const unlockedAt = pass.data.badges.find((b) => b.id === "first_collection").unlockedAt;
      assert.ok(unlockedAt);
      assert.ok(pass.data.badges.find((b) => b.id === "first_collection").catalogueVersion);
      assert.strictEqual(
        pass.data.badges.find((b) => b.id === "first_collection").verificationStatus,
        "system_confirmed",
        "Étape 38/39 — first_collection is system_confirmed"
      );
      const fromTable = await listUserBadges(owner.id);
      assert.ok(fromTable.some((b) => b.id === "first_collection" || b.code === "first_collection"));
      const prog = fromTable.find((b) => b.code === "first_collection");
      assert.ok(prog);
      // Progression badges keep evidence; first_collection is not progression but unlock persists.
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "variants_owned" || a.type === "variants_owned"));
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "badge_unlocked" || a.type === "badge_unlocked"));

      await setEntry(owner.token, owner.id, ids[0], "missing");
      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(
        pass.data.badges.some((b) => b.id === "first_collection"),
        "badge must remain after rate drops (Étape 42 historical)"
      );
      assert.ok(pass.data.collection.historicalPeak, "historical peak required");
      assert.ok(Number(pass.data.collection.historicalPeak.completionRate) > 0);
      assert.ok(Array.isArray(pass.data.badgeProgress), "Étape 51 — badgeProgress required");
      const lockedProgression = pass.data.badgeProgress.find(
        (b) => b.badgeCode === "collection_100" && b.status === "locked"
      );
      assert.ok(lockedProgression, "collection_100 should appear as locked with progress");
      assert.strictEqual(typeof lockedProgression.progressValue, "number");
      assert.strictEqual(typeof lockedProgression.targetValue, "number");
      assert.strictEqual(typeof lockedProgression.progressRate, "number");
      assert.ok(pass.data.identity, "Étape 58 — identity block");
      assert.ok(pass.data.user.avatarUrl != null || pass.data.identity.avatarUrl != null);
      assert.ok(pass.data.collection.personalRecord || pass.data.collection.historicalPeak, "Étape 55");
      assert.ok(pass.data.collection.progress, "Étape 60 — progress block");
      assert.ok(pass.data.collection.reliabilityQuality || pass.data.collection.progress.quality);
      assert.ok(Array.isArray(pass.data.collection.rarityBreakdown), "Étape 61 — rarityBreakdown");
      assert.ok(Array.isArray(pass.data.collection.variantTypeBreakdown), "Étape 61 — variantTypeBreakdown");
      if (pass.data.events) {
        assert.ok(Array.isArray(pass.data.events.inProgress));
        assert.ok(Array.isArray(pass.data.events.recentlyCompleted) || Array.isArray(pass.data.events.completed));
      }
      assert.ok(pass.data.badgeProgress.every((b) => b.uiCategory), "Étape 63 — uiCategory");
      assert.ok(pass.data.recentActivity.some((a) => a.activityType === "account_created" || a.type === "account_created"));
      assert.ok(Array.isArray(pass.data.actions), "Étape 66 — actions");
      assert.ok(pass.data.actions.includes("share_passport"));
      assert.ok(pass.data.actions.includes("edit_profile"));
      assert.ok(pass.data.publicUrl && pass.data.publicUrl.startsWith("/u/"), "Étape 67 — publicUrl");
    });

    await test("actions contextuelles ami / public (Étape 66)", async () => {
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({
          passportVisibility: "friends",
          statisticsVisibility: "friends",
          comparisonsVisibility: "friends"
        })
      });
      await fetch(`${API}/friends/${friend.id}/request`, { method: "POST", headers: auth(owner.token) });
      await fetch(`${API}/friends/${owner.id}/accept`, { method: "POST", headers: auth(friend.token) });

      const friendView = await getPassport(friend.token, owner.id);
      assert.strictEqual(friendView.status, 200);
      assert.ok(friendView.data.relationship && friendView.data.relationship.isFriend);
      assert.ok(friendView.data.actions.includes("compare_collections"));
      assert.ok(friendView.data.actions.includes("invite_to_squad"));
      assert.ok(friendView.data.actions.includes("create_shared_goal"));
      assert.ok(!friendView.data.actions.includes("edit_profile"));

      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({
          passportVisibility: "public",
          statisticsVisibility: "public",
          comparisonsVisibility: "public"
        })
      });
      const strangerView = await getPassport(stranger.token, owner.id);
      assert.strictEqual(strangerView.status, 200);
      assert.ok(strangerView.data.actions.includes("add_friend"));
      assert.ok(strangerView.data.actions.includes("view_public_collection"));
    });

    await test("URL publique /u/:username + API normalisée (Étapes 67 & 70)", async () => {
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({
          passportVisibility: "public",
          statisticsVisibility: "public",
          badgesVisibility: "public",
          activityVisibility: "public"
        })
      });

      const byUsername = await fetch(`${API}/u/${encodeURIComponent(owner.username)}/passport`);
      assert.strictEqual(byUsername.status, 200);
      const normalized = await byUsername.json();
      assert.ok(normalized.user);
      assert.strictEqual(normalized.user.username, owner.username);
      assert.ok(String(normalized.user.id).startsWith("user_"));
      assert.ok(normalized.passport);
      assert.ok(normalized.passport.statistics);
      assert.strictEqual(typeof normalized.passport.statistics.completionRate, "number");
      assert.ok(normalized.publicUrl.startsWith("/u/"));
      assert.ok(!JSON.stringify(normalized).includes("@example.com"), "never leak email");

      const formatNorm = await fetch(
        `${API}/profile/${owner.id}/passport?format=normalized`,
        { headers: auth(owner.token) }
      );
      assert.strictEqual(formatNorm.status, 200);
      const selfNorm = await formatNorm.json();
      assert.ok(selfNorm.passport.statistics);
      assert.ok(Array.isArray(selfNorm.actions));
      assert.ok(selfNorm.actions.includes("share_passport"));

      const card = await fetch(`${API}/u/${encodeURIComponent(owner.username)}/passport/card`, {
        headers: auth(owner.token)
      });
      assert.strictEqual(card.status, 200);
      const cardData = await card.json();
      assert.strictEqual(cardData.username, owner.username);
      assert.ok(cardData.availableFields);
      assert.ok(!("email" in cardData));
      assert.ok(!("friends" in cardData));
      assert.ok(!("notes" in cardData));
    });

    await test("rename : redirect temporaire + réservation (Étape 67)", async () => {
      const oldUsername = owner.username;
      const newUsername = `ren_${rnd()}`.slice(0, 20);
      const patch = await fetch(`${API}/profile/${owner.id}`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ username: newUsername })
      });
      assert.ok(patch.ok, await patch.text());
      owner.username = newUsername;

      // Old slug redirects while reserved.
      const redirectApi = await fetch(`${API}/u/${encodeURIComponent(oldUsername)}/passport`, {
        redirect: "manual"
      });
      assert.ok([301, 302, 307, 308].includes(redirectApi.status), `expected redirect, got ${redirectApi.status}`);

      // Another user cannot take the reserved old username.
      const steal = await fetch(`${API}/profile/${stranger.id}`, {
        method: "PATCH",
        headers: auth(stranger.token),
        body: JSON.stringify({ username: oldUsername })
      });
      assert.strictEqual(steal.status, 409);

      // New slug resolves.
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ passportVisibility: "public", statisticsVisibility: "public" })
      });
      const ok = await fetch(`${API}/u/${encodeURIComponent(newUsername)}/passport`);
      assert.strictEqual(ok.status, 200);
    });

    await test("endpoints dédiés + résumé matérialisé (Étapes 71–72)", async () => {
      const me = await fetch(`${API}/passport/me`, { headers: auth(owner.token) });
      assert.strictEqual(me.status, 200);
      const meData = await me.json();
      assert.ok(meData.user && String(meData.user.id) === String(owner.id));
      assert.ok(meData.summary || (meData.collection && meData.collection.fromSummary));

      const byUser = await fetch(`${API}/users/${owner.id}/passport`, { headers: auth(owner.token) });
      assert.strictEqual(byUser.status, 200);

      const settings = await fetch(`${API}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ activityVisibility: "friends" })
      });
      assert.strictEqual(settings.status, 200);

      const badges = await fetch(`${API}/users/${owner.id}/badges`, { headers: auth(owner.token) });
      assert.strictEqual(badges.status, 200);
      const badgeData = await badges.json();
      assert.ok(Array.isArray(badgeData.badges));
      assert.ok(Array.isArray(badgeData.badgeProgress));

      const activity = await fetch(`${API}/users/${owner.id}/passport/activity`, {
        headers: auth(owner.token)
      });
      assert.strictEqual(activity.status, 200);
      const actData = await activity.json();
      assert.ok(Array.isArray(actData.recentActivity));

      const card = await fetch(`${API}/passport/share-card`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({
          format: "1200x630",
          showSquad: true,
          showBadges: true,
          showCompletion: true,
          showEvents: true,
          showJoinedAt: false
        })
      });
      assert.strictEqual(card.status, 200);
      const cardData = await card.json();
      assert.strictEqual(cardData.format, "1200x630");
      assert.ok(!("email" in cardData));
      assert.ok(cardData.publicUrl.startsWith("/u/"));

      const summaryMod = require("../server/passport-summary");
      await summaryMod.ensurePassportSummaryTables(pool);
      const summary = await summaryMod.getPassportSummary(owner.id);
      assert.ok(summary, "user_passport_summaries row required");
      assert.strictEqual(typeof summary.completionRate, "number");
      assert.ok(summary.catalogueVersion);
      assert.strictEqual(typeof summary.releasedVariantCount, "number");
    });

    await test("file de recalcul + catalogue (Étapes 74–75)", async () => {
      const summaryMod = require("../server/passport-summary");
      await summaryMod.ensurePassportSummaryTables(pool);
      const before = await summaryMod.getPassportSummary(owner.id);
      assert.ok(before);

      const jobId = await summaryMod.enqueuePassportRecalc(owner.id, {
        reason: "test.queue",
        triggerEvent: "collection.updated",
        collectionChanged: true,
        notify: false
      });
      assert.ok(jobId);

      const processed = await summaryMod.processPassportRecalcBatch(pool);
      assert.ok(processed >= 1);

      const after = await summaryMod.getPassportSummary(owner.id);
      assert.ok(after);
      assert.ok(new Date(after.recalculatedAt) >= new Date(before.recalculatedAt));

      // Étape 75 — bump released totals when catalogue "grows".
      const bumped = await summaryMod.handleCataloguePublished({
        previousVersion: before.catalogueVersion,
        newVersion: `${before.catalogueVersion}-testgrow`,
        previousReleasedVariantCount: before.releasedVariantCount,
        newReleasedVariantCount: before.releasedVariantCount + 2,
        previousReleasedSpriteCount: before.releasedSpriteCount,
        newReleasedSpriteCount: before.releasedSpriteCount + 1
      });
      assert.ok(bumped.enqueued >= 1);
      assert.strictEqual(bumped.addedVariantCount, 2);

      const mid = await summaryMod.getPassportSummary(owner.id);
      assert.strictEqual(mid.releasedVariantCount, before.releasedVariantCount + 2);
      assert.ok(mid.completionRate <= before.completionRate + 1e-6);

      // Drain queued catalogue jobs for this user at least once.
      await summaryMod.processPassportRecalcBatch(pool);
    });

    await test("unicité (user, variant) : une seule entrée active (Étape 12)", async () => {
      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids[0], "need a variant");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[0], "priority");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200);
      assert.ok(data.collection.ownedVariantCount >= 1);
      // Re-PUT same variant must not inflate owned count beyond distinct variants.
      const before = data.collection.ownedVariantCount;
      await setEntry(owner.token, owner.id, ids[0], "owned");
      const again = await getPassport(owner.token, owner.id);
      assert.strictEqual(again.data.collection.ownedVariantCount, before);
    });

    await test("Sprites découverts ≠ variantes possédées (Étape 2)", async () => {
      const { ids, bySprite } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 3, "need catalogue samples");
      let spriteId = null;
      let variants = [];
      for (const [sid, list] of bySprite.entries()) {
        if (list.length >= 2) {
          spriteId = sid;
          variants = list.slice(0, 2);
          break;
        }
      }
      assert.ok(spriteId && variants.length >= 2, "need a sprite with >= 2 released variants");

      // Isolate this assertion from earlier tests on the same user.
      await fetch(`${API}/collection/${owner.id}`, { method: "DELETE", headers: auth(owner.token) });
      await setEntry(owner.token, owner.id, variants[0], "owned");
      await setEntry(owner.token, owner.id, variants[1], "owned");

      const { status, data } = await getPassport(owner.token, owner.id);
      assert.strictEqual(status, 200);
      assert.ok(data.collection.discoveredSpriteCount >= 1, "at least 1 sprite discovered");
      assert.ok(data.collection.ownedVariantCount >= 2, "at least 2 variants owned");
      assert.ok(
        data.collection.ownedVariantCount >= data.collection.discoveredSpriteCount,
        "variants owned should be >= sprites discovered"
      );
      const ownedSet = new Set(variants);
      const other = ids.find((id) => !ownedSet.has(id));
      if (other) {
        const before = data.collection.ownedVariantCount;
        await setEntry(owner.token, owner.id, other, "priority");
        const again = await getPassport(owner.token, owner.id);
        assert.strictEqual(again.data.collection.ownedVariantCount, before, "priority must not count as owned");
      }
    });

    await test("visibilité : ami vs inconnu (Étapes 7–8)", async () => {
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ passportVisibility: "friends", comparisonsVisibility: "private" })
      });

      const blocked = await getPassport(stranger.token, owner.id);
      assert.strictEqual(blocked.status, 404, "stranger must not see friends-only passport");

      await fetch(`${API}/friends/${friend.id}/request`, { method: "POST", headers: auth(owner.token) });
      await fetch(`${API}/friends/${owner.id}/accept`, { method: "POST", headers: auth(friend.token) });

      const ok = await getPassport(friend.token, owner.id);
      assert.strictEqual(ok.status, 200, "accepted friend can view passport");
      assert.strictEqual(ok.data.social.comparisonCount, null, "comparisons stay private by default");
    });

    await test("réglages passeport : owner only", async () => {
      const res = await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        headers: auth(friend.token)
      });
      assert.strictEqual(res.status, 403);
    });

    await test("comparaisons : session unique + dédoublonnage 30 min (Étapes 27–30)", async () => {
      await ensureComparisonSessionsTable(pool);
      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({ comparisonsVisibility: "friends" })
      });

      const { ids } = await getActiveVariants(owner.token);
      assert.ok(ids.length >= 2, "need variants for countable compare");
      await setEntry(owner.token, owner.id, ids[0], "owned");
      await setEntry(owner.token, owner.id, ids[1], "missing");
      await setEntry(friend.token, friend.id, ids[0], "missing");
      await setEntry(friend.token, friend.id, ids[1], "owned");

      const before = await getPassport(owner.token, owner.id);
      assert.strictEqual(before.status, 200);
      const beforeCount = before.data.social.comparisonCount || 0;

      const cmp1 = await fetch(`${API}/compare/${friend.id}?source=friends_list`, { headers: auth(owner.token) });
      assert.ok(cmp1.ok, await cmp1.text());
      const after1 = await getPassport(owner.token, owner.id);
      assert.strictEqual(after1.data.social.comparisonCount, beforeCount + 1);
      assert.ok(after1.data.social.distinctCollectorsCompared >= 1);

      const cmp2 = await fetch(`${API}/compare/${friend.id}?source=friends_list`, { headers: auth(owner.token) });
      assert.ok(cmp2.ok, await cmp2.text());
      const after2 = await getPassport(owner.token, owner.id);
      assert.strictEqual(
        after2.data.social.comparisonCount,
        beforeCount + 1,
        "reload within window must not inflate counter"
      );

      // Direct unit path: same pair skipped.
      const fakeResult = { summary: { insufficientData: false, catalogueVariantCount: 10 } };
      const again = await recordComparisonSession({
        initiatorId: owner.id,
        comparedUserId: friend.id,
        source: "direct",
        catalogueVersion: "test",
        result: fakeResult
      });
      assert.strictEqual(again.counted, false);
      assert.strictEqual(again.skippedReason, "deduped");

      const stats = await getComparisonStatsForUser(owner.id);
      assert.strictEqual(stats.comparisonCount, after2.data.social.comparisonCount);
    });

    await test("squad principale : choix explicite + masquage privé (Étapes 24–25)", async () => {
      // No auto-pick when unset.
      let pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.strictEqual(pass.data.primarySquad, null, "must not auto-select a squad");

      const create = await fetch(`${API}/squads`, {
        method: "POST",
        headers: auth(owner.token),
        body: JSON.stringify({ name: `Bravo ${rnd()}` })
      });
      const created = await create.json();
      assert.ok(create.ok, JSON.stringify(created));
      const squadId = created.id || (created.squad && created.squad.id);
      assert.ok(squadId, "squad id required");

      // Still null until explicitly chosen.
      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.data.primarySquad, null);

      await fetch(`${API}/profile/${owner.id}/passport/settings`, {
        method: "PATCH",
        headers: auth(owner.token),
        body: JSON.stringify({
          primarySquadId: squadId,
          passportVisibility: "friends",
          statisticsVisibility: "friends"
        })
      });

      pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(pass.data.primarySquad);
      assert.strictEqual(pass.data.primarySquad.private, false);
      assert.ok(pass.data.primarySquad.name);
      assert.ok(pass.data.primarySquad.memberCount >= 1);
      assert.strictEqual(typeof pass.data.primarySquad.collectiveCompletionRate, "number");
      assert.strictEqual(pass.data.primarySquad.role, "Fondateur");

      // Mark squad private for non-members.
      const { pool } = require("../server/db");
      await pool.query("UPDATE squads SET visibility = 'private' WHERE id = $1", [squadId]);

      const friendView = await getPassport(friend.token, owner.id);
      assert.strictEqual(friendView.status, 200);
      assert.ok(friendView.data.primarySquad);
      assert.strictEqual(friendView.data.primarySquad.private, true);
      assert.strictEqual(friendView.data.primarySquad.display, "Squad privée");
      assert.strictEqual(friendView.data.primarySquad.name, undefined);
      assert.strictEqual(friendView.data.primarySquad.memberCount, undefined);
      assert.strictEqual(friendView.data.primarySquad.collectiveCompletionRate, undefined);
    });

    await test("archivage catalogue : dénominateur sans perte d’historique (Étape 76)", async () => {
      const summaryMod = require("../server/passport-summary");
      const integrity = require("../server/passport-integrity");
      await summaryMod.ensurePassportSummaryTables(pool);
      await integrity.ensurePassportIntegrityTables(pool);

      const before = await summaryMod.getPassportSummary(owner.id);
      assert.ok(before);
      const safetyBefore = await integrity.verifyArchiveSafety(owner.id);
      const badgeCountBefore = safetyBefore.activeBadgesKept;
      const historyBefore = safetyBefore.historyRowsKept;
      const entriesBefore = safetyBefore.ownershipRowsKept;
      const peakBefore = safetyBefore.personalBestRate;

      const shrink = await summaryMod.handleCataloguePublished({
        previousVersion: before.catalogueVersion,
        newVersion: `${before.catalogueVersion}-archive`,
        previousReleasedVariantCount: before.releasedVariantCount,
        newReleasedVariantCount: Math.max(1, before.releasedVariantCount - 3),
        previousReleasedSpriteCount: before.releasedSpriteCount,
        newReleasedSpriteCount: Math.max(1, before.releasedSpriteCount - 1)
      });
      assert.strictEqual(shrink.shrink, true);
      assert.strictEqual(shrink.removedVariantCount, 3);

      const mid = await summaryMod.getPassportSummary(owner.id);
      assert.strictEqual(mid.releasedVariantCount, Math.max(1, before.releasedVariantCount - 3));
      assert.ok(mid.catalogueVersion.endsWith("-archive"));
      // Completion can only stay or rise when denominator shrinks (owned fixed).
      assert.ok(mid.completionRate + 1e-6 >= before.completionRate);

      const safetyAfter = await integrity.verifyArchiveSafety(owner.id);
      assert.strictEqual(safetyAfter.ownershipRowsKept, entriesBefore, "possession rows must remain");
      assert.ok(safetyAfter.historyRowsKept >= historyBefore, "status history must remain");
      assert.strictEqual(safetyAfter.activeBadgesKept, badgeCountBefore, "badges must remain");
      if (peakBefore != null) {
        assert.ok(safetyAfter.personalBestRate + 1e-6 >= peakBefore, "personal best must not drop");
      }
    });

    await test("déclaratif + classements reportés sur le passeport (Étapes 78–79)", async () => {
      const pass = await getPassport(owner.token, owner.id);
      assert.strictEqual(pass.status, 200);
      assert.ok(pass.data.declarative);
      assert.match(pass.data.declarative.collection, /déclarée/i);
      assert.match(pass.data.declarative.badges, /déclarée/i);
      assert.ok(pass.data.rankings);
      assert.strictEqual(pass.data.rankings.globalLeaderboard, false);
      assert.strictEqual(pass.data.rankings.collectionTop, false);
      // No passport ranking endpoints.
      const rankingProbe = await fetch(`${API}/passport/leaderboard`, { headers: auth(owner.token) });
      assert.ok([404, 405].includes(rankingProbe.status));
    });

    await test("statistiques API : empty / partial / record (Étape 80)", async () => {
      const emptyUser = await register(`PpEmpty${rnd()}`);
      try {
        const emptyPass = await getPassport(emptyUser.token, emptyUser.id);
        assert.strictEqual(emptyPass.status, 200);
        assert.strictEqual(emptyPass.data.collection.ownedVariantCount, 0);
        assert.strictEqual(emptyPass.data.collection.discoveredSpriteCount, 0);
        assert.strictEqual(emptyPass.data.collection.completionRatePrecise, 0);
        assert.ok(emptyPass.data.collection.reliability);
        assert.strictEqual(emptyPass.data.collection.reliability.level, "insufficient");
        assert.ok(emptyPass.data.catalogue.releasedVariantCount >= 1);
        assert.ok(emptyPass.data.collection.catalogueVersion);

        const { ids, bySprite } = await getActiveVariants(emptyUser.token);
        assert.ok(ids.length >= 2);
        // Partial fill: one owned, one missing.
        await setEntry(emptyUser.token, emptyUser.id, ids[0], "owned");
        await setEntry(emptyUser.token, emptyUser.id, ids[1], "missing");
        let pass = await getPassport(emptyUser.token, emptyUser.id);
        assert.ok(pass.data.collection.ownedVariantCount >= 1);
        assert.ok(pass.data.collection.discoveredSpriteCount >= 1);
        assert.ok(pass.data.collection.completionRatePrecise > 0);
        assert.ok(pass.data.collection.reliability.explicitVariantCount >= 2);
        assert.ok(
          pass.data.collection.highestOfficialRarity || pass.data.collection.highestRarity,
          "max rarity present"
        );
        assert.ok(pass.data.collection.personalRecord || pass.data.collection.historicalPeak);

        // Raise then lower ownership — historical peak must remain.
        const peak1 = Number(
          (pass.data.collection.personalRecord || pass.data.collection.historicalPeak).completionRate
        );
        await setEntry(emptyUser.token, emptyUser.id, ids[0], "missing");
        pass = await getPassport(emptyUser.token, emptyUser.id);
        const peak2 = Number(
          (pass.data.collection.personalRecord || pass.data.collection.historicalPeak).completionRate
        );
        assert.ok(peak2 + 1e-6 >= peak1, "historical record must not decrease");
        assert.ok(
          pass.data.collection.completionRatePrecise <= peak2 + 1e-6,
          "current rate ≤ personal best"
        );

        // Distinct sprites: own two variants of same sprite if available.
        let multi = null;
        for (const [, list] of bySprite.entries()) {
          if (list.length >= 2) {
            multi = list.slice(0, 2);
            break;
          }
        }
        if (multi) {
          await setEntry(emptyUser.token, emptyUser.id, multi[0], "owned");
          await setEntry(emptyUser.token, emptyUser.id, multi[1], "owned");
          pass = await getPassport(emptyUser.token, emptyUser.id);
          assert.ok(pass.data.collection.ownedVariantCount >= 2);
          assert.ok(pass.data.collection.discoveredSpriteCount >= 1);
          assert.ok(
            pass.data.collection.discoveredSpriteCount <= pass.data.collection.ownedVariantCount
          );
        }
      } finally {
        await cleanup(emptyUser);
      }
    });
  } finally {
    await cleanup(owner);
    await cleanup(friend);
    await cleanup(stranger);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  process.exit(1);
});
