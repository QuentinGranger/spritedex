"use strict";

// ── Sprite Graph public HTTP API (Étapes 76–80) ──────────────────────────────

const { app } = require("./core");
const { pool } = require("./db");
const { GRAPH_DATA_LEVELS } = require("./sprite-graph-privacy");
const {
  getStandardCommunityVariantResponse,
  getVariantCommunityHistory,
  getCommunityTrendsBoard,
  getCompareCommunityInsights,
  COMMUNITY_SOURCE_DISCLAIMER
} = require("./sprite-graph-public");
const { getSquadCommunityContext } = require("./sprite-graph-squad-stats");
const { getGraphRecommendationReadiness, resolveGraphRecommendations } = require("./sprite-graph-recommendations");
const { evaluateSimpleGraphRules, getGraphScoringPolicy } = require("./sprite-graph-rules");
const { isPublicMetricDisabled, isSpriteGraphAdmin } = require("./sprite-graph-metrics");
const { getRequestingUser, requireNotSuspended } = require("./auth");
const { INSUFFICIENT_COMMUNITY_DATA_MESSAGE } = require("./sprite-graph-privacy");
const { GRAPH_INTERACTION_EVENT_TYPE_SET, recordGraphEvent } = require("./sprite-graph");

const GRAPH_INTERACTION_SURFACES = new Set(["compare", "squad_engine", "notification", "passport"]);
const GRAPH_INTERACTION_FILTERS = new Set([
  "status",
  "sort",
  "season",
  "event",
  "rarity",
  "sprite",
  "variant_type",
  "availability",
  "acquisition",
  "reset"
]);

function cleanInteractionText(value, max = 80) {
  const text = String(value || "").trim();
  return /^[a-z0-9_.-]+$/i.test(text) ? text.slice(0, max) : null;
}

/**
 * Additive interaction telemetry. It is authenticated, allow-listed and
 * append-only; never accept free-form values that could carry user content.
 */
