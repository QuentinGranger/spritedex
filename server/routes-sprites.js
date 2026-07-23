// routes-sprites.js — extracted from server.js

const { buildAcquisitionMethod, buildAvailability, buildDates, buildRecurrence, computeMissingFields, dedupeSpritesBySlug, normalizeDataStatus } = require("./catalog");
const { app } = require("./core");
const { pool } = require("./db");
const { classifyEventUrgency } = require("./compare");

// ── Sprites : données de référence ──
app.get("/api/sprites", async (req, res) => {
  try {
    const spritesResult = await pool.query(
      `SELECT id, name, rarity, color, effect, variants, available, added_date,
              slug, official_name, season_id, event_id, image,
              first_observed_at, last_verified_at, officially_announced_at,
              acquisition, availability, recurrence, dates, missing_fields, sources, data_status
       FROM sprites ORDER BY added_date, name`
    );
    const imagesResult = await pool.query(
      "SELECT sprite_id, variant, image_path FROM sprite_images"
    );
    const variantsResult = await pool.query(
      "SELECT name, label, bonus FROM variant_meta ORDER BY name"
    );
    const seasonsResult = await pool.query(
      "SELECT id, chapter, season, name, name_en, start_date, end_date, data_status, sources FROM seasons ORDER BY chapter, season"
    );
    const eventsResult = await pool.query(
      "SELECT id, name, type, season_id, start_date, end_date, data_status, sources FROM events ORDER BY start_date, name"
    );
    const availabilityPeriodsResult = await pool.query(
      `SELECT id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources
       FROM availability_periods ORDER BY sprite_id, start_date DESC`
    );
    const sourcesResult = await pool.query(
      "SELECT id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, catalog_version FROM sprite_sources"
    );
    const sourcesMap = {};
    for (const row of sourcesResult.rows) {
      sourcesMap[row.id] = {
        id: row.id,
        type: row.type,
        publisher: row.publisher,
        title: row.title,
        url: row.url,
        publishedAt: row.published_at,
        observedAt: row.observed_at,
        lastVerifiedAt: row.last_verified_at,
        reliability: row.reliability,
        catalogVersion: row.catalog_version,
      };
    }
    function buildSources(sourceIds) {
      const ids = Array.isArray(sourceIds) ? sourceIds : [];
      return ids.map(id => sourcesMap[id]).filter(Boolean);
    }

    const variantDetailsResult = await pool.query(
      `SELECT id, sprite_id, variant_type AS type, name, official_name, slug, rarity, release_status,
              summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref, effect, acquisition,
              first_observed_at, image_path, suggested_image_path, availability, recurrence, dates, missing_fields, data_status, sources
       FROM sprite_variants ORDER BY sprite_id, variant_type`
    );

    const images = {};
    for (const row of imagesResult.rows) {
      if (!images[row.sprite_id]) images[row.sprite_id] = {};
      images[row.sprite_id][row.variant] = row.image_path;
    }

    const variantDetails = {};
    for (const row of variantDetailsResult.rows) {
      if (!variantDetails[row.sprite_id]) variantDetails[row.sprite_id] = {};
      const effect = row.effect && Object.keys(row.effect).length ? row.effect : { type: "unknown" };
      const acquisition = buildAcquisitionMethod(row.acquisition);
      const availability = buildAvailability(row.availability);
      const recurrence = buildRecurrence(row.recurrence);
      const dates = buildDates(row.dates, row.first_observed_at, null, null);
      const missingFields = computeMissingFields({
        officialName: row.official_name || row.name,
        seasonId: null,
        image: row.image_path || row.suggested_image_path,
        acquisition,
        availability,
        recurrence,
        dates,
        sources: buildSources(row.sources),
        availabilityPeriods: [],
      });
      const dataStatus = normalizeDataStatus(row.data_status, missingFields);
      const confidence = availability.confidence || acquisition.confidence || dataStatus || "unknown";
      variantDetails[row.sprite_id][row.type] = {
        id: row.id,
        type: row.type,
        name: row.name,
        officialName: row.official_name || null,
        slug: row.slug,
        rarity: row.rarity || "unknown",
        releaseStatus: row.release_status || "unknown",
        summonCost: row.summon_cost,
        spriteChestDropChancePct: row.sprite_chest_drop_chance_pct,
        extraEffectRef: row.extra_effect_ref,
        effect,
        acquisition,
        availability,
        recurrence,
        dates,
        missingFields,
        dataStatus,
        confidence,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
        image: row.image_path || row.suggested_image_path || null,
      };
    }

    const spriteVariantIds = {};
    for (const spriteId of Object.keys(variantDetails)) {
      spriteVariantIds[spriteId] = Object.values(variantDetails[spriteId]).map(v => v.id);
    }

    const seasonsMap = {};
    for (const row of seasonsResult.rows) {
      seasonsMap[row.id] = {
        id: row.id,
        chapter: row.chapter,
        season: row.season,
        name: row.name,
        nameEn: row.name_en,
        startDate: row.start_date,
        endDate: row.end_date,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      };
    }

    const eventsMap = {};
    for (const row of eventsResult.rows) {
      eventsMap[row.id] = {
        id: row.id,
        name: row.name,
        type: row.type,
        seasonId: row.season_id,
        startDate: row.start_date,
        endDate: row.end_date,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      };
    }

    const availabilityPeriodsMap = {};
    for (const row of availabilityPeriodsResult.rows) {
      if (!availabilityPeriodsMap[row.sprite_id]) availabilityPeriodsMap[row.sprite_id] = [];
      availabilityPeriodsMap[row.sprite_id].push({
        id: row.id,
        spriteId: row.sprite_id,
        startDate: row.start_date,
        endDate: row.end_date,
        status: row.status,
        eventId: row.event_id,
        confidence: row.confidence,
        dataStatus: row.data_status,
        sourceIds: row.sources || [],
        sources: buildSources(row.sources),
      });
    }

    const sprites = spritesResult.rows.map(s => {
      const baseImage = (variantDetails[s.id] && variantDetails[s.id].Base && (variantDetails[s.id].Base.image || variantDetails[s.id].Base.suggestedImagePath)) || null;
      const acquisition = s.acquisition || {};
      const availability = buildAvailability(s.availability);
      const recurrence = buildRecurrence(s.recurrence);
      const dates = buildDates(s.dates, s.first_observed_at, s.last_verified_at, s.officially_announced_at);
      const missingFields = computeMissingFields({
        officialName: s.official_name || null,
        seasonId: s.season_id || null,
        image: s.image || baseImage,
        acquisition: buildAcquisitionMethod(acquisition),
        availability,
        recurrence,
        dates,
        sources: buildSources(s.sources),
        availabilityPeriods: availabilityPeriodsMap[s.id] || [],
      });
      const dataStatus = normalizeDataStatus(s.data_status, missingFields);
      const season = s.season_id ? seasonsMap[s.season_id] || null : null;
      const event = s.event_id ? eventsMap[s.event_id] || null : null;
      return {
        id: s.id,
        slug: s.slug || s.id.replace(/^sprite_/, "").replace(/_/g, "-"),
        name: s.name,
        officialName: s.official_name || null,
        image: s.image || baseImage,
        variantIds: spriteVariantIds[s.id] || [],
        seasonId: s.season_id || null,
        season,
        eventId: s.event_id || null,
        event,
        acquisitionMethod: buildAcquisitionMethod(acquisition),
        availability,
        availabilityPeriods: availabilityPeriodsMap[s.id] || [],
        recurrence,
        dates,
        missingFields,
        sourceIds: s.sources || [],
        sources: buildSources(s.sources),
        dataStatus,
        confidence: availability.confidence || acquisition.confidence || dataStatus || "unknown",
        // Backward-compatible fields
        rarity: s.rarity,
        color: s.color,
        effect: s.effect,
        variants: s.variants,
        images: images[s.id] || {},
        variantDetails: variantDetails[s.id] || {},
        available: availability.status,
        addedDate: s.added_date,
      };
    });

    // ── Dedupe sprites sharing the same slug ──────────────────────────────
    // Legacy data on some deployments contains two rows per sprite under two id
    // schemes (e.g. "water" from an older catalog import and "sprite_water" from
    // the seed). This collapses them into a single canonical entry (prefer the
    // "sprite_"-prefixed id) and backfills any missing/unknown fields from the
    // twin so the checklist/cards never show duplicates.
    const dedupedSprites = dedupeSpritesBySlug(sprites);

    res.json({
      sprites: dedupedSprites,
      seasons: Object.values(seasonsMap),
      events: Object.values(eventsMap),
      variantMeta: variantsResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Historique des modifications du catalogue (Étape 19) ──
// Liste les changements enregistrés (quoi, quand, pourquoi, par qui, source).
// Filtres optionnels : ?entityId=sprite_water, ?field=availability.status,
// ?limit=50&offset=0.
app.get("/api/catalog-history", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const conditions = [];
    const params = [];
    if (req.query.entityId) {
      params.push(req.query.entityId);
      conditions.push(`entity_id = $${params.length}`);
    }
    if (req.query.field) {
      params.push(req.query.field);
      conditions.push(`field = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    params.push(offset);
    const result = await pool.query(
      `SELECT id, entity_type, entity_id, field, previous_value, new_value,
              changed_by, changed_at, reason, source_id
       FROM catalog_change_history
       ${where}
       ORDER BY changed_at DESC, id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      history: result.rows.map(r => ({
        id: r.id,
        entityType: r.entity_type,
        entityId: r.entity_id,
        field: r.field,
        previousValue: r.previous_value,
        newValue: r.new_value,
        changedBy: r.changed_by,
        changedAt: r.changed_at,
        reason: r.reason,
        sourceId: r.source_id,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Community ownership : taux réel de possession par les collections actives SPRITNEX ──
app.get("/api/community-ownership", async (req, res) => {
  try {
    const totalResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE deleted_at IS NULL`
    );
    const totalActive = totalResult.rows[0]?.total || 0;

    const ownershipResult = await pool.query(
      `SELECT COALESCE(se.sprite_id, split_part(se.variant_id, '::', 1)) AS base_id,
              COUNT(DISTINCT se.user_id)::int AS owners
       FROM sprite_entries se
       JOIN users u ON u.id = se.user_id
       WHERE se.status = 'owned'
         AND u.deleted_at IS NULL
       GROUP BY base_id`
    );
    const ownershipMap = new Map(ownershipResult.rows.map(r => [r.base_id, r.owners]));

    const spritesResult = await pool.query(
      `SELECT id, name, rarity FROM sprites
       WHERE is_released IS DISTINCT FROM FALSE
       ORDER BY name`
    );

    const sprites = spritesResult.rows.map(s => {
      const owners = ownershipMap.get(s.id) || 0;
      const rate = totalActive > 0 ? owners / totalActive : 0;
      return {
        spriteId: s.id,
        name: s.name,
        rarity: s.rarity,
        owners,
        totalActive,
        ownershipRate: Number(rate.toFixed(6))
      };
    });

    res.json({ totalActive, sprites });
  } catch (err) {
    console.error("[community-ownership]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// ── Events : urgency levels with configurable thresholds ──
app.get("/api/events/urgency", async (req, res) => {
  try {
    const eventsResult = await pool.query(
      `SELECT id, name, type, start_date, end_date, season_id
       FROM events
       ORDER BY end_date NULLS LAST, start_date NULLS LAST, name`
    );

    const options = {
      endingTodayHours: Math.max(1, parseInt(req.query.endingTodayHours) || 24),
      urgentDays: Math.max(1, parseInt(req.query.urgentDays) || 7),
      soonDays: Math.max(1, parseInt(req.query.soonDays) || 14)
    };

    const events = eventsResult.rows.map(row => {
      const urgency = classifyEventUrgency(row.end_date, options);
      return {
        eventId: row.id,
        name: row.name,
        type: row.type,
        seasonId: row.season_id,
        startDate: row.start_date,
        endDate: row.end_date,
        level: urgency.level,
        daysRemaining: urgency.daysRemaining,
        hoursRemaining: urgency.hoursRemaining
      };
    });

    const levelOrder = { ending_today: 0, urgent: 1, soon: 2, normal: 3, ended: 4, unknown: 5 };
    events.sort((a, b) => {
      const ao = levelOrder[a.level] ?? 6;
      const bo = levelOrder[b.level] ?? 6;
      if (ao !== bo) return ao - bo;
      const ad = a.daysRemaining ?? Infinity;
      const bd = b.daysRemaining ?? Infinity;
      return ad - bd;
    });

    res.json({ events, options });
  } catch (err) {
    console.error("[/api/events/urgency]", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});
