"use strict";

const {
  crypto,
  app,
  pool,
  requireAdminCapability,
  requireAdminStepUp,
  adminActorFromReq,
  listActiveAdminSessions,
  describeAuthz,
  hasCapability,
  isAdminMfaConfigured,
  revokeUserSockets,
  invalidateSquadAnalysisCacheForUser,
  enqueuePassportRecalc,
  processDeliveryQueue,
  syncCatalogueMetaAndFanout,
  fanoutPublishedNews,
  buildUserDataExport,
  listDeletionQueue,
  purgeDeletedAccounts,
  retentionDays,
  restoreDeletedAccount,
  revokeActiveShareCapabilities,
  rateLimit,
  writeAdminAudit,
  withAdminAudit,
  AdminHttpError,
  notFound,
  adminMutationLimiter,
  PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_AUDIT_EXPORT_ROWS,
  REPORT_STATUSES,
  REPORT_PRIORITIES,
  APPEAL_STATUSES,
  NEWS_STATUSES,
  DATA_STATUSES,
  AVAILABILITY_STATUSES,
  CONFIDENCE_LEVELS,
  EDITORIAL_STATUSES,
  numberId,
  pagination,
  text,
  nullableDate,
  jsonValue,
  validUrl,
  validAssetUrl,
  audit,
  route,
  paged,
  safeAuditDetails,
  auditRowForAdmin,
  auditFilters,
  csvCell
} = require("./shared");

// ── 4. Events & editorial news ─────────────────────────────────────────────

app.get(
  "/api/admin/events",
  requireAdminCapability("events.read"),
  route(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const [list, count] = await Promise.all([
      pool.query(
        `SELECT e.id, e.name, e.type, e.season_id, e.start_date, e.end_date, e.data_status, e.sources, e.updated_at,
                       COUNT(ap.id)::int AS availability_count
                FROM events e LEFT JOIN availability_periods ap ON ap.event_id = e.id
                GROUP BY e.id ORDER BY e.end_date DESC NULLS LAST, e.updated_at DESC
                LIMIT $1 OFFSET $2`,
        [pageSize, offset]
      ),
      pool.query("SELECT COUNT(*)::int AS count FROM events")
    ]);
    res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
  })
);

app.post(
  "/api/admin/events",
  requireAdminCapability("events.write"),
  adminMutationLimiter,
  route(async (req, res) => {
    const body = jsonValue(req.body);
    const id = text(body.id, 100);
    const name = text(body.name, 100);
    const reason = text(body.reason, 1000);
    const start = nullableDate(body.startDate);
    const end = nullableDate(body.endDate);
    if (
      !id ||
      !/^[a-zA-Z0-9_-]+$/.test(id) ||
      !name ||
      !reason ||
      start === undefined ||
      end === undefined ||
      (start && end && new Date(start) > new Date(end))
    ) {
      return res.status(400).json({ error: "Événement et justification requis" });
    }
    const event = await withAdminAudit(
      async (client) => {
        const result = await client.query(
          `INSERT INTO events (id, name, type, season_id, start_date, end_date, data_status, sources, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW()) RETURNING *`,
          [
            id,
            name,
            text(body.type, 50),
            text(body.seasonId, 50),
            start,
            end,
            text(body.dataStatus, 20) || "incomplete",
            JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : [])
          ]
        );
        return result.rows[0];
      },
      {
        actor: adminActorFromReq(req),
        action: "event.created",
        targetType: "event",
        targetId: id,
        justification: reason,
        details: { name }
      }
    );
    res.status(201).json({ ok: true, event });
  })
);

app.post(
  "/api/admin/events/bulk-status",
  requireAdminCapability("events.write"),
  adminMutationLimiter,
  route(async (req, res) => {
    const eventIds = Array.isArray(req.body?.eventIds)
      ? [...new Set(req.body.eventIds.map((id) => text(id, 100)).filter(Boolean))].slice(0, 50)
      : [];
    const dataStatus = text(req.body?.dataStatus, 20);
    const reason = text(req.body?.reason, 1000);
    if (!eventIds.length || !DATA_STATUSES.has(dataStatus) || !reason)
      return res.status(400).json({ error: "Sélection, état et justification requis" });
    const updated = await withAdminAudit(
      async (client) => {
        const result = await client.query(
          `UPDATE events SET data_status = $2, updated_at = NOW() WHERE id = ANY($1::text[]) AND data_status IS DISTINCT FROM $2 RETURNING id`,
          [eventIds, dataStatus]
        );
        return result.rows.map((row) => row.id);
      },
      (ids) => ({
        actor: adminActorFromReq(req),
        action: "event.bulk_status",
        targetType: "event",
        targetId: "bulk",
        justification: reason,
        details: { requested: eventIds.length, updated: ids.length, eventIds: ids, dataStatus }
      })
    );
    res.json({ ok: true, requested: eventIds.length, updated: updated.length, ids: updated });
  })
);