app.post("/api/sprite-graph/interactions", requireNotSuspended, async (req, res) => {
  try {
    const userId = await getRequestingUser(req);
    if (!userId) return res.status(401).json({ error: "Authentification requise" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const eventType = String(body.type || "");
    if (!GRAPH_INTERACTION_EVENT_TYPE_SET.has(eventType)) {
      return res.status(400).json({ error: "Type d’interaction invalide" });
    }
    const surface = cleanInteractionText(body.surface, 40);
    if (!surface || !GRAPH_INTERACTION_SURFACES.has(surface)) {
      return res.status(400).json({ error: "Surface d’interaction invalide" });
    }

    const context = { surface };
    const recommendationKey = cleanInteractionText(body.recommendationKey, 80);
    const filterKind = cleanInteractionText(body.filterKind, 40);
    if (eventType === "recommendation.clicked") {
      if (!recommendationKey) return res.status(400).json({ error: "recommendationKey requis" });
      context.recommendationKey = recommendationKey;
    }
    if (eventType === "comparison.filter_applied") {
      if (!filterKind || !GRAPH_INTERACTION_FILTERS.has(filterKind)) {
        return res.status(400).json({ error: "Filtre invalide" });
      }
      context.filterKind = filterKind;
    }

    const notificationId = Number(body.notificationId);
    if (eventType.startsWith("notification.")) {
      if (!Number.isSafeInteger(notificationId) || notificationId < 1) {
        return res.status(400).json({ error: "notificationId requis" });
      }
      const notification = await pool.query(
        "SELECT id, type, category FROM notifications WHERE id = $1 AND recipient_id = $2 LIMIT 1",
        [notificationId, userId]
      );
      if (!notification.rows.length) return res.status(404).json({ error: "Notification introuvable" });
      context.notificationType = notification.rows[0].type || null;
      context.category = notification.rows[0].category || null;
    }

    const source = body.source === "ios" || body.source === "android" ? body.source : "web";
    const bucket = Math.floor(Date.now() / 5000);
    const target = notificationId || recommendationKey || filterKind || surface;
    const event = await recordGraphEvent(pool, {
      eventType,
      actorUserId: userId,
      notificationId: Number.isSafeInteger(notificationId) && notificationId > 0 ? notificationId : null,
      source,
      origin: "sprite_graph.interactions",
      context,
      deduplicationKey: `${eventType}:${userId}:${target}:${bucket}`
    });
    res.status(event ? 201 : 202).json({ ok: true, recorded: !!event });
  } catch (err) {
    console.error("[sprite-graph] interaction:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

async function resolveLevel(req) {
  // Public by default. aggregated_internal requires graph admin (Étape 96/98).
  const raw = String(req.query.level || "").trim();
  if (raw === GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL) {
    try {
      const userId = await getRequestingUser(req);
      if (isSpriteGraphAdmin(userId)) return GRAPH_DATA_LEVELS.AGGREGATED_INTERNAL;
    } catch (_) {
      /* fall through */
    }
  }
  return GRAPH_DATA_LEVELS.AGGREGATED_PUBLIC;
}

async function publicMetricGate(metricKey) {
  if (await isPublicMetricDisabled(pool, metricKey)) {
    return {
      insufficient: true,
      suspended: true,
      message: INSUFFICIENT_COMMUNITY_DATA_MESSAGE,
      metricKey
    };
  }
  return null;
}

/**
 * Étape 76 — standardized community payload for one variant.
 * GET /api/sprite-graph/variants/:variantId/community
 */
app.get("/api/sprite-graph/variants/:variantId/community", async (req, res) => {
  try {
    const variantId = String(req.params.variantId || "").slice(0, 100);
    if (!variantId) return res.status(400).json({ error: "variantId requis" });
    const suspended = await publicMetricGate("ownership_rate");
    if (suspended) return res.json(suspended);
    const metricDate = req.query.asOf ? String(req.query.asOf).slice(0, 10) : null;
    const payload = await getStandardCommunityVariantResponse(pool, variantId, {
      metricDate,
      level: await resolveLevel(req)
    });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] variant community:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 80 — ownership / priority history.
 * GET /api/sprite-graph/variants/:variantId/history
 */
app.get("/api/sprite-graph/variants/:variantId/history", async (req, res) => {
  try {
    const variantId = String(req.params.variantId || "").slice(0, 100);
    if (!variantId) return res.status(400).json({ error: "variantId requis" });
    const days = Number(req.query.days) || 30;
    const payload = await getVariantCommunityHistory(pool, variantId, {
      days,
      level: await resolveLevel(req)
    });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] variant history:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Community snapshots for all variants of a sprite (fiche Sprite).
 * GET /api/sprite-graph/sprites/:spriteId/community
 */
app.get("/api/sprite-graph/sprites/:spriteId/community", async (req, res) => {
  try {
    const spriteId = String(req.params.spriteId || "").slice(0, 50);
    if (!spriteId) return res.status(400).json({ error: "spriteId requis" });
    const metricDate = req.query.asOf ? String(req.query.asOf).slice(0, 10) : null;
    const level = await resolveLevel(req);

    const variants = await pool.query(
      `SELECT id, name, rarity FROM sprite_variants
       WHERE sprite_id = $1
       ORDER BY name ASC`,
      [spriteId]
    );
    const sprite = await pool.query(`SELECT id, name, rarity FROM sprites WHERE id = $1`, [spriteId]);
    if (!sprite.rows.length) return res.status(404).json({ error: "Sprite introuvable" });

    const items = [];
    for (const v of variants.rows) {
      const payload = await getStandardCommunityVariantResponse(pool, v.id, {
        metricDate,
        level
      });
      items.push(payload);
    }

    res.json({
      spriteId,
      spriteName: sprite.rows[0].name,
      officialRarity: sprite.rows[0].rarity,
      officialRarityLabel: sprite.rows[0].rarity ? `Rareté officielle : ${sprite.rows[0].rarity}` : null,
      asOf: metricDate || new Date().toISOString().slice(0, 10),
      variants: items,
      disclaimer: COMMUNITY_SOURCE_DISCLAIMER
    });
  } catch (err) {
    console.error("[sprite-graph] sprite community:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 78 — Tendances board.
 * GET /api/sprite-graph/trends
 */
app.get("/api/sprite-graph/trends", async (req, res) => {
  try {
    const metricDate = req.query.asOf ? String(req.query.asOf).slice(0, 10) : null;
    const limit = Number(req.query.limit) || 10;
    const suspended = await publicMetricGate("interest_score");
    if (suspended) return res.json({ ...suspended, sections: {} });
    const board = await getCommunityTrendsBoard(pool, {
      metricDate,
      limit,
      level: await resolveLevel(req)
    });
    res.json(board);
  } catch (err) {
    console.error("[sprite-graph] trends:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 82 — secondary community insights for a personal comparison.
 * POST /api/sprite-graph/compare/community-context
 * body: { items: [{ variantId, relation }], aName?, bName? }
 */
app.post("/api/sprite-graph/compare/community-context", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
    const payload = await getCompareCommunityInsights(pool, {
      items,
      aName: body.aName ? String(body.aName).slice(0, 80) : "Joueur A",
      bName: body.bName ? String(body.bName).slice(0, 80) : "Joueur B",
      level: await resolveLevel(req)
    });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] compare community:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 83–84 — squad community context + anonymous peer group.
 * GET /api/sprite-graph/squads/:squadId/community  (id numérique ou code)
 */
app.get("/api/sprite-graph/squads/:squadId/community", async (req, res) => {
  try {
    const raw = String(req.params.squadId || "").trim();
    if (!raw) return res.status(400).json({ error: "squadId invalide" });
    let squadId = Number(raw);
    if (!Number.isFinite(squadId)) {
      const found = await pool.query("SELECT id FROM squads WHERE code = $1", [raw.toUpperCase()]);
      if (!found.rows.length) return res.status(404).json({ error: "Squad introuvable" });
      squadId = found.rows[0].id;
    }
    const metricDate = req.query.asOf ? String(req.query.asOf).slice(0, 10) : null;
    const payload = await getSquadCommunityContext(pool, squadId, { metricDate });
    if (!payload) return res.status(404).json({ error: "Squad introuvable" });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] squad community:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 85 — readiness only (no auto-generated recommendations).
 * GET /api/sprite-graph/recommendations/readiness
 */
app.get("/api/sprite-graph/recommendations/readiness", async (_req, res) => {
  try {
    res.json(getGraphRecommendationReadiness());
  } catch (err) {
    console.error("[sprite-graph] recommendations readiness:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 85/86 — hooks + optional simple rules when facts are POSTed.
 * GET  /api/sprite-graph/recommendations?surface=…
 * POST /api/sprite-graph/recommendations  { surface?, facts? }
 */
app.get("/api/sprite-graph/recommendations", async (req, res) => {
  try {
    const surface = req.query.surface ? String(req.query.surface) : null;
    const payload = await resolveGraphRecommendations(pool, null, { surface });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] recommendations:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.post("/api/sprite-graph/recommendations", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const surface = body.surface ? String(body.surface) : null;
    const facts = body.facts && typeof body.facts === "object" ? body.facts : null;
    const payload = await resolveGraphRecommendations(pool, null, { surface, facts });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph] recommendations post:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 86 — evaluate simple boolean rules against explicit facts.
 * POST /api/sprite-graph/rules/evaluate
 */
app.post("/api/sprite-graph/rules/evaluate", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const facts = body.facts && typeof body.facts === "object" ? body.facts : body;
    res.json(evaluateSimpleGraphRules(facts));
  } catch (err) {
    console.error("[sprite-graph] rules evaluate:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 87 — scoring policy (no hidden user-value scores).
 * GET /api/sprite-graph/scoring-policy
 */
app.get("/api/sprite-graph/scoring-policy", async (_req, res) => {
  try {
    res.json(getGraphScoringPolicy());
  } catch (err) {
    console.error("[sprite-graph] scoring policy:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
