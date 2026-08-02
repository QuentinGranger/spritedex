"use strict";

const { crypto, app, pool, requireAdminCapability, requireAdminStepUp, adminActorFromReq, listActiveAdminSessions, describeAuthz, hasCapability, isAdminMfaConfigured, revokeUserSockets, invalidateSquadAnalysisCacheForUser, enqueuePassportRecalc, processDeliveryQueue, syncCatalogueMetaAndFanout, fanoutPublishedNews, buildUserDataExport, listDeletionQueue, purgeDeletedAccounts, retentionDays, restoreDeletedAccount, revokeActiveShareCapabilities, rateLimit, writeAdminAudit, withAdminAudit, AdminHttpError, notFound, adminMutationLimiter, PAGE_SIZE, MAX_PAGE_SIZE, MAX_AUDIT_EXPORT_ROWS, REPORT_STATUSES, REPORT_PRIORITIES, APPEAL_STATUSES, NEWS_STATUSES, DATA_STATUSES, AVAILABILITY_STATUSES, CONFIDENCE_LEVELS, EDITORIAL_STATUSES, numberId, pagination, text, nullableDate, jsonValue, validUrl, validAssetUrl, audit, route, paged, safeAuditDetails, auditRowForAdmin, auditFilters, csvCell } = require("./shared");

// ── 3. Catalogue ───────────────────────────────────────────────────────────

app.get("/api/admin/catalog", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const query = text(req.query.q, 100);
  const status = text(req.query.status, 20);
  const values = [];
  const where = [];
  const normalizedSlug = (alias) => `COALESCE(NULLIF(${alias}.slug, ''), REPLACE(REGEXP_REPLACE(${alias}.id, '^sprite_', ''), '_', '-'))`;
  // A legacy import created short ids ("striker") beside the canonical
  // "sprite_striker" rows. Keep legacy rows reachable through the integrity
  // filter, but never mix them into the day-to-day editorial catalogue.
  if (status !== "data_issues") where.push(`NOT EXISTS (
    SELECT 1 FROM sprites canonical
    WHERE canonical.id <> s.id AND canonical.id LIKE 'sprite\\_%' ESCAPE '\\'
      AND ${normalizedSlug("canonical")} = ${normalizedSlug("s")}
  )`);
  if (query) {
    values.push(`%${query.replace(/[\\%_]/g, "\\$&")}%`);
    where.push(`(s.name ILIKE $${values.length} ESCAPE '\\' OR s.id ILIKE $${values.length} ESCAPE '\\')`);
  }
  if (EDITORIAL_STATUSES.has(status)) where.push(`COALESCE(s.editorial_status, CASE WHEN s.is_released IS FALSE THEN 'draft' ELSE 'published' END) = '${status}'`);
  if (status === "needs_review") where.push("s.data_status IS NULL OR s.data_status IN ('incomplete', 'unknown')");
  if (status === "data_issues") where.push(`
    EXISTS (SELECT 1 FROM sprites canonical_issue
            WHERE canonical_issue.id <> s.id AND canonical_issue.id LIKE 'sprite\\_%' ESCAPE '\\'
              AND ${normalizedSlug("canonical_issue")} = ${normalizedSlug("s")})
    OR (NOT EXISTS (SELECT 1 FROM sprite_variants sv_issue WHERE sv_issue.sprite_id = s.id)
        AND COALESCE(CARDINALITY(s.variants), 0) = 0)
    OR (NULLIF(BTRIM(s.image), '') IS NULL
        AND NOT EXISTS (SELECT 1 FROM sprite_images si_issue WHERE si_issue.sprite_id = s.id))
  `);
  if (status === "unreleased") where.push("s.is_released IS FALSE");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(
      `SELECT s.id, s.name, s.rarity, s.color, s.available,
              COALESCE(NULLIF(BTRIM(s.image), ''),
                (SELECT COALESCE(NULLIF(BTRIM(sv_preview.image_path), ''), NULLIF(BTRIM(sv_preview.suggested_image_path), ''))
                 FROM sprite_variants sv_preview
                 WHERE sv_preview.sprite_id = s.id
                 ORDER BY CASE WHEN LOWER(sv_preview.variant_type) = 'base' THEN 0 ELSE 1 END, sv_preview.updated_at DESC NULLS LAST
                 LIMIT 1),
                (SELECT NULLIF(BTRIM(si_preview.image_path), '')
                 FROM sprite_images si_preview
                 WHERE si_preview.sprite_id = s.id
                 ORDER BY CASE WHEN LOWER(si_preview.variant) = 'base' THEN 0 ELSE 1 END, si_preview.variant
                 LIMIT 1)
              ) AS image, s.event_id, s.season_id,
              s.data_status, s.is_released, s.editorial_status, s.editorial_updated_at, s.last_verified_at, s.catalog_version,
              GREATEST(COUNT(sv.id)::int, COALESCE(CARDINALITY(s.variants), 0))::int AS variant_count,
              COUNT(sv.id) FILTER (WHERE sv.data_status IS NULL OR sv.data_status IN ('incomplete', 'unknown'))::int AS variants_needing_review,
              COUNT(*) OVER (PARTITION BY LOWER(s.name))::int AS same_name_records
       FROM sprites s
       LEFT JOIN sprite_variants sv ON sv.sprite_id = s.id
       ${clause}
       GROUP BY s.id
       ORDER BY variant_count DESC, s.last_verified_at DESC NULLS LAST, s.name ASC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM sprites s ${clause}`, values.slice(0, -2))
  ]);
  res.json(paged(list.rows.map(row => ({
    id: row.id, name: row.name, rarity: row.rarity, color: row.color, available: row.available,
    image: row.image, eventId: row.event_id, seasonId: row.season_id, dataStatus: row.data_status,
    isReleased: row.is_released, editorialStatus: row.editorial_status || (row.is_released === false ? "draft" : "published"), editorialUpdatedAt: row.editorial_updated_at, lastVerifiedAt: row.last_verified_at, catalogVersion: row.catalog_version,
    variantCount: row.variant_count, variantsNeedingReview: row.variants_needing_review, sameNameRecords: row.same_name_records
  })), count.rows[0]?.count, { page, pageSize }));
}));

