"use strict";

// Étapes 72–75 — materialised passport summary + async recalc queue.
const { pool } = require("./db");
const compare = require("./compare");
const { computeCatalogueVersion } = require("./squad-analysis-cache");
const { computePassportProgress, computeOwnedRarityStats } = require("./passport-math");

const QUEUE_POLL_MS = Math.max(0, Number(process.env.PASSPORT_RECALC_QUEUE_MS ?? 2_000));
const BATCH_SIZE = Math.max(1, Number(process.env.PASSPORT_RECALC_BATCH || 10));
const CATALOGUE_FANOUT_BATCH = Math.max(1, Number(process.env.PASSPORT_CATALOGUE_FANOUT_BATCH || 200));

const PASSPORT_EXPLICIT_STATUSES = new Set(["owned", "missing", "priority", "spotted", "unavailable", "unknown"]);

let tablesReady = false;
let workerStarted = false;
let workerInterval = null;

async function ensurePassportSummaryTables(db = pool) {
  if (tablesReady) return;
  // INTEGER user_id (project convention) — brief UUID adapted.
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_passport_summaries (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      catalogue_version VARCHAR(80) NOT NULL,
      owned_sprite_count INTEGER NOT NULL DEFAULT 0,
      owned_variant_count INTEGER NOT NULL DEFAULT 0,
      released_sprite_count INTEGER NOT NULL DEFAULT 0,
      released_variant_count INTEGER NOT NULL DEFAULT 0,
      completion_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
      personal_best_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
      collection_coverage_rate NUMERIC(10, 4) NOT NULL DEFAULT 0,
      completed_event_count INTEGER NOT NULL DEFAULT 0,
      comparison_count INTEGER NOT NULL DEFAULT 0,
      distinct_compared_users INTEGER NOT NULL DEFAULT 0,
      highest_official_rarity VARCHAR(30),
      last_collection_update_at TIMESTAMPTZ,
      recalculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_user_passport_summaries_recalc
      ON user_passport_summaries (recalculated_at DESC);

    CREATE TABLE IF NOT EXISTS passport_recalc_queue (
      id BIGSERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason VARCHAR(80) NOT NULL DEFAULT 'collection.updated',
      trigger_event VARCHAR(80) NOT NULL DEFAULT 'collection.updated',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_passport_recalc_queue_pending
      ON passport_recalc_queue (id)
      WHERE status = 'pending';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_recalc_queue_pending_user
      ON passport_recalc_queue (user_id)
      WHERE status = 'pending';

    CREATE TABLE IF NOT EXISTS passport_catalogue_meta (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      catalogue_version VARCHAR(80) NOT NULL,
      released_sprite_count INTEGER NOT NULL DEFAULT 0,
      released_variant_count INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  tablesReady = true;
}

function rowToSummary(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    catalogueVersion: row.catalogue_version,
    ownedSpriteCount: row.owned_sprite_count,
    ownedVariantCount: row.owned_variant_count,
    releasedSpriteCount: row.released_sprite_count,
    releasedVariantCount: row.released_variant_count,
    completionRate: Number(row.completion_rate) || 0,
    personalBestRate: Number(row.personal_best_rate) || 0,
    collectionCoverageRate: Number(row.collection_coverage_rate) || 0,
    completedEventCount: row.completed_event_count,
    comparisonCount: row.comparison_count,
    distinctComparedUsers: row.distinct_compared_users,
    highestOfficialRarity: row.highest_official_rarity || null,
    lastCollectionUpdateAt: row.last_collection_update_at || null,
    recalculatedAt: row.recalculated_at
  };
}

async function getPassportSummary(userId, db = pool) {
  await ensurePassportSummaryTables(db);
  const result = await db.query("SELECT * FROM user_passport_summaries WHERE user_id = $1", [userId]);
  return rowToSummary(result.rows[0] || null);
}

/**
 * Persist a computed summary (called at end of refreshPassportProgress).
 */
async function upsertPassportSummary(userId, data = {}, db = pool) {
  await ensurePassportSummaryTables(db);
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id < 1) return null;

  const result = await db.query(
    `INSERT INTO user_passport_summaries (
       user_id, catalogue_version,
       owned_sprite_count, owned_variant_count,
       released_sprite_count, released_variant_count,
       completion_rate, personal_best_rate, collection_coverage_rate,
       completed_event_count, comparison_count, distinct_compared_users,
       highest_official_rarity, last_collection_update_at, recalculated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
     )
     ON CONFLICT (user_id) DO UPDATE SET
       catalogue_version = EXCLUDED.catalogue_version,
       owned_sprite_count = EXCLUDED.owned_sprite_count,
       owned_variant_count = EXCLUDED.owned_variant_count,
       released_sprite_count = EXCLUDED.released_sprite_count,
       released_variant_count = EXCLUDED.released_variant_count,
       completion_rate = EXCLUDED.completion_rate,
       personal_best_rate = EXCLUDED.personal_best_rate,
       collection_coverage_rate = EXCLUDED.collection_coverage_rate,
       completed_event_count = EXCLUDED.completed_event_count,
       comparison_count = EXCLUDED.comparison_count,
       distinct_compared_users = EXCLUDED.distinct_compared_users,
       highest_official_rarity = EXCLUDED.highest_official_rarity,
       last_collection_update_at = COALESCE(EXCLUDED.last_collection_update_at, user_passport_summaries.last_collection_update_at),
       recalculated_at = NOW()
     RETURNING *`,
    [
      id,
      String(data.catalogueVersion || "unknown"),
      Number(data.ownedSpriteCount) || 0,
      Number(data.ownedVariantCount) || 0,
      Number(data.releasedSpriteCount) || 0,
      Number(data.releasedVariantCount) || 0,
      Number(data.completionRate) || 0,
      Number(data.personalBestRate) || 0,
      Number(data.collectionCoverageRate) || 0,
      Number(data.completedEventCount) || 0,
      Number(data.comparisonCount) || 0,
      Number(data.distinctComparedUsers) || 0,
      data.highestOfficialRarity || null,
      data.lastCollectionUpdateAt || null
    ]
  );
  return rowToSummary(result.rows[0]);
}

async function computeSummaryPayload(userId, built = null, db = pool) {
  const achievements = require("./passport-achievements");
  const comparisonSessions = require("./comparison-sessions");
  const resolved = built || (await achievements.buildPassportEvalContext(userId, db, { notify: false }));
  const catalogue = resolved.catalogue || [];
  const releasedSpriteCount = new Set(catalogue.map((item) => String(item.spriteId))).size;
  const peakResult = await db.query("SELECT peak_completion_rate FROM user_collection_peaks WHERE user_id = $1", [
    userId
  ]);
  const peakRate = peakResult.rows[0]
    ? Number(peakResult.rows[0].peak_completion_rate) || 0
    : resolved.progress.completionRatePrecise || 0;

  const comparisonStats = await comparisonSessions.getComparisonStatsForUser(userId).catch(() => ({
    comparisonCount: 0,
    distinctCollectorsCompared: 0
  }));

  const lastUpdated = await db.query(
    `SELECT MAX(updated_at) AS last_updated
     FROM sprite_entries WHERE user_id = $1`,
    [userId]
  );

  const ownedIds = resolved.ownedIds || new Set();
  const rarityStats = computeOwnedRarityStats(catalogue, ownedIds);

  return {
    catalogueVersion: resolved.catalogueVersion,
    ownedSpriteCount: resolved.ctx.discoveredSpriteCount || 0,
    ownedVariantCount: resolved.progress.ownedVariantCount || 0,
    releasedSpriteCount,
    releasedVariantCount: resolved.progress.releasedVariantCount || 0,
    completionRate: resolved.progress.completionRatePrecise || 0,
    personalBestRate: Math.max(peakRate, resolved.progress.completionRatePrecise || 0),
    collectionCoverageRate:
      resolved.reliability?.rate != null ? resolved.reliability.rate : resolved.ctx.reliabilityRate || 0,
    completedEventCount: resolved.ctx.eventsCompletedCount || 0,
    comparisonCount: comparisonStats.comparisonCount || 0,
    distinctComparedUsers: comparisonStats.distinctCollectorsCompared || 0,
    highestOfficialRarity: rarityStats.highestOfficialRarity ? rarityStats.highestOfficialRarity.key : null,
    lastCollectionUpdateAt: lastUpdated.rows[0]?.last_updated || null,
    _built: resolved
  };
}

/**
 * Full recalc: badges + peak + summary. Used by the queue worker and sync paths.
 */
async function recalculatePassportSummary(
  userId,
  {
    triggerEvent = "collection.updated",
    notify = true,
    batchNotify = true,
    collectionChanged = false,
    catalogueDelta = null
  } = {}
) {
  const achievements = require("./passport-achievements");
  const previous = await getPassportSummary(userId);
  const refreshed = await achievements.refreshPassportProgress(userId, triggerEvent, {
    notify,
    batchNotify,
    collectionChanged
  });
  // refreshPassportProgress already upserts summary; re-read for return value.
  const summary = await getPassportSummary(userId);

  // Étape 75 — notify when catalogue growth drops completion.
  if (
    catalogueDelta &&
    previous &&
    summary &&
    Number(previous.completionRate) > Number(summary.completionRate) + 0.05
  ) {
    await maybeNotifyCatalogueCompletionDrop(userId, previous, summary, catalogueDelta);
  }

  return { summary, refreshed, previous };
}

async function maybeNotifyCatalogueCompletionDrop(userId, previous, summary, catalogueDelta) {
  try {
    const pushService = require("../push-service");
    const eventIdempotency = require("./event-idempotency");
    const dedupeKey = `passport_catalogue_drop:${userId}:${summary.catalogueVersion}`;
    const claimed = await eventIdempotency
      .claimDedupeKey(pool, dedupeKey, "passport_catalogue_updated", userId)
      .catch(() => true);
    if (!claimed) return;

    const from = Math.round(Number(previous.completionRate) * 10) / 10;
    const to = Math.round(Number(summary.completionRate) * 10) / 10;
    const fromLabel = String(from).replace(".", ",");
    const toLabel = String(to).replace(".", ",");
    const added =
      catalogueDelta.addedVariantCount != null
        ? catalogueDelta.addedVariantCount
        : Math.max(0, (summary.releasedVariantCount || 0) - (previous.releasedVariantCount || 0));

    await pushService.createNotification(pool, {
      recipientId: userId,
      type: "passport_catalogue_updated",
      category: "collection",
      entityType: "catalogue",
      entityId: summary.catalogueVersion,
      context: {
        fromRate: fromLabel,
        toRate: toLabel,
        previousCompletionRate: previous.completionRate,
        completionRate: summary.completionRate,
        catalogueVersion: summary.catalogueVersion,
        addedVariantCount: added
      },
      url: "/?view=checklist",
      data: {
        actionUrl: "/?view=checklist",
        previousCompletionRate: previous.completionRate,
        completionRate: summary.completionRate,
        catalogueVersion: summary.catalogueVersion,
        addedVariantCount: added
      }
    });
  } catch (err) {
    console.error("[passport-summary] catalogue drop notif failed", err.message);
  }
}

/**
 * Enqueue a durable recalc job. Coalesces pending jobs per user.
 */
async function enqueuePassportRecalc(
  userId,
  {
    reason = "collection.updated",
    triggerEvent = "collection.updated",
    collectionChanged = false,
    catalogueDelta = null,
    notify = true
  } = {}
) {
  await ensurePassportSummaryTables();
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id < 1) return null;

  const payload = {
    collectionChanged: !!collectionChanged,
    catalogueDelta: catalogueDelta || null,
    notify: notify !== false
  };

  const result = await pool.query(
    `INSERT INTO passport_recalc_queue (user_id, reason, trigger_event, payload, status)
     VALUES ($1, $2, $3, $4::jsonb, 'pending')
     ON CONFLICT (user_id) WHERE status = 'pending'
     DO UPDATE SET
       reason = EXCLUDED.reason,
       trigger_event = EXCLUDED.trigger_event,
       payload = passport_recalc_queue.payload || EXCLUDED.payload,
       updated_at = NOW()
     RETURNING id`,
    [id, String(reason).slice(0, 80), String(triggerEvent).slice(0, 80), JSON.stringify(payload)]
  );
  return result.rows[0]?.id || null;
}

