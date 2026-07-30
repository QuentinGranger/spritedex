const { app } = require("./core");
const { pool } = require("./db");
const { getRequestingUser, requireNotSuspended, requireSquadMember, canViewCollection } = require("./auth");
const { broadcastSquadUpdate } = require("./ws");

const MAX_VARIANT_ID_LENGTH = 120;

async function getWishlistSquad(code) {
  const result = await pool.query("SELECT id, code, name FROM squads WHERE code = $1", [String(code || "").trim().toUpperCase()]);
  return result.rows[0] || null;
}

function validVariantId(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_VARIANT_ID_LENGTH;
}

async function getVisibleCoverage(squadId, viewerId, variantIds) {
  if (!variantIds.length) return new Map();
  const members = await pool.query("SELECT user_id FROM squad_members WHERE squad_id = $1 AND status = 'active'", [squadId]);
  const visibleIds = [];
  for (const member of members.rows) {
    if (String(member.user_id) === String(viewerId) || await canViewCollection(viewerId, member.user_id)) visibleIds.push(member.user_id);
  }
  if (!visibleIds.length) return new Map();
  const owners = await pool.query(
    `SELECT variant_id, COUNT(DISTINCT user_id)::int AS owner_count
     FROM sprite_entries
     WHERE variant_id = ANY($1::text[]) AND user_id = ANY($2::integer[]) AND status = 'owned'
     GROUP BY variant_id`,
    [variantIds, visibleIds]
  );
  return new Map(owners.rows.map(row => [String(row.variant_id), Number(row.owner_count) || 0]));
}

async function serializeWishlist(squad, viewerId) {
  const [members, items] = await Promise.all([
    pool.query(`SELECT sm.user_id, COALESCE(u.display_name, u.username) AS username
      FROM squad_members sm JOIN users u ON u.id = sm.user_id
      WHERE sm.squad_id = $1 AND sm.status = 'active' ORDER BY username`, [squad.id]),
    pool.query(`SELECT w.*, COALESCE(assignee.display_name, assignee.username) AS assigned_name,
      COALESCE(found.display_name, found.username) AS found_name
      FROM squad_wishlist_items w
      LEFT JOIN users assignee ON assignee.id = w.assigned_to
      LEFT JOIN users found ON found.id = w.found_by
      WHERE w.squad_id = $1 ORDER BY (w.status = 'wanted') DESC, w.updated_at DESC`, [squad.id])
  ]);
  const coverage = await getVisibleCoverage(squad.id, viewerId, items.rows.map(row => String(row.variant_id)));
  return {
    squadCode: squad.code,
    members: members.rows.map(row => ({ userId: String(row.user_id), username: row.username || String(row.user_id) })),
    items: items.rows.map(row => {
      const ownerCount = coverage.get(String(row.variant_id)) || 0;
      return {
        id: row.id,
        variantId: row.variant_id,
        createdBy: String(row.created_by),
        assignedTo: row.assigned_to ? String(row.assigned_to) : null,
        assignedName: row.assigned_name || null,
        status: row.status,
        foundBy: row.found_by ? String(row.found_by) : null,
        foundName: row.found_name || null,
        ownerCount,
        coverage: ownerCount > 1 ? "duplicate" : ownerCount === 1 ? "covered" : "uncovered",
        updatedAt: row.updated_at
      };
    })
  };
}

app.get("/api/squads/:code/wishlist", async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const squad = await getWishlistSquad(req.params.code);
  if (!squad) return res.status(404).json({ error: "Escouade introuvable" });
  if (!await requireSquadMember(req, res, squad.id)) return;
  try { res.json(await serializeWishlist(squad, userId)); }
  catch (error) { console.error("[wishlist list]", error); res.status(500).json({ error: "Erreur serveur" }); }
});

app.post("/api/squads/:code/wishlist", requireNotSuspended, async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const squad = await getWishlistSquad(req.params.code);
  if (!squad) return res.status(404).json({ error: "Escouade introuvable" });
  if (!await requireSquadMember(req, res, squad.id)) return;
  const variantId = typeof req.body?.variantId === "string" ? req.body.variantId.trim() : "";
  if (!validVariantId(variantId)) return res.status(400).json({ error: "Variante invalide" });
  try {
    await pool.query(`INSERT INTO squad_wishlist_items (squad_id, variant_id, created_by)
      VALUES ($1, $2, $3) ON CONFLICT (squad_id, variant_id) DO UPDATE SET updated_at = NOW()`, [squad.id, variantId, userId]);
    broadcastSquadUpdate(userId);
    res.status(201).json(await serializeWishlist(squad, userId));
  } catch (error) { console.error("[wishlist create]", error); res.status(500).json({ error: "Erreur serveur" }); }
});

app.patch("/api/squads/:code/wishlist/:itemId", requireNotSuspended, async (req, res) => {
  const userId = await getRequestingUser(req);
  if (!userId) return res.status(401).json({ error: "Authentification requise" });
  const squad = await getWishlistSquad(req.params.code);
  if (!squad) return res.status(404).json({ error: "Escouade introuvable" });
  if (!await requireSquadMember(req, res, squad.id)) return;
  const status = req.body?.status;
  const assignedTo = req.body?.assignedTo;
  const hasAssignment = Object.prototype.hasOwnProperty.call(req.body || {}, "assignedTo");
  if (status !== undefined && status !== "wanted" && status !== "found") return res.status(400).json({ error: "Statut invalide" });
  let assignee = null;
  if (hasAssignment && assignedTo !== null && assignedTo !== "") {
    if (!/^\d+$/.test(String(assignedTo))) return res.status(400).json({ error: "Membre invalide" });
    assignee = Number(assignedTo);
    const member = await pool.query("SELECT 1 FROM squad_members WHERE squad_id = $1 AND user_id = $2 AND status = 'active'", [squad.id, assignee]);
    if (!member.rows.length) return res.status(400).json({ error: "Le membre doit appartenir à la squad" });
  }
  try {
    const result = await pool.query(`UPDATE squad_wishlist_items
      SET assigned_to = CASE WHEN $3 THEN $4::integer ELSE assigned_to END,
          status = COALESCE($5, status),
          found_by = CASE WHEN $5 = 'found' THEN $6::integer WHEN $5 = 'wanted' THEN NULL ELSE found_by END,
          updated_at = NOW()
      WHERE id = $1 AND squad_id = $2 RETURNING id`, [req.params.itemId, squad.id, hasAssignment, assignee, status || null, Number(userId)]);
    if (!result.rows.length) return res.status(404).json({ error: "Souhait introuvable" });
    broadcastSquadUpdate(userId);
    res.json(await serializeWishlist(squad, userId));
  } catch (error) { console.error("[wishlist update]", error); res.status(500).json({ error: "Erreur serveur" }); }
});
