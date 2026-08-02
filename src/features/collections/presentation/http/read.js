const { app, pool, canViewCollection, getRequestingUser } = require("./shared");

app.get("/api/collection/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userResult = await pool.query(
      `SELECT id, privacy, profile_visibility, collection_visibility, priority_visibility, notes_visibility, visibility
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!userResult.rows.length) return res.status(404).json({ error: "Utilisateur non trouvé" });
    const reqUser = await getRequestingUser(req);
    if (!(await canViewCollection(reqUser, userId))) {
      return res.status(403).json({ error: "Collection non accessible" });
    }

    const canSeePriority = await canViewCollection(reqUser, userId, { visibilityKey: "priorities" });
    const canSeeNotes = await canViewCollection(reqUser, userId, { visibilityKey: "notes" });

    const result = await pool.query(
      "SELECT variant_id, sprite_id, status, note, priority, obtained_at, mastery_level, updated_at FROM sprite_entries WHERE user_id = $1",
      [userId]
    );
    // variant_id values originate from persisted user data, including older
    // imports made before key validation existed.  A null-prototype record
    // keeps a legacy "__proto__" row inert while it is serialized.
    const collection = Object.create(null);
    for (const row of result.rows) {
      collection[row.variant_id] = {
        spriteId: row.sprite_id,
        status: row.status,
        note: canSeeNotes ? row.note || "" : "",
        priority: canSeePriority ? row.priority || "none" : "none",
        masteryLevel: row.status === "owned" ? Math.max(1, Number(row.mastery_level) || 1) : 0,
        obtainedAt: row.obtained_at || null,
        updatedAt: row.updated_at
      };
    }
    res.json(collection);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Notify friends about generic collection edits ───────────────────────
// friend_priority_match is replaced by collection.variant_acquired →
// friend_acquired_missing_variant (Étapes 15–21). This path only emits a
