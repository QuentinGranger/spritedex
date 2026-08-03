"use strict";

const { payloadColumns, REGISTRY_STATUSES } = require("./types");

const JSONB_COLUMNS = new Set([
  "ability",
  "acquisition",
  "availability",
  "recurrence",
  "dates",
  "missing_fields",
  "notes",
  "sources",
  "effect"
]);

function sqlValue(column, value) {
  if (value === undefined) return undefined;
  if (value !== null && JSONB_COLUMNS.has(column) && typeof value !== "string") {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Apply reduced registry state onto the sprites / sprite_variants projection row.
 */
async function applyProjection(client, state, { seq, contentHash }) {
  const table = state.entityType === "variant" ? "sprite_variants" : "sprites";
  const columns = payloadColumns(state.entityType);
  const fields = state.fields || {};

  const existing = await client.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [state.entityId]);

  const setParts = [];
  const values = [];
  for (const column of columns) {
    if (fields[column] === undefined) continue;
    values.push(sqlValue(column, fields[column]));
    setParts.push(`"${column}" = $${values.length}`);
  }
  values.push(seq, contentHash, state.status || REGISTRY_STATUSES.ACTIVE, state.entityId);
  const seqIdx = values.length - 3;
  const hashIdx = values.length - 2;
  const statusIdx = values.length - 1;
  const idIdx = values.length;

  if (existing.rows.length) {
    const extra = table === "sprite_variants" ? `, updated_at = NOW()` : "";
    await client.query(
      `UPDATE ${table}
       SET ${setParts.length ? `${setParts.join(", ")}, ` : ""}
           registry_seq = $${seqIdx},
           registry_hash = $${hashIdx},
           registry_status = $${statusIdx}
           ${extra}
       WHERE id = $${idIdx}`,
      values
    );
    return;
  }

  // Insert projection for genesis events.
  if (state.entityType === "sprite") {
    await insertSprite(client, state, seq, contentHash);
  } else {
    await insertVariant(client, state, seq, contentHash);
  }
}

async function insertSprite(client, state, seq, contentHash) {
  const f = state.fields;
  await client.query(
    `INSERT INTO sprites (
       id, name, rarity, color, effect, variants, available, added_date,
       slug, image, official_name, season_id, event_id, ability, acquisition,
       availability, recurrence, dates, missing_fields, data_status, sources,
       is_released, editorial_status, registry_seq, registry_hash, registry_status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb,
       $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21::jsonb,
       $22, $23, $24, $25, $26
     )`,
    [
      state.entityId,
      f.name || state.entityId,
      f.rarity || "unknown",
      f.color || "unknown",
      f.effect || "",
      f.variants || [],
      f.available || "available",
      f.added_date || null,
      f.slug || null,
      f.image || null,
      f.official_name || null,
      f.season_id || null,
      f.event_id || null,
      sqlValue("ability", f.ability ?? null),
      sqlValue("acquisition", f.acquisition ?? null),
      sqlValue("availability", f.availability ?? null),
      sqlValue("recurrence", f.recurrence ?? null),
      sqlValue("dates", f.dates ?? null),
      sqlValue("missing_fields", f.missing_fields ?? null),
      f.data_status || null,
      sqlValue("sources", f.sources ?? []),
      f.is_released !== false,
      f.editorial_status || "published",
      seq,
      contentHash,
      state.status || REGISTRY_STATUSES.ACTIVE
    ]
  );
}

async function insertVariant(client, state, seq, contentHash) {
  const f = state.fields;
  const spriteId = state.parentSpriteId || f.sprite_id;
  if (!spriteId) throw new Error("variant projection requires parent_sprite_id");
  await client.query(
    `INSERT INTO sprite_variants (
       id, sprite_id, variant_type, name, official_name, slug, rarity,
       release_status, image_path, suggested_image_path, effect, acquisition,
       availability, recurrence, dates, missing_fields, data_status, sources,
       editorial_status, registry_seq, registry_hash, registry_status
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11::jsonb, $12::jsonb,
       $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18::jsonb,
       $19, $20, $21, $22
     )`,
    [
      state.entityId,
      spriteId,
      f.variant_type || "base",
      f.name || state.entityId,
      f.official_name || null,
      f.slug || null,
      f.rarity || null,
      f.release_status || null,
      f.image_path || null,
      f.suggested_image_path || null,
      sqlValue("effect", f.effect ?? null),
      sqlValue("acquisition", f.acquisition ?? null),
      sqlValue("availability", f.availability ?? null),
      sqlValue("recurrence", f.recurrence ?? null),
      sqlValue("dates", f.dates ?? null),
      sqlValue("missing_fields", f.missing_fields ?? null),
      f.data_status || null,
      sqlValue("sources", f.sources ?? null),
      f.editorial_status || "published",
      seq,
      contentHash,
      state.status || REGISTRY_STATUSES.ACTIVE
    ]
  );
}

module.exports = { applyProjection, sqlValue };
