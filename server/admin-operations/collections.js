"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 5. Collections & integrity ─────────────────────────────────────────────

app.get("/api/admin/collections/integrity", requireAdminCapability("collections.read"), route(async (_req, res) => {
  const [orphaned, mismatched, invalid, migration, passportQueue, latestErrors, mismatchedEntries] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries se
                LEFT JOIN sprite_variants sv ON sv.id = se.variant_id
                LEFT JOIN sprites s ON s.id = se.variant_id
                WHERE sv.id IS NULL AND s.id IS NULL`),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries se
                JOIN sprite_variants sv ON sv.id = se.variant_id
                WHERE se.sprite_id IS DISTINCT FROM sv.sprite_id`),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprite_entries
                WHERE status NOT IN ('new', 'owned', 'missing', 'priority', 'spotted', 'unavailable', 'unknown')`),
    pool.query("SELECT COUNT(*)::int AS count FROM migration_errors"),
    pool.query(`SELECT status, COUNT(*)::int AS count FROM passport_recalc_queue GROUP BY status ORDER BY status`),
    pool.query(`SELECT id, table_name, original_key, error, created_at FROM migration_errors ORDER BY created_at DESC LIMIT 12`),
    pool.query(`SELECT se.id, se.variant_id, se.sprite_id AS current_sprite_id, sv.sprite_id AS expected_sprite_id, u.username
                FROM sprite_entries se JOIN sprite_variants sv ON sv.id = se.variant_id
                LEFT JOIN users u ON u.id = se.user_id
                WHERE se.sprite_id IS DISTINCT FROM sv.sprite_id ORDER BY se.updated_at DESC LIMIT 50`)
  ]);
  res.json({
    checks: {
      orphanedEntries: orphaned.rows[0]?.count || 0,
      mismatchedSpriteReferences: mismatched.rows[0]?.count || 0,
      invalidStatuses: invalid.rows[0]?.count || 0,
      migrationErrors: migration.rows[0]?.count || 0
    },
    passportQueue: passportQueue.rows,
    latestMigrationErrors: latestErrors.rows,
    mismatchedEntries: mismatchedEntries.rows
  });
}));

app.post("/api/admin/collections/integrity/repair", requireAdminCapability("collections.write"), adminMutationLimiter, route(async (req, res) => {
  const action = text(req.body?.action, 60);
  const reason = text(req.body?.reason, 1000);
  const entryIds = Array.isArray(req.body?.entryIds) ? [...new Set(req.body.entryIds.map(numberId).filter(Boolean))].slice(0, 50) : [];
  if (action !== "backfill-sprite-references" || !reason) return res.status(400).json({ error: "Action et justification requises" });
  const repaired = await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE sprite_entries se SET sprite_id = sv.sprite_id, updated_at = NOW()
       FROM sprite_variants sv
       WHERE sv.id = se.variant_id AND se.sprite_id IS DISTINCT FROM sv.sprite_id
       ${entryIds.length ? "AND se.id = ANY($1::bigint[])" : ""}
       RETURNING se.id`, entryIds.length ? [entryIds] : []
    );
    return result.rows.length;
  }, (count) => ({
    actor: adminActorFromReq(req),
    action: "collection.references_repaired",
    targetType: "collection",
    targetId: "sprite_entries",
    justification: reason,
    details: { repaired: count, requestedEntryIds: entryIds }
  }));
  res.json({ ok: true, repaired });
}));