app.get("/api/admin/catalog/:spriteId", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const sprite = await pool.query(
    `SELECT id, catalog_id, slug, name, official_name, rarity, color, effect, variants, available, image, event_id, season_id,
            introduced_in_update, first_observed_at, last_verified_at, officially_announced_at, ability, acquisition,
            availability, recurrence, dates, missing_fields, base_summon_cost, data_status, notes, sources, catalog_version,
            catalog_generated_at, is_released, editorial_status, editorial_updated_at
     FROM sprites WHERE id = $1`, [req.params.spriteId]
  );
  if (!sprite.rows.length) return res.status(404).json({ error: "Sprite introuvable" });
  const [variants, availability, history, spriteImages] = await Promise.all([
    pool.query(`SELECT id, sprite_id, variant_type, name, official_name, slug, rarity, image_path, suggested_image_path,
                       release_status, first_observed_at, summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref,
                       effect, acquisition, availability, recurrence, dates, missing_fields, data_status, sources, editorial_status, editorial_updated_at, updated_at
                FROM sprite_variants WHERE sprite_id = $1 ORDER BY variant_type`, [req.params.spriteId]),
    pool.query(`SELECT id, start_date, end_date, status, event_id, confidence, data_status, sources, updated_at
                FROM availability_periods WHERE sprite_id = $1 ORDER BY start_date DESC NULLS LAST`, [req.params.spriteId]),
    pool.query(`SELECT id, entity_type, field, previous_value, new_value, changed_by, changed_at, reason, source_id
                FROM catalog_change_history WHERE entity_id = $1 ORDER BY changed_at DESC LIMIT 20`, [req.params.spriteId]),
    pool.query("SELECT variant, image_path FROM sprite_images WHERE sprite_id = $1", [req.params.spriteId])
  ]);
  // Some production databases still have the original seed representation:
  // `sprites.variants` + `sprite_images`, before `sprite_variants` existed.
  // Expose those as read-only compatibility rows instead of pretending the
  // sprite has no variants in the admin UI.
  const imageByVariant = new Map(spriteImages.rows.map((row) => [String(row.variant || "").toLowerCase(), row.image_path]));
  const relationalTypes = new Set(variants.rows.map((row) => String(row.variant_type || "").toLowerCase()));
  const compatibilityVariants = (Array.isArray(sprite.rows[0].variants) ? sprite.rows[0].variants : [])
    .filter((variant) => !relationalTypes.has(String(variant).toLowerCase()))
    .map((variant) => ({
      id: `${sprite.rows[0].id}::${variant}`,
      sprite_id: sprite.rows[0].id,
      variant_type: variant,
      name: variant,
      rarity: sprite.rows[0].rarity,
      image_path: imageByVariant.get(String(variant).toLowerCase()) || null,
      suggested_image_path: null,
      release_status: null,
      data_status: sprite.rows[0].data_status || "unknown",
      editorial_status: sprite.rows[0].editorial_status || "published",
      is_compatibility_variant: true
    }));
  res.json({ sprite: sprite.rows[0], variants: [...variants.rows, ...compatibilityVariants], availabilityPeriods: availability.rows, history: history.rows });
}));

