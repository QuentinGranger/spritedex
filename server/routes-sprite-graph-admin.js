"use strict";

// ── Sprite Graph internal control board (Étapes 97–98) ───────────────────────
// Admin-only. Never expose technical metrics in the public product.

const { app } = require("./core");
const { pool } = require("./db");
const { getRequestingUser } = require("./auth");
const { attachAdminSession } = require("./admin-access");
const { hasCapability } = require("./admin-authz");
const { withAdminAudit, AdminHttpError } = require("./admin-audit");
const { rateLimit } = require("../security");
const {
  getSpriteGraphTechnicalMetrics,
  getSpriteGraphControlBoard,
  setPublicMetricDisabled,
  listPublicMetricFlags,
  getAdminAggregateExport,
  isSpriteGraphAdmin,
  GRAPH_ADMIN_IDS
} = require("./sprite-graph-metrics");
const { getGraphFormulaRegistry } = require("./sprite-graph-formula");
const { getGraphMetricCatalog, getGraphMetricDoc } = require("./sprite-graph-metric-catalog");
const { evaluateGraphV1Readiness } = require("./sprite-graph-v1-validation");

const graphFlagMutationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyPrefix: "admin-graph-flags",
  message: "Trop d’actions sur les métriques. Réessaie dans quelques minutes."
});

function cleanReason(value) {
  if (value == null) return null;
  const text = String(value).trim().slice(0, 500);
  return text || null;
}

async function requireGraphAdmin(req, res, { write = false } = {}) {
  const adminSession = await attachAdminSession(req, {
    ip: req.ip,
    userAgent: req.get("user-agent")
  });
  if (adminSession) {
    const needed = write ? "intelligence.write" : "intelligence.read";
    if (!hasCapability(adminSession, needed)) {
      res.status(403).json({ error: "Privilège insuffisant", required: [needed], role: adminSession.role || null });
      return null;
    }
    return { source: "terminal", userId: null, actor: adminSession.actor, role: adminSession.role };
  }
  const reqUser = await getRequestingUser(req);
  if (!reqUser) {
    res.status(401).json({ error: "Authentification requise" });
    return null;
  }
  if (!isSpriteGraphAdmin(reqUser)) {
    res.status(403).json({ error: "Accès réservé" });
    return null;
  }
  return { source: "account", userId: reqUser, actor: `account:${reqUser}` };
}

/**
 * Étape 98 — internal control board.
 * GET /api/admin/sprite-graph/control-board
 */
app.get("/api/admin/sprite-graph/control-board", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const board = await getSpriteGraphControlBoard(pool);
    res.json(board);
  } catch (err) {
    console.error("[sprite-graph-admin] control-board:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 97 — technical metrics (not for public product).
 * GET /api/admin/sprite-graph/technical-metrics
 */
app.get("/api/admin/sprite-graph/technical-metrics", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const windowMinutes = Number(req.query.windowMinutes) || 60;
    const metrics = await getSpriteGraphTechnicalMetrics(pool, { windowMinutes });
    res.json(metrics);
  } catch (err) {
    console.error("[sprite-graph-admin] technical-metrics:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 98 — temporarily disable an incorrect public metric.
 * PATCH /api/admin/sprite-graph/flags
 * body: { metricKey, disabled, reason }
 */
app.patch("/api/admin/sprite-graph/flags", graphFlagMutationLimiter, async (req, res) => {
  try {
    const admin = await requireGraphAdmin(req, res, { write: true });
    if (!admin) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const metricKey = body.metricKey || body.key;
    const disabled = body.disabled !== false;
    const reason = cleanReason(body.reason);
    if (!metricKey) return res.status(400).json({ error: "metricKey requis" });
    if (!reason) return res.status(400).json({ error: "Une justification est requise" });

    const row = await withAdminAudit(async (client) => (
      setPublicMetricDisabled(client, metricKey, {
        disabled,
        reason,
        updatedBy: admin.userId
      })
    ), {
      actor: admin.actor,
      action: disabled ? "graph.metric_suspended" : "graph.metric_restored",
      targetType: "graph_metric",
      targetId: String(metricKey).slice(0, 160),
      justification: reason,
      details: {
        disabled,
        source: admin.source,
        accountUserId: admin.userId
      }
    });

    res.json({
      ok: true,
      flag: {
        key: row.flag_key,
        disabled: row.disabled,
        reason: row.reason,
        updatedAt: row.updated_at
      },
      flags: await listPublicMetricFlags(pool)
    });
  } catch (err) {
    console.error("[sprite-graph-admin] flags:", err.message);
    if (err instanceof AdminHttpError || (Number.isInteger(err.status) && err.status >= 400 && err.status < 600)) {
      return res.status(err.status).json({ error: err.message || "Requête invalide" });
    }
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 99 — formula registry.
 * GET /api/admin/sprite-graph/formulas
 */
app.get("/api/admin/sprite-graph/formulas", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    res.json(getGraphFormulaRegistry());
  } catch (err) {
    console.error("[sprite-graph-admin] formulas:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 96 — admin aggregate export (no raw events / no PII).
 * GET /api/admin/sprite-graph/export/aggregates?asOf=YYYY-MM-DD
 */
app.get("/api/admin/sprite-graph/export/aggregates", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const metricDate = req.query.asOf ? String(req.query.asOf).slice(0, 10) : null;
    const limit = Number(req.query.limit) || 200;
    const payload = await getAdminAggregateExport(pool, { metricDate, limit });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph-admin] export:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 100 — metric documentation catalog.
 * GET /api/admin/sprite-graph/metrics-catalog
 * GET /api/admin/sprite-graph/metrics-catalog/:metricId
 */
app.get("/api/admin/sprite-graph/metrics-catalog", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const surface = req.query.surface ? String(req.query.surface) : null;
    res.json(getGraphMetricCatalog({ surface }));
  } catch (err) {
    console.error("[sprite-graph-admin] metrics-catalog:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/admin/sprite-graph/metrics-catalog/:metricId", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const doc = getGraphMetricDoc(String(req.params.metricId || ""));
    if (!doc) return res.status(404).json({ error: "Métrique introuvable" });
    res.json(doc);
  } catch (err) {
    console.error("[sprite-graph-admin] metric doc:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

/**
 * Étape 101 — v1 readiness validation.
 * GET /api/admin/sprite-graph/v1-readiness?live=1
 */
app.get("/api/admin/sprite-graph/v1-readiness", async (req, res) => {
  try {
    if (!(await requireGraphAdmin(req, res))) return;
    const includeLiveProbes = String(req.query.live || "") === "1";
    const payload = await evaluateGraphV1Readiness(pool, { includeLiveProbes });
    res.json(payload);
  } catch (err) {
    console.error("[sprite-graph-admin] v1-readiness:", err.message);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

module.exports = {
  isSpriteGraphAdmin,
  GRAPH_ADMIN_IDS
};
