const {
  app, pool, requireNotSuspended, requireSameUser, invalidateCompareCacheForUser,
  invalidateSquadAnalysisCacheForUser, broadcastSquadCompletionUpdate,
  broadcastCompareUpdate, broadcastFriendCollectionUpdate
} = require("./shared");
const { scheduleSquadStatsForUser } = require("./effects");

app.delete("/api/collection/:userId", requireNotSuspended, async (req, res) => {
  if (!(await requireSameUser(req, res, req.params.userId))) return;
  try {
    await pool.query("DELETE FROM sprite_entries WHERE user_id = $1", [req.params.userId]);
    res.json({ ok: true });
    invalidateCompareCacheForUser(req.params.userId);
    invalidateSquadAnalysisCacheForUser(req.params.userId);
    scheduleSquadStatsForUser(req.params.userId).catch(err =>
      console.error("[reset collection] squad stats refresh failed", err)
    );
    broadcastSquadCompletionUpdate(req.params.userId);
    broadcastCompareUpdate(req.params.userId, { type: "compare_reset" });
    broadcastFriendCollectionUpdate(req.params.userId);
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

    const monthResult = await pool.query(
      `SELECT date_trunc('month', created_at) AS month, COUNT(*) AS changes,
              COUNT(*) FILTER (WHERE new_status = 'owned') AS acquisitions
       FROM collection_history
       WHERE user_id = $1 AND created_at > NOW() - INTERVAL '12 months'
       GROUP BY month ORDER BY month ASC`,
      [userId]
    );

    res.json({
      history: result.rows,
      total,
      hasMore: offset + result.rows.length < total,
      weeklyStats: weekResult.rows,
      monthlyStats: monthResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