const spriteEditableFields = {
  catalogId: { column: "catalog_id", limit: 50 }, slug: { column: "slug", limit: 50 }, name: { column: "name", limit: 100 }, officialName: { column: "official_name", limit: 100 }, rarity: { column: "rarity", limit: 30 }, color: { column: "color", limit: 60 },
  effect: { column: "effect", limit: 2000 }, variants: { column: "variants", array: true }, available: { column: "available", limit: 20 }, image: { column: "image", url: true, asset: true },
  eventId: { column: "event_id", limit: 100 }, seasonId: { column: "season_id", limit: 50 }, dataStatus: { column: "data_status", limit: 20 },
  introducedInUpdate: { column: "introduced_in_update", limit: 20 }, firstObservedAt: { column: "first_observed_at", date: true }, lastVerifiedAt: { column: "last_verified_at", date: true }, officiallyAnnouncedAt: { column: "officially_announced_at", date: true }, baseSummonCost: { column: "base_summon_cost", integer: true },
  ability: { column: "ability", json: true }, acquisition: { column: "acquisition", json: true }, availability: { column: "availability", json: true }, recurrence: { column: "recurrence", json: true }, dates: { column: "dates", json: true }, missingFields: { column: "missing_fields", json: true }, notes: { column: "notes", json: true }, sources: { column: "sources", json: true }, catalogVersion: { column: "catalog_version", limit: 32 }, isReleased: { column: "is_released", boolean: true }
};

function editableUpdates(raw, fields) {
  const updates = [];
  for (const [key, rule] of Object.entries(fields)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    let value;
    if (rule.boolean) value = raw[key] === true;
    else if (rule.array) { try { value = raw[key] === "" || raw[key] == null ? [] : (typeof raw[key] === "string" ? JSON.parse(raw[key]) : raw[key]); if (!Array.isArray(value) || value.some(item => typeof item !== "string" || item.length > 100)) return { error: `Liste invalide : ${key}` }; } catch (_) { return { error: `JSON invalide : ${key}` }; } }
    else if (rule.integer) { value = raw[key] === "" || raw[key] == null ? null : Number(raw[key]); if (value != null && (!Number.isInteger(value) || value < 0)) return { error: `Nombre invalide : ${key}` }; }
    else if (rule.decimal) { value = raw[key] === "" || raw[key] == null ? null : Number(raw[key]); if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) return { error: `Nombre invalide : ${key}` }; }
    else if (rule.json) {
      if (raw[key] === "" || raw[key] == null) value = null;
      else { try { value = typeof raw[key] === "string" ? JSON.parse(raw[key]) : raw[key]; } catch (_) { return { error: `JSON invalide : ${key}` }; } }
    }
    else if (rule.date) {
      value = nullableDate(raw[key]);
      if (value === undefined) return { error: `Date invalide : ${key}` };
    } else if (rule.url) {
      value = rule.asset ? validAssetUrl(raw[key]) : validUrl(raw[key]);
      if (raw[key] && !value) return { error: `URL invalide : ${key}` };
    } else {
      value = text(raw[key], rule.limit);
      if (key === "dataStatus" && value && !DATA_STATUSES.has(value)) return { error: "Statut de donnée invalide" };
    }
    updates.push({ key, column: rule.column, value });
  }
  return { updates };
}

