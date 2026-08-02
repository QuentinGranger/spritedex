"use strict";

const { app, getRequestingUser } = require("./shared");
const { resolveCompareUser } = require("./users");
const { buildCompareResult } = require("./service");

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


module.exports = {  };