/**
 * Schedule recalc without blocking the request.
 * - mode "queue" (default for imports): durable job
 * - mode "immediate": setImmediate refresh (single entry edits)
 */
function schedulePassportRecalc(userId, options = {}) {
  const mode = options.mode || "queue";
  if (mode === "immediate") {
    setImmediate(() => {
      recalculatePassportSummary(userId, {
        triggerEvent: options.triggerEvent || options.reason || "collection.updated",
        notify: options.notify !== false,
        batchNotify: options.batchNotify !== false,
        collectionChanged: options.collectionChanged === true,
        catalogueDelta: options.catalogueDelta || null
      }).catch((err) => console.error("[passport-summary] immediate recalc failed", err.message));
    });
    return Promise.resolve({ mode: "immediate" });
  }
  return enqueuePassportRecalc(userId, options).then((jobId) => ({ mode: "queue", jobId }));
}

async function processPassportRecalcBatch(db = pool) {
  await ensurePassportSummaryTables(db);
  const claimed = await db.query(
    `WITH next_jobs AS (
       SELECT id FROM passport_recalc_queue
       WHERE status = 'pending'
       ORDER BY id ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE passport_recalc_queue q
     SET status = 'processing', attempts = attempts + 1, updated_at = NOW()
     FROM next_jobs
     WHERE q.id = next_jobs.id
     RETURNING q.*`,
    [BATCH_SIZE]
  );

  for (const job of claimed.rows) {
    try {
      const payload = job.payload || {};
      await recalculatePassportSummary(job.user_id, {
        triggerEvent: job.trigger_event || "collection.updated",
        notify: payload.notify !== false,
        batchNotify: true,
        collectionChanged: payload.collectionChanged === true,
        catalogueDelta: payload.catalogueDelta || null
      });
      await db.query(
        `UPDATE passport_recalc_queue
         SET status = 'done', processed_at = NOW(), updated_at = NOW(), last_error = NULL
         WHERE id = $1`,
        [job.id]
      );
    } catch (err) {
      const fail = job.attempts >= (job.max_attempts || 5);
      await db.query(
        `UPDATE passport_recalc_queue
         SET status = $2, last_error = $3, updated_at = NOW(),
             processed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE processed_at END
         WHERE id = $1`,
        [job.id, fail ? "failed" : "pending", String(err.message || err).slice(0, 500)]
      );
      console.error("[passport-summary] job failed", job.id, err.message);
    }
  }
  return claimed.rows.length;
}