async function updateCatalogEntity({ table, idColumn, id, fields, entityType, body, actor = "unknown" }) {
  const raw = jsonValue(body.updates, body);
  const parsed = editableUpdates(raw, fields);
  if (parsed.error) return { error: parsed.error, status: 400 };
  if (!parsed.updates.length) return { error: "Aucune modification valide", status: 400 };
  const reason = text(body.reason, 1000);
  if (!reason) return { error: "Une justification est requise", status: 400 };
  const columns = parsed.updates.map(change => change.column);
  const before = await pool.query(`SELECT ${columns.map(column => `"${column}"`).join(", ")} FROM ${table} WHERE ${idColumn} = $1`, [id]);
  if (!before.rows.length) return { error: "Élément introuvable", status: 404 };
  const values = [id, ...parsed.updates.map(change => change.value)];
  const set = parsed.updates.map((change, index) => `${change.column} = $${index + 2}`).join(", ");
  const updated = await withAdminAudit(async (client) => {
    const result = await client.query(
      `UPDATE ${table} SET ${set}${table === "sprite_variants" ? ", updated_at = NOW()" : ""} WHERE ${idColumn} = $1 RETURNING *`,
      values
    );
    for (const change of parsed.updates) {
      await client.query(
        `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
        [entityType, String(id), change.key, JSON.stringify(before.rows[0][change.column]), JSON.stringify(change.value), text(actor, 100) || "backoffice", reason]
      );
    }
    return result.rows[0];
  }, {
    actor,
    action: "catalog.updated",
    targetType: entityType,
    targetId: id,
    justification: reason,
    details: {
      fields: parsed.updates.map(change => change.key),
      changes: Object.fromEntries(parsed.updates.map((change) => [change.key, {
        before: before.rows[0][change.column],
        after: change.value
      }]))
    }
  });
  return { value: updated, releasedChanged: parsed.updates.some(change => change.key === "isReleased") };
}

app.patch("/api/admin/catalog/:spriteId", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprites", idColumn: "id", id: req.params.spriteId, fields: spriteEditableFields, entityType: "sprite", body: jsonValue(req.body), actor: adminActorFromReq(req) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  if (result.releasedChanged) syncCatalogueMetaAndFanout().catch(error => console.error("[admin] catalog fanout:", error.message));
  res.json({ ok: true, sprite: result.value });
}));

const variantEditableFields = {
  name: { column: "name", limit: 100 }, officialName: { column: "official_name", limit: 100 }, slug: { column: "slug", limit: 100 }, rarity: { column: "rarity", limit: 30 }, imagePath: { column: "image_path", url: true, asset: true }, suggestedImagePath: { column: "suggested_image_path", url: true, asset: true },
  releaseStatus: { column: "release_status", limit: 20 }, firstObservedAt: { column: "first_observed_at", date: true }, summonCost: { column: "summon_cost", integer: true }, spriteChestDropChancePct: { column: "sprite_chest_drop_chance_pct", decimal: true }, extraEffectRef: { column: "extra_effect_ref", limit: 50 }, dataStatus: { column: "data_status", limit: 20 },
  effect: { column: "effect", json: true }, acquisition: { column: "acquisition", json: true }, availability: { column: "availability", json: true }, recurrence: { column: "recurrence", json: true }, dates: { column: "dates", json: true }, missingFields: { column: "missing_fields", json: true }, sources: { column: "sources", json: true }
};

app.patch("/api/admin/catalog/variants/:variantId", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const result = await updateCatalogEntity({ table: "sprite_variants", idColumn: "id", id: req.params.variantId, fields: variantEditableFields, entityType: "variant", body: jsonValue(req.body), actor: adminActorFromReq(req) });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, variant: result.value });
}));

app.post("/api/admin/catalog/bulk-workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const spriteIds = Array.isArray(req.body?.spriteIds) ? [...new Set(req.body.spriteIds.map((id) => text(id, 100)).filter(Boolean))].slice(0, 50) : [];
  const status = text(req.body?.status, 20);
  const reason = text(req.body?.reason, 1000);
  if (!spriteIds.length || !EDITORIAL_STATUSES.has(status) || !reason) return res.status(400).json({ error: "Sélection, état et justification requis" });
  const updated = await withAdminAudit(async (client) => {
    const previous = await client.query(
      `SELECT id, editorial_status, is_released FROM sprites
       WHERE id = ANY($1::text[]) FOR UPDATE`,
      [spriteIds]
    );
    const changing = previous.rows.filter((row) => (row.editorial_status || (row.is_released === false ? "draft" : "published")) !== status);
    if (!changing.length) return [];
    const ids = changing.map((row) => row.id);
    const result = await client.query(
      `UPDATE sprites SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3
       WHERE id = ANY($1::text[]) RETURNING id`,
      [ids, status, status === "published"]
    );
    for (const row of changing) {
      const before = row.editorial_status || (row.is_released === false ? "draft" : "published");
      await client.query(
        `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
         VALUES ('sprite', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
        [row.id, JSON.stringify(before), JSON.stringify(status), adminActorFromReq(req), reason]
      );
    }
    return result.rows.map((row) => row.id);
  }, (ids) => ({ actor: adminActorFromReq(req), action: "catalog.bulk_workflow", targetType: "catalog", targetId: "bulk", justification: reason, details: { requested: spriteIds.length, updated: ids.length, spriteIds: ids, status, reversiblePerSprite: true } }));
  syncCatalogueMetaAndFanout().catch(error => console.error("[admin] bulk catalog workflow fanout:", error.message));
  res.json({ ok: true, requested: spriteIds.length, updated: updated.length, ids: updated });
}));

