// routes-collection.js — extracted from server.js

const pushService = require("../push-service");
const security = require("../security");
const { checkPrivacyAccess, requireSameUser } = require("./auth");
const { normalizeCollection, normalizeVariantId } = require("./catalog");
const { invalidateCompareCacheForUser } = require("./compare");
const { app } = require("./core");
const { pool } = require("./db");
const { broadcastCompareUpdate, broadcastSquadUpdate } = require("./ws");

// ── Collection : GET all entries for user ──
app.get("/api/collection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    // Privacy check: only owner, squad mates (if squad_only), or anyone (if public)
    const userResult = await pool.query("SELECT id, privacy FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const access = await checkPrivacyAccess(req, userId, userResult.rows[0].privacy);
    if (access === "blocked") {
      return res.status(403).json({ error: "Collection non accessible" });
    }
    const result = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    const collection = {};
    for (const row of result.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: row.note || "",
        priority: row.priority || "none",
        obtainedAt: row.obtained_at || null,
        updatedAt: row.updated_at,
      };
    }
    res.json(collection);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad activity logger ──
async function logSquadActivity(userId, variantId, spriteId, action) {
  try {
    const squads = await pool.query(
      `SELECT sm.squad_id FROM squad_members sm WHERE sm.user_id = $1`,
      [userId]
    );
    const userResult = await pool.query("SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL", [userId]);
    const username = userResult.rows[0]?.username || "Un joueur";
    const actionLabel = action === "owned" ? "a obtenu" : "a repéré";
    const spriteResult = await pool.query("SELECT name FROM sprites WHERE id = $1", [spriteId]);
    const spriteName = spriteResult.rows[0]?.name || spriteId;

    for (const row of squads.rows) {
      await pool.query(
        `INSERT INTO squad_activity (squad_id, user_id, sprite_id, action) VALUES ($1, $2, $3, $4)`,
        [row.squad_id, userId, variantId, action]
      );
      // Notify squad members asynchronously; do not block the request.
      pushService.notifySquadMembers(pool, row.squad_id, userId, {
        title: "SPRITNEX — Escouade",
        body: `${username} ${actionLabel} ${spriteName}`,
        icon: "/icons/icon-192x192.png",
        url: `/?squad=${row.squad_id}`
      }).catch(err => console.error("[PUSH] squad notify failed:", err));
    }
  } catch (err) {
    console.error("Failed to log squad activity:", err);
  }
}

// ── Collection : UPSERT one entry ──
app.put("/api/collection/:userId/:spriteId", security.validateBody(security.schemas.collectionEntrySchema), async (req, res) => {
  const { userId } = req.params;
  let { spriteId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  if (!spriteId || spriteId.length > 120) return res.status(400).json({ error: "spriteId invalide" });
  const { variantId, spriteId: baseSpriteId } = await normalizeVariantId(spriteId);
  const { status, note, priority, obtainedAt } = req.validatedBody;
  try {
    const prev = await pool.query(
      `SELECT status FROM sprite_entries WHERE user_id = $1 AND variant_id = $2`,
      [userId, variantId]
    );
    const prevStatus = prev.rows.length ? prev.rows[0].status : "new";

    await pool.query(
      `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())
       ON CONFLICT (user_id, variant_id)
       DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                     status = COALESCE($4, sprite_entries.status),
                     note = COALESCE($5, sprite_entries.note),
                     priority = COALESCE($6, sprite_entries.priority),
                     obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                     updated_at = NOW()`,
      [userId, variantId, baseSpriteId, status || "new", note ?? "", priority || "none", obtainedAt || null]
    );

    const newStatus = status || "new";
    if (newStatus !== prevStatus) {
      pool.query(
        `INSERT INTO collection_history (user_id, sprite_id, old_status, new_status) VALUES ($1, $2, $3, $4)`,
        [userId, variantId, prevStatus, newStatus]
      ).catch(() => {});
    }

    if ((status === "owned") && prevStatus !== "owned") {
      logSquadActivity(userId, variantId, baseSpriteId, "owned");
    }

    res.json({ ok: true });
    broadcastSquadUpdate(userId);
    invalidateCompareCacheForUser(userId);
    broadcastCompareUpdate(userId, {
      changes: [{
        variantId,
        spriteId: baseSpriteId,
        status: newStatus,
        priority: priority || "none",
        note: note ?? "",
        obtainedAt: obtainedAt || null
      }]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection : bulk sync ──
app.post("/api/collection/:userId/sync", security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    const changes = [];
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      changes.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: entry.status || "new",
        priority: entry.priority || "none",
        note: entry.note || "",
        obtainedAt: entry.obtainedAt || null
      });
    }
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    broadcastSquadUpdate(userId);
    invalidateCompareCacheForUser(userId);
    broadcastCompareUpdate(userId, { changes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur sync" });
  } finally {
    client.release();
  }
});

// ── Collection : bulk import (legacy) ──
// SECURITY: this route previously had NO authentication check at all, letting
// anyone overwrite any user's collection just by knowing their userId. It is
// unused by the current frontend (which uses /sync instead), but is kept for
// backward compatibility with the same access control as /sync.
app.post("/api/collection/:userId/import", security.syncLimiter, security.validateBody(security.schemas.collectionSyncSchema), async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  const { collection } = req.validatedBody;
  const normalizedCollection = await normalizeCollection(collection);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      await client.query(
        `INSERT INTO sprite_entries (user_id, variant_id, sprite_id, status, note, priority, obtained_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, COALESCE($8::timestamptz, NOW()))
         ON CONFLICT (user_id, variant_id)
         DO UPDATE SET sprite_id = COALESCE(sprite_entries.sprite_id, EXCLUDED.sprite_id),
                       status = $4,
                       note = $5,
                       priority = $6,
                       obtained_at = COALESCE($7::timestamptz, sprite_entries.obtained_at),
                       updated_at = COALESCE($8::timestamptz, NOW())`,
        [
          userId, variantId, entry.spriteId || null,
          entry.status || "new",
          entry.note || "",
          entry.priority || "none",
          entry.obtainedAt || null,
          entry.updatedAt || null
        ]
      );
    }
    await client.query("COMMIT");
    const changes = [];
    for (const [variantId, entry] of Object.entries(normalizedCollection)) {
      if (variantId.startsWith("fav_")) continue;
      changes.push({
        variantId,
        spriteId: entry.spriteId || null,
        status: entry.status || "new",
        priority: entry.priority || "none",
        note: entry.note || "",
        obtainedAt: entry.obtainedAt || null
      });
    }
    res.json({ ok: true, count: Object.keys(normalizedCollection).length });
    invalidateCompareCacheForUser(userId);
    broadcastCompareUpdate(userId, { changes });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur import" });
  } finally {
    client.release();
  }
});

// ── Reset ──
app.delete("/api/collection/:userId", async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("DELETE FROM sprite_entries WHERE user_id = $1", [req.params.userId]);
    res.json({ ok: true });
    invalidateCompareCacheForUser(req.params.userId);
    broadcastCompareUpdate(req.params.userId, { type: "compare_reset" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Collection history ──
// SECURITY: this route had no access control at all — anyone could read any
// user's full change history just by guessing/knowing a userId. History is
// private (not shared with squads, unlike squad_activity), so only the owner
// may read it.
app.get("/api/history/:userId", async (req, res) => {
  const { userId } = req.params;
  if (!(await requireSameUser(req, res, userId))) return;
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const result = await pool.query(
      `SELECT sprite_id, old_status, new_status, created_at
       FROM collection_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM collection_history WHERE user_id = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].count);

    const weekResult = await pool.query(
      `SELECT date_trunc('week', created_at) AS week, COUNT(*) AS changes,
              COUNT(*) FILTER (WHERE new_status = 'owned') AS acquisitions
       FROM collection_history
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '12 weeks'
       GROUP BY week ORDER BY week DESC`,
      [userId]
    );

    res.json({
      history: result.rows,
      total,
      hasMore: offset + result.rows.length < total,
      weeklyStats: weekResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = { logSquadActivity };