function startPassportRecalcWorker(db = pool) {
  if (workerStarted) return;
  workerStarted = true;
  ensurePassportSummaryTables(db).catch(() => {});
  if (QUEUE_POLL_MS <= 0) return;
  workerInterval = setInterval(() => {
    processPassportRecalcBatch(db).catch((err) => console.error("[passport-summary] worker tick failed", err.message));
  }, QUEUE_POLL_MS);
  if (typeof workerInterval.unref === "function") workerInterval.unref();
}

/**
 * Étapes 75–76 — catalogue size change (growth OR archival/removal from live calc).
 *
 * When variants leave the released+active set:
 *  - recalculate the denominator (released_* + completion_rate)
 *  - stamp the new catalogue_version
 *  - keep personal best / snapshots / possession history / unlocked badges
 *  - never DELETE sprite_entries for archived variants
 */
async function handleCataloguePublished({
  previousVersion = null,
  newVersion,
  previousReleasedVariantCount = null,
  newReleasedVariantCount,
  previousReleasedSpriteCount = null,
  newReleasedSpriteCount
} = {}) {
  await ensurePassportSummaryTables();
  if (!newVersion) return { enqueued: 0 };

  const prevMeta = await pool.query("SELECT * FROM passport_catalogue_meta WHERE id = 1");
  const stored = prevMeta.rows[0] || null;
  const fromVersion = previousVersion || (stored && stored.catalogue_version);
  const fromReleased =
    previousReleasedVariantCount != null ? previousReleasedVariantCount : stored ? stored.released_variant_count : null;

  await pool.query(
    `INSERT INTO passport_catalogue_meta (id, catalogue_version, released_sprite_count, released_variant_count, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       catalogue_version = EXCLUDED.catalogue_version,
       released_sprite_count = EXCLUDED.released_sprite_count,
       released_variant_count = EXCLUDED.released_variant_count,
       updated_at = NOW()`,
    [newVersion, Number(newReleasedSpriteCount) || 0, Number(newReleasedVariantCount) || 0]
  );

  if (fromVersion && fromVersion === newVersion) {
    return { enqueued: 0, unchanged: true };
  }

  const deltaReleased = fromReleased != null ? (Number(newReleasedVariantCount) || 0) - Number(fromReleased) : null;
  const addedVariantCount = deltaReleased != null ? Math.max(0, deltaReleased) : null;
  const removedVariantCount = deltaReleased != null ? Math.max(0, -deltaReleased) : null;
  const shrink = !!(removedVariantCount && removedVariantCount > 0);

  // 1) Eagerly update released totals on existing summaries (rates recalculated async).
  //    personal_best_rate is intentionally NOT touched here (Étape 76).
  await pool.query(
    `UPDATE user_passport_summaries
     SET released_sprite_count = $1,
         released_variant_count = $2,
         catalogue_version = $3,
         completion_rate = CASE
           WHEN $2::int > 0 THEN ROUND((owned_variant_count::numeric * 100) / $2::numeric, 4)
           ELSE 0
         END`,
    [Number(newReleasedSpriteCount) || 0, Number(newReleasedVariantCount) || 0, newVersion]
  );

  // 2) Enqueue full recalc. Badges / peaks / snapshots / sprite_entries stay intact.
  let enqueued = 0;
  let offset = 0;
  for (;;) {
    const users = await pool.query(
      `SELECT user_id FROM collector_passports
       ORDER BY user_id ASC
       LIMIT $1 OFFSET $2`,
      [CATALOGUE_FANOUT_BATCH, offset]
    );
    if (!users.rows.length) break;
    for (const row of users.rows) {
      await enqueuePassportRecalc(row.user_id, {
        reason: shrink ? "catalogue.archived" : "catalogue.published",
        triggerEvent: "catalogue.published",
        collectionChanged: false,
        catalogueDelta: {
          previousVersion: fromVersion,
          newVersion,
          addedVariantCount,
          removedVariantCount,
          previousReleasedVariantCount: fromReleased,
          newReleasedVariantCount,
          shrink
        },
        // Growth drop notifs only; archival shrink often raises completion — no spam.
        notify: !shrink
      });
      enqueued += 1;
    }
    offset += users.rows.length;
    if (users.rows.length < CATALOGUE_FANOUT_BATCH) break;
  }

  try {
    const { emitDomainEvent, DOMAIN_EVENTS } = require("./event-bus");
    if (DOMAIN_EVENTS.CATALOGUE_PUBLISHED) {
      await emitDomainEvent(DOMAIN_EVENTS.CATALOGUE_PUBLISHED, {
        actorId: null,
        entityType: "catalogue",
        entityId: newVersion,
        context: {
          previousVersion: fromVersion,
          newVersion,
          addedVariantCount,
          removedVariantCount,
          newReleasedVariantCount,
          newReleasedSpriteCount,
          shrink
        }
      });
    }
  } catch (_) {
    /* optional bus */
  }

  return {
    enqueued,
    addedVariantCount,
    removedVariantCount,
    shrink,
    newVersion
  };
}