app.post("/api/admin/catalog/:spriteId/workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const editorialStatus = text(req.body?.editorialStatus, 20);
  const reason = text(req.body?.reason, 1000);
  if (!EDITORIAL_STATUSES.has(editorialStatus) || !reason) return res.status(400).json({ error: "Statut éditorial et justification requis" });
  const sprite = await withAdminAudit(async (client) => {
    const previous = await client.query("SELECT editorial_status, is_released FROM sprites WHERE id = $1 FOR UPDATE", [req.params.spriteId]);
    if (!previous.rows.length) throw notFound("Sprite introuvable");
    const result = await client.query(
      `UPDATE sprites
       SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3
       WHERE id = $1 RETURNING id, name, editorial_status, editorial_updated_at, is_released`,
      [req.params.spriteId, editorialStatus, editorialStatus === "published"]
    );
    await client.query(
      `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
       VALUES ('sprite', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
      [req.params.spriteId, JSON.stringify(previous.rows[0].editorial_status || (previous.rows[0].is_released === false ? "draft" : "published")), JSON.stringify(editorialStatus), adminActorFromReq(req), reason]
    );
    return { sprite: result.rows[0], previous: previous.rows[0] };
  }, (result) => ({
    actor: adminActorFromReq(req), action: `catalog.workflow_${editorialStatus}`, targetType: "sprite", targetId: req.params.spriteId, justification: reason,
    details: { changes: { editorialStatus: { before: result.previous.editorial_status || (result.previous.is_released === false ? "draft" : "published"), after: editorialStatus }, isReleased: { before: result.previous.is_released, after: editorialStatus === "published" } } }
  }));
  if (editorialStatus === "published") syncCatalogueMetaAndFanout().catch(error => console.error("[admin] catalog publish fanout:", error.message));
  res.json({ ok: true, sprite: sprite.sprite });
}));

app.post("/api/admin/catalog/variants/:variantId/workflow", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const editorialStatus = text(req.body?.editorialStatus, 20);
  const reason = text(req.body?.reason, 1000);
  if (!EDITORIAL_STATUSES.has(editorialStatus) || !reason) return res.status(400).json({ error: "Statut éditorial et justification requis" });
  const variant = await withAdminAudit(async (client) => {
    const previous = await client.query("SELECT editorial_status, release_status FROM sprite_variants WHERE id = $1 FOR UPDATE", [req.params.variantId]);
    if (!previous.rows.length) throw notFound("Variante introuvable");
    const result = await client.query("UPDATE sprite_variants SET editorial_status = $2, editorial_updated_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING id, sprite_id, name, editorial_status, editorial_updated_at", [req.params.variantId, editorialStatus]);
    await client.query(`INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason)
                        VALUES ('variant', $1, 'editorialStatus', $2::jsonb, $3::jsonb, $4, $5)`,
      [req.params.variantId, JSON.stringify(previous.rows[0].editorial_status || "published"), JSON.stringify(editorialStatus), adminActorFromReq(req), reason]);
    return { variant: result.rows[0], before: previous.rows[0].editorial_status || "published" };
  }, (result) => ({ actor: adminActorFromReq(req), action: `catalog.variant_workflow_${editorialStatus}`, targetType: "variant", targetId: req.params.variantId, justification: reason, details: { changes: { editorialStatus: { before: result.before, after: editorialStatus } } } }));
  res.json({ ok: true, variant: variant.variant });
}));

app.post("/api/admin/catalog/:spriteId/history/:historyId/rollback", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const historyId = numberId(req.params.historyId);
  const reason = text(req.body?.reason, 1000);
  if (!historyId || !reason) return res.status(400).json({ error: "Historique et justification requis" });
  const rollback = await withAdminAudit(async (client) => {
    const history = await client.query(
      `SELECT id, field, previous_value, new_value FROM catalog_change_history
       WHERE id = $1 AND entity_type = 'sprite' AND entity_id = $2 FOR UPDATE`,
      [historyId, req.params.spriteId]
    );
    if (!history.rows.length) throw notFound("Version d’historique introuvable");
    const entry = history.rows[0];
    const isWorkflow = entry.field === "editorialStatus";
    const field = spriteEditableFields[entry.field];
    if (!field && !isWorkflow) throw new AdminHttpError(400, "Cette entrée ne peut pas être restaurée automatiquement");
    const current = await client.query(isWorkflow ? "SELECT editorial_status, is_released FROM sprites WHERE id = $1 FOR UPDATE" : `SELECT "${field.column}" FROM sprites WHERE id = $1 FOR UPDATE`, [req.params.spriteId]);
    if (!current.rows.length) throw notFound("Sprite introuvable");
    const restored = entry.previous_value;
    const result = await client.query(isWorkflow
      ? "UPDATE sprites SET editorial_status = $2, editorial_updated_at = NOW(), is_released = $3 WHERE id = $1 RETURNING *"
      : `UPDATE sprites SET "${field.column}" = $2 WHERE id = $1 RETURNING *`, isWorkflow ? [req.params.spriteId, restored, restored === "published"] : [req.params.spriteId, restored]);
    await client.query(
      `INSERT INTO catalog_change_history (entity_type, entity_id, field, previous_value, new_value, changed_by, reason, source_id)
       VALUES ('sprite', $1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)`,
      [req.params.spriteId, entry.field, JSON.stringify(isWorkflow ? (current.rows[0].editorial_status || (current.rows[0].is_released === false ? "draft" : "published")) : current.rows[0][field.column]), JSON.stringify(restored), adminActorFromReq(req), reason, String(entry.id)]
    );
    return { entry, sprite: result.rows[0], before: isWorkflow ? (current.rows[0].editorial_status || (current.rows[0].is_released === false ? "draft" : "published")) : current.rows[0][field.column], after: restored };
  }, (result) => ({
    actor: adminActorFromReq(req), action: "catalog.rollback", targetType: "sprite", targetId: req.params.spriteId, justification: reason,
    details: { sourceHistoryId: historyId, changes: { [result.entry.field]: { before: result.before, after: result.after } } }
  }));
  res.json({ ok: true, sprite: rollback.sprite, restoredHistoryId: historyId });
}));

app.post("/api/admin/catalog/:spriteId/availability", requireAdminCapability("catalog.write"), adminMutationLimiter, route(async (req, res) => {
  const body = jsonValue(req.body);
  const status = text(body.status, 20) || "unknown";
  const confidence = text(body.confidence, 20) || "unknown";
  const start = nullableDate(body.startDate);
  const end = nullableDate(body.endDate);
  if (!AVAILABILITY_STATUSES.has(status) || !CONFIDENCE_LEVELS.has(confidence) || start === undefined || end === undefined) {
    return res.status(400).json({ error: "Disponibilité invalide" });
  }
  if (start && end && new Date(start) > new Date(end)) return res.status(400).json({ error: "Les dates sont incohérentes" });
  const reason = text(body.reason, 1000);
  if (!reason) return res.status(400).json({ error: "Une justification est requise" });
  const exists = await pool.query("SELECT id FROM sprites WHERE id = $1", [req.params.spriteId]);
  if (!exists.rows.length) return res.status(404).json({ error: "Sprite introuvable" });
  const id = crypto.randomUUID();
  const availability = await withAdminAudit(async (client) => {
    const result = await client.query(
      `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       RETURNING *`,
      [id, req.params.spriteId, start, end, status, text(body.eventId, 100), confidence, text(body.dataStatus, 20) || "incomplete", JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])]
    );
    return result.rows[0];
  }, {
    actor: adminActorFromReq(req),
    action: "catalog.availability_created",
    targetType: "sprite",
    targetId: req.params.spriteId,
    justification: reason,
    details: { periodId: id, status, confidence }
  });
  res.status(201).json({ ok: true, availability });
}));

app.get("/api/admin/catalog-history", requireAdminCapability("catalog.read"), route(async (req, res) => {
  const { page, pageSize, offset } = pagination(req);
  const entityId = text(req.query.entityId, 100);
  const values = [];
  const where = [];
  if (entityId) { values.push(entityId); where.push(`entity_id = $${values.length}`); }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  values.push(pageSize, offset);
  const [list, count] = await Promise.all([
    pool.query(`SELECT id, entity_type, entity_id, field, previous_value, new_value, changed_by, changed_at, reason, source_id
                FROM catalog_change_history ${clause} ORDER BY changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values),
    pool.query(`SELECT COUNT(*)::int AS count FROM catalog_change_history ${clause}`, values.slice(0, -2))
  ]);
  res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
}));

