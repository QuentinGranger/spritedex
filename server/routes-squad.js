// routes-squad.js — extracted from server.js

const security = require("../security");
const { getRequestingUser, requireSquadMember } = require("./auth");
const { app } = require("./core");
const { pool } = require("./db");
const crypto = require("crypto");

// ── Squad : secure code generation ──
function generateSquadCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return "SPRITE-" + code;
}

// ── Squad : create ──
app.post("/api/squads", security.squadCreateLimiter, security.validateBody(security.schemas.squadCreateSchema), async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const { name } = req.validatedBody;

  const code = generateSquadCode();
  const squadName = (name || "Mon escouade").trim().slice(0, 50);

  try {
    const result = await pool.query(
      `INSERT INTO squads (code, name, created_by) VALUES ($1, $2, $3) RETURNING id, code, name, created_at`,
      [code, squadName, userId]
    );
    const squad = result.rows[0];
    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [squad.id, userId]
    );
    res.json(squad);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Code déjà pris, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : join by code ──
app.post("/api/squads/join", security.squadJoinLimiter, security.validateBody(security.schemas.squadJoinSchema), async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const { code } = req.validatedBody;

  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, join_open, created_at FROM squads WHERE code = $1",
      [code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Code d'escouade introuvable" });
    }
    const squad = squadResult.rows[0];
    if (squad.join_open === false) {
      return res.status(403).json({ error: "Cette escouade n'accepte plus de nouveaux membres" });
    }

    const memberCount = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1",
      [squad.id]
    );
    if (parseInt(memberCount.rows[0].count) >= 10) {
      return res.status(400).json({ error: "Escouade pleine (max 10)" });
    }

    await pool.query(
      `INSERT INTO squad_members (squad_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [squad.id, userId]
    );
    res.json(squad);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : get squad details + members with collections ──
app.get("/api/squads/:code", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id, code, name, created_by, created_at FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) {
      return res.status(404).json({ error: "Escouade introuvable" });
    }
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;
    const squad = squadResult.rows[0];

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.avatar_url, sm.joined_at
       FROM squad_members sm
       JOIN users u ON u.id = sm.user_id
       WHERE sm.squad_id = $1
       ORDER BY sm.joined_at`,
      [squad.id]
    );

    const members = [];
    for (const member of membersResult.rows) {
      const entriesResult = await pool.query(
        "SELECT sprite_id, status, priority, updated_at FROM sprite_entries WHERE user_id = $1",
        [member.id]
      );
      const collection = {};
      let lastUpdated = null;
      for (const row of entriesResult.rows) {
        collection[row.sprite_id] = { status: row.status, priority: row.priority || "none" };
        if (row.updated_at && (!lastUpdated || row.updated_at > lastUpdated)) {
          lastUpdated = row.updated_at;
        }
      }
      members.push({
        userId: member.id,
        username: member.username,
        avatarUrl: member.avatar_url || "",
        role: String(member.id) === String(squad.created_by) ? "owner" : "member",
        collection,
        entryCount: entriesResult.rows.length,
        lastUpdated
      });
    }

    res.json({
      id: squad.id,
      code: squad.code,
      name: squad.name,
      createdBy: squad.created_by,
      createdAt: squad.created_at,
      joinOpen: squad.join_open !== false,
      members
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : leave ──
app.post("/api/squads/:code/leave", async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });

    await pool.query(
      "DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squadResult.rows[0].id, userId]
    );

    const remaining = await pool.query(
      "SELECT COUNT(*) FROM squad_members WHERE squad_id = $1",
      [squadResult.rows[0].id]
    );
    if (parseInt(remaining.rows[0].count) === 0) {
      await pool.query("DELETE FROM squads WHERE id = $1", [squadResult.rows[0].id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : kick member (creator only) ──
app.post("/api/squads/:code/kick", async (req, res) => {
  // SECURITY FIX: this was previously calling getRequestingUser() without
  // `await`, so reqUser held a pending Promise (always truthy) and every
  // String(reqUser) comparison against created_by failed — the route was
  // unusable for legitimate owners and, more importantly, was never actually
  // enforcing the ownership check it appeared to have.
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: "targetUserId requis" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut retirer un membre" });
    }
    if (String(targetUserId) === String(reqUser)) {
      return res.status(400).json({ error: "Utilisez la route leave pour vous retirer" });
    }
    await pool.query(
      "DELETE FROM squad_members WHERE squad_id = $1 AND user_id = $2",
      [squad.id, targetUserId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : regenerate code (creator only) ──
app.post("/api/squads/:code/regenerate", security.squadCodeLimiter, async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut régénérer le code" });
    }
    const newCode = generateSquadCode();
    await pool.query("UPDATE squads SET code = $1 WHERE id = $2", [newCode, squad.id]);
    res.json({ ok: true, code: newCode });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Collision de code, réessayez" });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : toggle join open/closed (creator only) ──
app.post("/api/squads/:code/toggle-join", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by, join_open FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut modifier l'accès" });
    }
    const newState = squad.join_open === false ? true : false;
    await pool.query("UPDATE squads SET join_open = $1 WHERE id = $2", [newState, squad.id]);
    res.json({ ok: true, joinOpen: newState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : history ──
app.get("/api/squads/:code/history", async (req, res) => {
  try {
    const squadResult = await pool.query(
      "SELECT id FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    if (!(await requireSquadMember(req, res, squadResult.rows[0].id))) return;

    const days = parseInt(req.query.days) || 7;
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);

    const result = await pool.query(
      `SELECT sa.sprite_id, sa.action, sa.created_at, u.username
       FROM squad_activity sa
       JOIN users u ON u.id = sa.user_id
       WHERE sa.squad_id = $1 AND sa.created_at > NOW() - INTERVAL '1 day' * $2
       ORDER BY sa.created_at DESC
       LIMIT $3`,
      [squadResult.rows[0].id, days, limit]
    );

    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Squad : delete (creator only) ──
app.delete("/api/squads/:code", async (req, res) => {
  const reqUser = await getRequestingUser(req);
  if (!reqUser) return res.status(401).json({ error: "Authentification requise" });
  try {
    const squadResult = await pool.query(
      "SELECT id, created_by FROM squads WHERE code = $1",
      [req.params.code.trim().toUpperCase()]
    );
    if (!squadResult.rows.length) return res.status(404).json({ error: "Escouade introuvable" });
    const squad = squadResult.rows[0];
    if (String(squad.created_by) !== String(reqUser)) {
      return res.status(403).json({ error: "Seul le créateur peut supprimer l'escouade" });
    }
    await pool.query("DELETE FROM squads WHERE id = $1", [squad.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// SECURITY: the legacy "/api/squad/:username" route has been removed. It
// exposed ANY user's full collection (status + priority for every sprite)
// to ANYONE who knew their username, with zero authentication and zero
// regard for the "private" / "squad_only" privacy setting — a complete
// bypass of the privacy model. It was not called anywhere in the frontend
// (which uses /api/squads/:code for squad comparisons instead), so removing
// it does not affect any existing feature.

// ── Squad : join link redirect ──
app.get("/squad/join/:code", (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  res.redirect(`/?joinSquad=${encodeURIComponent(code)}`);
});

module.exports = { generateSquadCode };