/**
 * Compare current catalogue to stored meta; fan out if changed.
 * Safe to call after news/cron refresh.
 */
async function syncCatalogueMetaAndFanout() {
  const catalogueAll = await compare.getServerCompareCatalogItemsCached();
  const catalogue = catalogueAll.filter(compare.isVariantReleasedAndActiveServer);
  const version = computeCatalogueVersion(catalogueAll);
  const releasedVariantCount = catalogue.length;
  const releasedSpriteCount = new Set(catalogue.map((i) => String(i.spriteId))).size;
  return handleCataloguePublished({
    newVersion: version,
    newReleasedVariantCount: releasedVariantCount,
    newReleasedSpriteCount: releasedSpriteCount
  });
}

/**
 * Apply summary numbers onto a passport collection block (Étape 72 read path).
 */
function applySummaryToCollection(collection, summary, peakRow = null) {
  if (!summary) return collection;
  const progress = computePassportProgress(summary.ownedVariantCount, summary.releasedVariantCount);
  const personalBestRate = peakRow
    ? Number(peakRow.peak_completion_rate) || summary.personalBestRate
    : summary.personalBestRate;
  const personalBestDisplay = peakRow
    ? Number(peakRow.peak_completion_display)
    : Math.round(personalBestRate * 10) / 10;

  return {
    ...collection,
    catalogueVersion: summary.catalogueVersion,
    ownedSpriteCount: summary.ownedSpriteCount,
    discoveredSpriteCount: summary.ownedSpriteCount,
    ownedVariantCount: summary.ownedVariantCount,
    releasedVariantCount: summary.releasedVariantCount,
    completionRate: Math.round(summary.completionRate * 10) / 10,
    completionRatePrecise: summary.completionRate,
    completionRateDisplay: progress.completionRateDisplay,
    lastUpdatedAt: summary.lastCollectionUpdateAt || collection.lastUpdatedAt,
    progress: {
      ...progress,
      catalogueVersion: summary.catalogueVersion
    },
    reliability: {
      ...(collection.reliability || {}),
      rate: summary.collectionCoverageRate
    },
    personalRecord: {
      completionRate: personalBestRate,
      completionRateDisplay: personalBestDisplay,
      ownedVariantCount: peakRow ? peakRow.peak_owned_variant_count : summary.ownedVariantCount,
      releasedVariantCount: peakRow ? peakRow.peak_released_variant_count : summary.releasedVariantCount,
      catalogueVersion: peakRow ? peakRow.peak_catalogue_version : summary.catalogueVersion,
      achievedAt: peakRow ? peakRow.achieved_at : null
    },
    historicalPeak: {
      completionRate: personalBestRate,
      completionRateDisplay: personalBestDisplay
    },
    fromSummary: true,
    summaryRecalculatedAt: summary.recalculatedAt
  };
}

module.exports = {
  ensurePassportSummaryTables,
  getPassportSummary,
  upsertPassportSummary,
  computeSummaryPayload,
  recalculatePassportSummary,
  enqueuePassportRecalc,
  schedulePassportRecalc,
  processPassportRecalcBatch,
  startPassportRecalcWorker,
  handleCataloguePublished,
  syncCatalogueMetaAndFanout,
  applySummaryToCollection,
  PASSPORT_EXPLICIT_STATUSES
};
