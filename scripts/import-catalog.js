require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const { validateCatalog, formatReport } = require("./validate-catalog");

const CATALOG_PATH = process.argv[2] || path.join(__dirname, "..", "SpriteDex Catalogue Juil 18 2026.json");

function shouldUseSSL(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/.test(url)) return false;
  if (process.env.PGSSL === "disable") return false;
  return true;
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432 });

const raw = fs.readFileSync(CATALOG_PATH, "utf8");
const catalog = JSON.parse(raw);

const RARITY_COLORS = {
  common: "rgba(168, 168, 168, 0.42)",
  uncommon: "rgba(88, 179, 71, 0.42)",
  rare: "rgba(36, 167, 255, 0.42)",
  epic: "rgba(196, 67, 255, 0.42)",
  legendary: "rgba(255, 165, 0, 0.42)",
  mythic: "rgba(255, 215, 0, 0.42)",
};

function defaultColor(rarity) {
  return RARITY_COLORS[(rarity || "").toLowerCase()] || "rgba(128, 128, 128, 0.42)";
}

function titleCaseVariant(type) {
  if (!type) return "Base";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

const HONEST_AVAILABILITY_STATUSES = new Set(["available", "upcoming", "ended", "not_observed", "unknown"]);

function normalizeAvailabilityStatus(status, startDate, endDate) {
  const s = (status || "").toLowerCase();
  if (HONEST_AVAILABILITY_STATUSES.has(s)) return s;

  const now = new Date().toISOString();
  const start = startDate ? new Date(startDate).toISOString() : null;
  const end = endDate ? new Date(endDate).toISOString() : null;

  if (s === "available" || s === "active" || s === "live") {
    if (end && end < now) return "ended";
    return "available";
  }
  if (s === "unreleased" || s === "coming_soon" || s === "soon") {
    if (start && start > now) return "upcoming";
    return "unknown";
  }
  if (s === "unavailable" || s === "inactive" || s === "discontinued" || s === "expired" || s === "removed" || s === "over") {
    if (end && end < now) return "ended";
    return "not_observed";
  }
  if (s === "not_observed" || s === "missing" || s === "not_seen") return "not_observed";

  if (end && end < now) return "ended";
  if (start && start > now) return "upcoming";
  return "unknown";
}

function normalizeAvailability(availability) {
  const a = availability || {};
  return {
    ...a,
    status: normalizeAvailabilityStatus(a.status, a.startDate, a.endDate),
  };
}

const RECURRENCE_STATUSES = new Set(["confirmed_recurring", "possible_return", "not_confirmed", "unknown"]);

function normalizeRecurrenceStatus(status) {
  const s = (status || "").toLowerCase().replace(/\s+/g, "_");
  if (RECURRENCE_STATUSES.has(s)) return s;
  if (s.includes("recurring") || s.includes("confirmed_return") || s === "yes") return "confirmed_recurring";
  if (s.includes("possible") || s.includes("maybe") || s.includes("return")) return "possible_return";
  if (s.includes("never") || s.includes("not_confirmed") || s.includes("no_return") || s.includes("exclusive")) return "not_confirmed";
  return "unknown";
}

function buildRecurrence(recurrence) {
  if (recurrence && typeof recurrence === "object" && !Array.isArray(recurrence)) {
    const status = normalizeRecurrenceStatus(recurrence.status);
    return {
      status,
      officiallyConfirmed: recurrence.officiallyConfirmed ?? (status === "confirmed_recurring"),
      evidence: recurrence.evidence || null,
    };
  }
  const status = normalizeRecurrenceStatus(recurrence);
  return {
    status,
    officiallyConfirmed: status === "confirmed_recurring",
    evidence: null,
  };
}

function buildDates(dates, firstObservedAt, lastVerifiedAt, officiallyAnnouncedAt) {
  if (dates && typeof dates === "object" && !Array.isArray(dates)) {
    return {
      firstObservedAt: dates.firstObservedAt || firstObservedAt || null,
      officiallyAnnouncedAt: dates.officiallyAnnouncedAt || officiallyAnnouncedAt || null,
      lastVerifiedAt: dates.lastVerifiedAt || lastVerifiedAt || null,
    };
  }
  return {
    firstObservedAt: firstObservedAt || null,
    officiallyAnnouncedAt: officiallyAnnouncedAt || null,
    lastVerifiedAt: lastVerifiedAt || null,
  };
}

const VALID_DATA_STATUSES = new Set(["complete", "incomplete", "needs_review", "unverified", "disputed", "archived"]);

function normalizeDataStatus(status, missingFields = []) {
  let s = (status || "").toLowerCase();
  if (!VALID_DATA_STATUSES.has(s)) {
    if (s === "confirmed") s = "complete";
    else if (s === "observed") s = "unverified";
    else if (s === "legacy") s = "archived";
    else if (missingFields.length > 0) s = "incomplete";
    else s = "complete";
  }
  if (s === "complete" && missingFields.length > 0) s = "incomplete";
  return s;
}

function computeMissingFields(sprite) {
  const missing = [];
  const a = sprite.acquisition || {};
  const av = sprite.availability || {};
  const r = sprite.recurrence || {};
  const d = sprite.dates || {};

  if (!sprite.officialName) missing.push("officialName");
  if (!sprite.seasonId) missing.push("seasonId");
  if (!sprite.image) missing.push("image");
  if (a.type === "unknown") missing.push("acquisitionMethod.type");
  if (!a.description) missing.push("acquisitionMethod.description");
  if (av.status === "unknown") missing.push("availability.status");
  if (!av.startDate && av.status !== "unknown" && av.status !== "upcoming") missing.push("availability.startDate");
  if (av.status === "ended" && !av.endDate) missing.push("availability.endDate");
  if (r.status === "unknown") missing.push("recurrence.status");
  if (!d.firstObservedAt) missing.push("dates.firstObservedAt");
  if (!d.lastVerifiedAt) missing.push("dates.lastVerifiedAt");
  if (!d.officiallyAnnouncedAt) missing.push("dates.officiallyAnnouncedAt");
  if (!Array.isArray(sprite.sources) || sprite.sources.length === 0) missing.push("sources");
  if (!Array.isArray(sprite.availabilityPeriods) || sprite.availabilityPeriods.length === 0) missing.push("availabilityPeriods");

  return missing;
}

async function upsertAvailabilityPeriod(client, spriteId, availability, eventId, sourceIds) {
  if (!availability || (!availability.startDate && !availability.endDate)) return;
  const startDate = availability.startDate || null;
  const endDate = availability.endDate || null;
  const eventKey = eventId || "";
  const periodId = "availability_" + crypto.createHash("md5").update(`${spriteId}|${startDate || "unknown"}|${eventKey}`).digest("hex").slice(0, 16);
  const status = normalizeAvailabilityStatus(availability.status, startDate, endDate);

  await client.query(
    `INSERT INTO availability_periods (id, sprite_id, start_date, end_date, status, event_id, confidence, data_status, sources)
     VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       sprite_id = $2,
       start_date = $3::timestamptz,
       end_date = COALESCE($4::timestamptz, availability_periods.end_date),
       status = COALESCE($5, availability_periods.status),
       event_id = $6,
       confidence = COALESCE($7, availability_periods.confidence),
       data_status = COALESCE($8, availability_periods.data_status),
       sources = COALESCE($9, availability_periods.sources)`,
    [
      periodId,
      spriteId,
      startDate,
      endDate,
      status,
      eventId || null,
      availability.confidence || "unknown",
      startDate ? "complete" : "incomplete",
      JSON.stringify(sourceIds || []),
    ]
  );
}

async function ensureSchema() {
  await pool.query(`
    ALTER TABLE sprites
    ADD COLUMN IF NOT EXISTS catalog_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS slug VARCHAR(50),
    ADD COLUMN IF NOT EXISTS official_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS season_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS event_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS image VARCHAR(255),
    ADD COLUMN IF NOT EXISTS introduced_in_update VARCHAR(20),
    ADD COLUMN IF NOT EXISTS first_observed_at DATE,
    ADD COLUMN IF NOT EXISTS last_verified_at DATE,
    ADD COLUMN IF NOT EXISTS officially_announced_at DATE,
    ADD COLUMN IF NOT EXISTS ability JSONB,
    ADD COLUMN IF NOT EXISTS acquisition JSONB,
    ADD COLUMN IF NOT EXISTS availability JSONB,
    ADD COLUMN IF NOT EXISTS recurrence JSONB,
    ADD COLUMN IF NOT EXISTS dates JSONB,
    ADD COLUMN IF NOT EXISTS missing_fields JSONB,
    ADD COLUMN IF NOT EXISTS base_summon_cost INTEGER,
    ADD COLUMN IF NOT EXISTS data_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS notes JSONB,
    ADD COLUMN IF NOT EXISTS sources JSONB,
    ADD COLUMN IF NOT EXISTS catalog_version VARCHAR(32),
    ADD COLUMN IF NOT EXISTS catalog_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_released BOOLEAN DEFAULT TRUE;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprite_variants (
      id VARCHAR(100) PRIMARY KEY,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      variant_type VARCHAR(30) NOT NULL,
      name VARCHAR(100) NOT NULL,
      official_name VARCHAR(100),
      slug VARCHAR(100),
      rarity VARCHAR(30),
      release_status VARCHAR(20),
      first_observed_at DATE,
      summon_cost INTEGER,
      sprite_chest_drop_chance_pct NUMERIC,
      extra_effect_ref VARCHAR(50),
      effect JSONB,
      acquisition JSONB,
      image_path VARCHAR(255),
      suggested_image_path VARCHAR(255),
      availability JSONB,
      data_status VARCHAR(20),
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (sprite_id, variant_type)
    );
    CREATE INDEX IF NOT EXISTS idx_sprite_variants_sprite ON sprite_variants(sprite_id);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS official_name VARCHAR(100);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS rarity VARCHAR(30);
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS effect JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS acquisition JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS recurrence JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS dates JSONB;
    ALTER TABLE sprite_variants ADD COLUMN IF NOT EXISTS missing_fields JSONB;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seasons (
      id VARCHAR(50) PRIMARY KEY,
      chapter INTEGER,
      season INTEGER,
      name VARCHAR(100),
      name_en VARCHAR(100),
      start_date DATE,
      end_date DATE,
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_seasons_chapter ON seasons(chapter, season);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(100),
      type VARCHAR(50),
      season_id VARCHAR(50),
      start_date DATE,
      end_date DATE,
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_season ON events(season_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS availability_periods (
      id VARCHAR(100) PRIMARY KEY,
      sprite_id VARCHAR(50) NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
      start_date TIMESTAMPTZ,
      end_date TIMESTAMPTZ,
      status VARCHAR(20) DEFAULT 'unknown',
      event_id VARCHAR(100),
      confidence VARCHAR(20) DEFAULT 'unknown',
      data_status VARCHAR(20) DEFAULT 'incomplete',
      sources JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (sprite_id, start_date, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_availability_periods_sprite ON availability_periods(sprite_id);
    CREATE INDEX IF NOT EXISTS idx_availability_periods_dates ON availability_periods(start_date, end_date);
  `);
  await pool.query(`
    ALTER TABLE availability_periods ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'unknown';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sprite_sources (
      id VARCHAR(100) PRIMARY KEY,
      type VARCHAR(30),
      publisher VARCHAR(100),
      title TEXT,
      url TEXT,
      published_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      last_verified_at TIMESTAMPTZ,
      reliability VARCHAR(20),
      catalog_version VARCHAR(32),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE sprite_sources
      ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  `);
}

async function importCatalog() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const version = catalog.catalogueVersion;
    const generatedAt = catalog.generatedAt;

    // Build variant type effect map for per-variant effect data
    const variantEffectMap = {};
    for (const vd of catalog.variantDefinitions || []) {
      const key = vd.id.replace("variant_type_", "");
      variantEffectMap[key] = vd.extraEffect || null;
    }

    // Fetch existing colors so we don't overwrite them with defaults
    const existingSpritesRes = await client.query("SELECT id, color FROM sprites");
    const existingColors = {};
    for (const row of existingSpritesRes.rows) existingColors[row.id] = row.color;

    // 1. Import sources
    for (const src of catalog.sources || []) {
      await client.query(
        `INSERT INTO sprite_sources (id, type, publisher, title, url, published_at, observed_at, last_verified_at, reliability, catalog_version, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, $10, NOW())
         ON CONFLICT (id) DO UPDATE SET
           type = $2, publisher = $3, title = $4, url = $5,
           published_at = $6::timestamptz, observed_at = $7::timestamptz, last_verified_at = $8::timestamptz,
           reliability = $9, catalog_version = $10, updated_at = NOW()`,
        [
          src.id,
          src.type,
          src.publisher,
          src.title,
          src.url,
          src.publishedAt,
          src.observedAt,
          src.lastVerifiedAt,
          src.reliability,
          version,
        ]
      );
    }

    // 1b. Import seasons
    const catalogSeason = catalog.season;
    if (catalogSeason && catalogSeason.id) {
      await client.query(
        `INSERT INTO seasons (id, chapter, season, name, name_en, start_date, end_date, data_status, sources)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           chapter = $2, season = $3, name = $4, name_en = $5, start_date = $6, end_date = $7, data_status = $8, sources = $9`,
        [
          catalogSeason.id,
          catalogSeason.chapter,
          catalogSeason.season,
          catalogSeason.nameFr || catalogSeason.nameEn || null,
          catalogSeason.nameEn || null,
          catalogSeason.startDate,
          catalogSeason.endDate,
          catalogSeason.statusAsOfCatalogueDate || "incomplete",
          JSON.stringify(catalogSeason.sourceIds || []),
        ]
      );
    }

    // Ensure any seasonId referenced by sprites exists
    const referencedSeasonIds = new Set();
    for (const s of catalog.sprites || []) {
      if (s.seasonId) referencedSeasonIds.add(s.seasonId);
    }
    for (const s of catalog.unreleasedContent?.baseSprites || []) {
      if (s.seasonId) referencedSeasonIds.add(s.seasonId);
    }
    for (const seasonId of referencedSeasonIds) {
      await client.query(
        `INSERT INTO seasons (id, data_status) VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [seasonId, "incomplete"]
      );
    }

    // 2. Import released sprites
    for (const s of catalog.sprites) {
      const stableId = s.id;
      const variantsArr = s.variants.map((v) => titleCaseVariant(v.variantType));
      const color = s.color || existingColors[stableId] || defaultColor(s.rarity);

      const abilityDesc = s.ability?.descriptionFr || s.ability?.descriptionEn || "";
      const baseVariant = s.variants.find((v) => v.variantType === "base") || s.variants[0];
      const spriteImage = s.image || (baseVariant && (baseVariant.imagePath || baseVariant.suggestedImagePath)) || null;

      await client.query(
        `INSERT INTO sprites (
          id, name, rarity, color, effect, variants, available, added_date,
          catalog_id, slug, official_name, season_id, event_id, image, introduced_in_update,
          first_observed_at, last_verified_at, ability, acquisition, availability,
          base_summon_cost, data_status, notes, sources, catalog_version, catalog_generated_at, is_released
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26, $27
        )
        ON CONFLICT (id) DO UPDATE SET
          name = $2, rarity = $3, color = $4, effect = $5, variants = $6, available = $7, added_date = $8,
          catalog_id = $9, slug = $10, official_name = $11, season_id = $12, event_id = $13, image = $14, introduced_in_update = $15,
          first_observed_at = $16, last_verified_at = $17, ability = $18, acquisition = $19, availability = $20,
          base_summon_cost = $21, data_status = $22, notes = $23, sources = $24,
          catalog_version = $25, catalog_generated_at = $26, is_released = $27`,
        [
          stableId,
          s.name,
          s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1),
          color,
          abilityDesc,
          variantsArr,
          normalizeAvailabilityStatus(s.availability?.status, s.availability?.startDate, s.availability?.endDate),
          s.firstObservedAt,
          s.id,
          s.slug,
          s.officialName,
          s.seasonId,
          s.eventId,
          spriteImage,
          s.introducedInUpdate,
          s.firstObservedAt,
          s.lastVerifiedAt,
          JSON.stringify(s.ability || {}),
          JSON.stringify(s.acquisition || {}),
          JSON.stringify(normalizeAvailability(s.availability) || {}),
          s.baseSummonCostSpriteDust,
          s.dataStatus,
          JSON.stringify(s.notes || []),
          JSON.stringify(s.sourceIds || []),
          version,
          generatedAt,
          true,
        ]
      );

      await client.query(
        `UPDATE sprites SET recurrence = $1 WHERE id = $2`,
        [JSON.stringify(buildRecurrence(s.recurrence || s.availability?.recurrence)), stableId]
      );

      const dates = buildDates(s.dates, s.firstObservedAt, s.lastVerifiedAt, s.officiallyAnnouncedAt);
      await client.query(
        `UPDATE sprites SET dates = $1, first_observed_at = $2, last_verified_at = $3, officially_announced_at = $4 WHERE id = $5`,
        [JSON.stringify(dates), dates.firstObservedAt, dates.lastVerifiedAt, dates.officiallyAnnouncedAt, stableId]
      );

      // 2b. Track availability period
      await upsertAvailabilityPeriod(client, stableId, normalizeAvailability(s.availability), s.eventId, s.sourceIds);

      const spriteForMissing = {
        officialName: s.officialName,
        seasonId: s.seasonId,
        image: spriteImage,
        acquisition: s.acquisition || {},
        availability: normalizeAvailability(s.availability),
        recurrence: buildRecurrence(s.recurrence || s.availability?.recurrence),
        dates,
        sources: s.sourceIds || [],
        availabilityPeriods: (s.availability?.startDate || s.availability?.endDate) ? [{}] : []
      };
      const missingFields = computeMissingFields(spriteForMissing);
      const dataStatus = normalizeDataStatus(s.dataStatus, missingFields);
      await client.query(
        `UPDATE sprites SET missing_fields = $1, data_status = $2 WHERE id = $3`,
        [JSON.stringify(missingFields), dataStatus, stableId]
      );

      // 3. Import variants and images
      for (const v of s.variants) {
        const variantName = titleCaseVariant(v.variantType);
        const imagePath = v.imagePath || v.suggestedImagePath || null;
        const rarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
        const effect = variantEffectMap[v.variantType] || variantEffectMap[variantName.toLowerCase()] || null;

        await client.query(
          `INSERT INTO sprite_variants (
            id, sprite_id, variant_type, name, official_name, slug, rarity, release_status, first_observed_at,
            summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref, effect, acquisition,
            image_path, suggested_image_path, availability, data_status, sources
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
          ON CONFLICT (sprite_id, variant_type) DO UPDATE SET
            id = $1, name = $4, official_name = $5, slug = $6, rarity = $7, release_status = $8, first_observed_at = $9,
            summon_cost = $10, sprite_chest_drop_chance_pct = $11, extra_effect_ref = $12, effect = $13, acquisition = $14,
            image_path = $15, suggested_image_path = $16, availability = $17, data_status = $18, sources = $19`,
          [
            v.id,
            stableId,
            variantName,
            v.name,
            v.officialName || v.name,
            v.slug,
            rarity,
            v.releaseStatus,
            v.firstObservedAt,
            v.summonCostSpriteDust,
            v.spriteChestDropChancePct,
            v.extraEffectRef,
            JSON.stringify(effect || {}),
            JSON.stringify(s.acquisition || {}),
            v.imagePath,
            v.suggestedImagePath,
            JSON.stringify(normalizeAvailability(v.availability) || {}),
            v.dataStatus,
            JSON.stringify(v.sourceIds || []),
          ]
        );

        await client.query(
          `UPDATE sprite_variants SET recurrence = $1 WHERE id = $2`,
          [JSON.stringify(buildRecurrence(v.recurrence || v.availability?.recurrence)), v.id]
        );

        const variantForMissing = {
          officialName: v.officialName || v.name,
          seasonId: s.seasonId,
          image: v.imagePath || v.suggestedImagePath,
          acquisition: s.acquisition || {},
          availability: normalizeAvailability(v.availability),
          recurrence: buildRecurrence(v.recurrence || v.availability?.recurrence),
          dates: buildDates(null, v.firstObservedAt, null, null),
          sources: v.sourceIds || [],
          availabilityPeriods: []
        };
        const variantMissingFields = computeMissingFields(variantForMissing);
        const variantDataStatus = normalizeDataStatus(v.dataStatus, variantMissingFields);
        await client.query(
          `UPDATE sprite_variants SET missing_fields = $1, data_status = $2 WHERE id = $3`,
          [JSON.stringify(variantMissingFields), variantDataStatus, v.id]
        );

        // Upsert sprite_images: prefer existing disk path if it exists, otherwise catalog suggested path
        const finalImagePath = imagePath;
        await client.query(
          `INSERT INTO sprite_images (sprite_id, variant, image_path)
           VALUES ($1, $2, $3)
           ON CONFLICT (sprite_id, variant) DO UPDATE SET image_path = $3`,
          [stableId, variantName, finalImagePath]
        );
      }
    }

    // 4. Import unreleased base sprites
    for (const s of catalog.unreleasedContent?.baseSprites || []) {
      const stableId = s.id;
      const unreleasedImage = s.image || null;

      await client.query(
        `INSERT INTO sprites (
          id, name, rarity, color, effect, variants, available, added_date,
          catalog_id, slug, official_name, season_id, event_id, image, introduced_in_update,
          first_observed_at, last_verified_at, ability, acquisition, availability,
          base_summon_cost, data_status, notes, sources, catalog_version, catalog_generated_at, is_released
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21,
          $22, $23, $24, $25, $26, FALSE
        )
        ON CONFLICT (id) DO UPDATE SET
          name = $2, rarity = $3, color = $4, effect = $5, variants = $6, available = $7, added_date = $8,
          catalog_id = $9, slug = $10, official_name = $11, season_id = $12, event_id = $13, image = $14, introduced_in_update = $15,
          first_observed_at = $16, last_verified_at = $17, ability = $18, acquisition = $19, availability = $20,
          base_summon_cost = $21, data_status = $22, notes = $23, sources = $24,
          catalog_version = $25, catalog_generated_at = $26, is_released = FALSE`,
        [
          stableId,
          s.name,
          s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1),
          s.color || existingColors[stableId] || defaultColor(s.rarity),
          s.ability?.descriptionFr || s.ability?.descriptionEn || "",
          [],
          normalizeAvailabilityStatus(s.availability?.status, s.availability?.startDate, s.availability?.endDate),
          s.firstObservedAt || null,
          s.id,
          s.slug,
          s.officialName,
          s.seasonId,
          s.eventId,
          unreleasedImage,
          s.introducedInUpdate,
          s.firstObservedAt,
          s.lastVerifiedAt,
          JSON.stringify(s.ability || {}),
          JSON.stringify(s.acquisition || {}),
          JSON.stringify(normalizeAvailability(s.availability) || {}),
          s.baseSummonCostSpriteDust,
          s.dataStatus,
          JSON.stringify(s.notes || []),
          JSON.stringify(s.sourceIds || []),
          version,
          generatedAt,
        ]
      );

      await client.query(
        `UPDATE sprites SET recurrence = $1 WHERE id = $2`,
        [JSON.stringify(buildRecurrence(s.recurrence || s.availability?.recurrence)), stableId]
      );

      const unreleasedDates = buildDates(s.dates, s.firstObservedAt, s.lastVerifiedAt, s.officiallyAnnouncedAt);
      await client.query(
        `UPDATE sprites SET dates = $1, first_observed_at = $2, last_verified_at = $3, officially_announced_at = $4 WHERE id = $5`,
        [JSON.stringify(unreleasedDates), unreleasedDates.firstObservedAt, unreleasedDates.lastVerifiedAt, unreleasedDates.officiallyAnnouncedAt, stableId]
      );

      await upsertAvailabilityPeriod(client, stableId, normalizeAvailability(s.availability), s.eventId, s.sourceIds);

      const unreleasedSpriteForMissing = {
        officialName: s.officialName,
        seasonId: s.seasonId,
        image: unreleasedImage,
        acquisition: s.acquisition || {},
        availability: normalizeAvailability(s.availability),
        recurrence: buildRecurrence(s.recurrence || s.availability?.recurrence),
        dates: unreleasedDates,
        sources: s.sourceIds || [],
        availabilityPeriods: (s.availability?.startDate || s.availability?.endDate) ? [{}] : []
      };
      const unreleasedMissingFields = computeMissingFields(unreleasedSpriteForMissing);
      const unreleasedDataStatus = normalizeDataStatus(s.dataStatus, unreleasedMissingFields);
      await client.query(
        `UPDATE sprites SET missing_fields = $1, data_status = $2 WHERE id = $3`,
        [JSON.stringify(unreleasedMissingFields), unreleasedDataStatus, stableId]
      );
    }

    // 5. Ensure variant_meta has all variant definitions
    for (const vd of catalog.variantDefinitions) {
      const name = titleCaseVariant(vd.id.replace("variant_type_", ""));
      const bonusText = vd.extraEffect
        ? (vd.extraEffect.descriptionFr || vd.extraEffect.descriptionEn || JSON.stringify(vd.extraEffect))
        : "Pouvoir normal du sprite.";
      await client.query(
        `INSERT INTO variant_meta (name, label, bonus) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET label = $2, bonus = $3`,
        [name, vd.nameFr || name, bonusText]
      );
    }

    // 6. Associate sprite_entries with catalog sprite/variant
    // sprite_entries.sprite_id format is "<base>::<variant>" (e.g. sprite_water::Base or legacy water::Base).
    // We resolve the base by stable id or slug, then make sure the variant exists.
    const entriesRes = await client.query(`SELECT DISTINCT sprite_id FROM sprite_entries`);
    for (const row of entriesRes.rows) {
      const parts = row.sprite_id.split("::");
      if (parts.length !== 2) continue;
      const [baseOrSlug, variantName] = parts;
      const spriteRes = await client.query(
        `SELECT id, name, rarity FROM sprites WHERE id = $1 OR slug = $1 LIMIT 1`,
        [baseOrSlug]
      );
      if (spriteRes.rows.length === 0) {
        console.warn(`[ASSOC] No sprite found for entry ${row.sprite_id}`);
        continue;
      }
      const spriteId = spriteRes.rows[0].id;
      const variantCheck = await client.query(
        `SELECT 1 FROM sprite_variants WHERE sprite_id = $1 AND variant_type = $2`,
        [spriteId, variantName]
      );
      if (variantCheck.rows.length === 0) {
        // Legacy or unreleased variant referenced by existing user entries.
        // Create a placeholder variant row so the association remains valid.
        const spriteName = spriteRes.rows[0]?.name || spriteId;
        const spriteRarity = spriteRes.rows[0]?.rarity || null;
        const placeholderId = `legacy_${spriteId}_${variantName}`;
        const variantTypeKey = variantName.toLowerCase();
        const effect = variantEffectMap[variantTypeKey] || null;
        await client.query(
          `INSERT INTO sprite_variants (
            id, sprite_id, variant_type, name, official_name, slug, rarity, release_status,
            summon_cost, sprite_chest_drop_chance_pct, extra_effect_ref, effect, acquisition,
            image_path, suggested_image_path, availability, data_status, sources
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
          ON CONFLICT (sprite_id, variant_type) DO UPDATE SET
            name = $4, official_name = $5, slug = $6, rarity = $7, release_status = $8,
            effect = $12, data_status = $17`,
          [
            placeholderId,
            spriteId,
            variantName,
            `${spriteName} ${variantName}`,
            `${spriteName} ${variantName}`,
            `${spriteId}-${variantName.toLowerCase()}`,
            spriteRarity,
            "unreleased",
            null,
            null,
            null,
            JSON.stringify(effect || {}),
            JSON.stringify({}),
            null,
            null,
            JSON.stringify({ status: "unknown", startDate: null, endDate: null, recurrence: "unknown" }),
            "legacy",
            JSON.stringify(["legacy_user_entry"]),
          ]
        );
        console.log(`[ASSOC] Created placeholder variant for ${row.sprite_id}`);
      }
    }

    await client.query("COMMIT");
    console.log(`[IMPORT] Catalog ${version} imported successfully.`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[IMPORT] Failed:", err);
    throw err;
  } finally {
    client.release();
  }
}

(async () => {
  try {
    // Étape 17 — Validation automatique avant publication.
    // Les erreurs (identifiants en double, statuts non autorisés, etc.) bloquent
    // l'import ; les avertissements (informations inconnues) sont tolérés.
    const validation = validateCatalog(catalog);
    console.log(formatReport(validation));
    if (validation.errors.length > 0 && !process.argv.includes("--skip-validation")) {
      console.error("\n[IMPORT] Import annulé : le catalogue contient des erreurs bloquantes.");
      console.error("[IMPORT] Corrigez-les puis relancez (ou forcez avec --skip-validation à vos risques).");
      process.exit(1);
    }

    await ensureSchema();
    await importCatalog();
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