app.patch(
  "/api/admin/events/:eventId",
  requireAdminCapability("events.write"),
  adminMutationLimiter,
  route(async (req, res) => {
    const body = jsonValue(req.body);
    const allowed = { name: "name", type: "type", seasonId: "season_id", dataStatus: "data_status" };
    const updates = [];
    for (const [key, column] of Object.entries(allowed))
      if (Object.prototype.hasOwnProperty.call(body, key))
        updates.push({ column, key, value: text(body[key], key === "name" ? 100 : 50) });
    for (const [key, column] of [
      ["startDate", "start_date"],
      ["endDate", "end_date"]
    ]) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const value = nullableDate(body[key]);
      if (value === undefined) return res.status(400).json({ error: "Date invalide" });
      updates.push({ column, key, value });
    }
    if (Object.prototype.hasOwnProperty.call(body, "sources"))
      updates.push({
        column: "sources",
        key: "sources",
        value: JSON.stringify(Array.isArray(body.sources) ? body.sources.slice(0, 10) : []),
        json: true
      });
    const reason = text(body.reason, 1000);
    if (!updates.length || !reason) return res.status(400).json({ error: "Modifications et justification requises" });
    const values = [req.params.eventId, ...updates.map((update) => update.value)];
    const set = updates
      .map((update, index) => `${update.column} = $${index + 2}${update.json ? "::jsonb" : ""}`)
      .join(", ");
    const auditedEvent = await withAdminAudit(
      async (client) => {
        const previous = await client.query(
          `SELECT ${updates.map((update) => `"${update.column}"`).join(", ")} FROM events WHERE id = $1 FOR UPDATE`,
          [req.params.eventId]
        );
        if (!previous.rows.length) throw notFound("Événement introuvable");
        const result = await client.query(
          `UPDATE events SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
          values
        );
        return {
          event: result.rows[0],
          changes: Object.fromEntries(
            updates.map((update) => [
              update.key,
              {
                before: previous.rows[0][update.column],
                after: update.json ? JSON.parse(update.value) : update.value
              }
            ])
          )
        };
      },
      (result) => ({
        actor: adminActorFromReq(req),
        action: "event.updated",
        targetType: "event",
        targetId: req.params.eventId,
        justification: reason,
        details: { fields: updates.map((update) => update.key), changes: result.changes }
      })
    );
    res.json({ ok: true, event: auditedEvent.event });
  })
);

app.get(
  "/api/admin/news",
  requireAdminCapability("events.read"),
  route(async (req, res) => {
    const { page, pageSize, offset } = pagination(req);
    const status = NEWS_STATUSES.has(String(req.query.status)) ? String(req.query.status) : null;
    const values = [];
    const where = status ? "WHERE status = $1" : "";
    if (status) values.push(status);
    values.push(pageSize, offset);
    const [list, count] = await Promise.all([
      pool.query(
        `SELECT id, source, title, description, image, link, news_date, status, published_at, updated_at, editor_note
                FROM sprite_news ${where} ORDER BY news_date DESC NULLS LAST, created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
        values
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM sprite_news ${where}`, status ? [status] : [])
    ]);
    res.json(paged(list.rows, count.rows[0]?.count, { page, pageSize }));
  })
);

app.post(
  "/api/admin/news",
  requireAdminCapability("events.write"),
  adminMutationLimiter,
  route(async (req, res) => {
    const body = jsonValue(req.body);
    const title = text(body.title, 300);
    const reason = text(body.reason, 1000);
    const link = validUrl(body.link);
    const status = NEWS_STATUSES.has(String(body.status)) ? String(body.status) : "draft";
    if (!title || !reason || (body.link && !link))
      return res.status(400).json({ error: "Actualité et justification requises" });
    const newsDate = nullableDate(body.newsDate);
    if (newsDate === undefined) return res.status(400).json({ error: "Date invalide" });
    const hash = crypto.createHash("md5").update(`admin:${title}:${Date.now()}:${crypto.randomUUID()}`).digest("hex");
    const news = await withAdminAudit(
      async (client) => {
        const result = await client.query(
          `INSERT INTO sprite_news (hash, source, title, description, image, link, news_date, status, published_at, editor_note, updated_at)
       VALUES ($1, 'backoffice', $2, $3, $4, $5, $6, $7,
               CASE WHEN $7 = 'published' THEN NOW() ELSE NULL END, $8, NOW()) RETURNING *`,
          [
            hash,
            title,
            text(body.description, 4000) || "",
            validUrl(body.image),
            link,
            newsDate || new Date().toISOString(),
            status,
            text(body.editorNote, 1000)
          ]
        );
        return result.rows[0];
      },
      (created) => ({
        actor: adminActorFromReq(req),
        action: "news.created",
        targetType: "news",
        targetId: created.id,
        justification: reason,
        details: { status, title }
      })
    );
    let fanout = null;
    if (news.status === "published") {
      try {
        fanout = await fanoutPublishedNews(news);
      } catch (error) {
        console.error("[admin] news fanout failed:", error.message);
      }
    }
    res.status(201).json({ ok: true, news, fanout });
  })
);

app.get(
  "/api/admin/news/:newsId",
  requireAdminCapability("events.read"),
  route(async (req, res) => {
    const id = numberId(req.params.newsId);
    if (!id) return res.status(400).json({ error: "Actualité invalide" });
    const result = await pool.query(
      `SELECT id, source, title, description, image, link, news_date, status, published_at, updated_at, editor_note, created_at
     FROM sprite_news WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Actualité introuvable" });
    res.json({ news: result.rows[0] });
  })
);

app.get(
  "/api/admin/events/:eventId",
  requireAdminCapability("events.read"),
  route(async (req, res) => {
    const result = await pool.query(
      `SELECT e.id, e.name, e.type, e.season_id, e.start_date, e.end_date, e.data_status, e.sources, e.updated_at,
            COUNT(ap.id)::int AS availability_count
     FROM events e
     LEFT JOIN availability_periods ap ON ap.event_id = e.id
     WHERE e.id = $1
     GROUP BY e.id`,
      [req.params.eventId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Événement introuvable" });
    res.json({ event: result.rows[0] });
  })
);

app.patch(
  "/api/admin/news/:newsId",
  requireAdminCapability("events.write"),
  adminMutationLimiter,
  route(async (req, res) => {
    const id = numberId(req.params.newsId);
    const body = jsonValue(req.body);
    if (!id) return res.status(400).json({ error: "Actualité invalide" });
    const existing = await pool.query("SELECT id, status FROM sprite_news WHERE id = $1", [id]);
    if (!existing.rows.length) return res.status(404).json({ error: "Actualité introuvable" });
    const previousStatus = existing.rows[0].status;
    const updates = [];
    for (const [key, column, limit] of [
      ["title", "title", 300],
      ["description", "description", 4000],
      ["editorNote", "editor_note", 1000]
    ]) {
      if (Object.prototype.hasOwnProperty.call(body, key))
        updates.push({ key, column, value: text(body[key], limit) || "" });
    }
    for (const [key, column] of [
      ["image", "image"],
      ["link", "link"]
    ]) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const value = validUrl(body[key]);
      if (body[key] && !value) return res.status(400).json({ error: "URL invalide" });
      updates.push({ key, column, value });
    }
    if (Object.prototype.hasOwnProperty.call(body, "newsDate")) {
      const value = nullableDate(body.newsDate);
      if (value === undefined) return res.status(400).json({ error: "Date invalide" });
      updates.push({ key: "newsDate", column: "news_date", value });
    }
    if (Object.prototype.hasOwnProperty.call(body, "status")) {
      if (!NEWS_STATUSES.has(body.status)) return res.status(400).json({ error: "Statut invalide" });
      updates.push({ key: "status", column: "status", value: body.status });
    }
    const reason = text(body.reason, 1000);
    if (!updates.length || !reason) return res.status(400).json({ error: "Modifications et justification requises" });
    const values = [id, ...updates.map((update) => update.value)];
    const set = updates.map((update, index) => `${update.column} = $${index + 2}`).join(", ");
    const statusUpdate = updates.some((update) => update.column === "status");
    values.push(statusUpdate ? updates.find((update) => update.column === "status").value : "");
    const publicationStatusIndex = values.length;
    const auditedNews = await withAdminAudit(
      async (client) => {
        const previous = await client.query(
          `SELECT ${updates.map((update) => `"${update.column}"`).join(", ")} FROM sprite_news WHERE id = $1 FOR UPDATE`,
          [id]
        );
        if (!previous.rows.length) throw notFound("Actualité introuvable");
        const result = await client.query(
          `UPDATE sprite_news SET ${set},
         published_at = CASE WHEN $${publicationStatusIndex} = 'published' AND published_at IS NULL THEN NOW() ELSE published_at END,
         updated_at = NOW() WHERE id = $1 RETURNING *`,
          values
        );
        return {
          news: result.rows[0],
          changes: Object.fromEntries(
            updates.map((update) => [
              update.key,
              {
                before: previous.rows[0][update.column],
                after: update.value
              }
            ])
          )
        };
      },
      (result) => ({
        actor: adminActorFromReq(req),
        action: "news.updated",
        targetType: "news",
        targetId: id,
        justification: reason,
        details: { fields: updates.map((update) => update.key), previousStatus, changes: result.changes }
      })
    );
    const news = auditedNews.news;
    let fanout = null;
    if (news.status === "published" && previousStatus !== "published") {
      try {
        fanout = await fanoutPublishedNews(news);
      } catch (error) {
        console.error("[admin] news fanout failed:", error.message);
      }
    }
    res.json({ ok: true, news, fanout });
  })
);
