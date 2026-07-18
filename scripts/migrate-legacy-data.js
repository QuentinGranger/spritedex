require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function shouldUseSSL(url) {
  if (!url) return false;
  const hostname = new URL(url).hostname;
  return (
    url.includes("sslmode=require") ||
    url.includes("ssl=true") ||
    (!hostname.includes("localhost") && !hostname.endsWith(".local"))
  );
}

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    })
  : new Pool({ database: "spritedex", host: "localhost", port: 5432, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });

const MIGRATION_MAP = {
  "Water Sprite": "sprite_water",
  "Fire Sprite": "sprite_fire",
  "Air Sprite": "sprite_air",
  "Earth Sprite": "sprite_earth",
  "Duck Sprite": "sprite_duck",
  "Demon Sprite": "sprite_demon",
  "Fishy Sprite": "sprite_fishy",
  "Ghost Sprite": "sprite_ghost",
  "King Sprite": "sprite_king",
  "Grim Sprite": "sprite_grim",
  "Punk Sprite": "sprite_punk",
  "Pollo Sprite": "sprite_pollo",
  "Aura Sprite": "sprite_aura",
  "Seven Sprite": "sprite_seven",
  "Striker Sprite": "sprite_striker",
  "Vini Jr. Sprite": "sprite_vini_jr",
  "Batman Sprite": "sprite_batman",
  "John Wick Sprite": "sprite_john_wick",
  "Boss Sprite": "sprite_boss",
  "Dream Sprite": "sprite_dream",
  "Burnt Peanut": "sprite_burnt_peanut",
};

// Add flat variant mappings from the user's example pattern.
const FLAT_VARIANT_SUFFIXES = ["Base", "Holofoil", "Holo", "Galaxy", "Gold", "Gummy", "Gem", "Rift"];

const STATUS_WEIGHT = {
  owned: 100,
  spotted: 90,
  priority: 80,
  missing: 70,
  unsure: 60,
  unavailable: 50,
  new: 0,
};

const PRIORITY_WEIGHT = {
  urgent: 100,
  important: 80,
  medium: 60,
  low: 40,
  ignored: 20,
  none: 0,
};

function bestStatus(a, b) {
  return (STATUS_WEIGHT[a] || 0) >= (STATUS_WEIGHT[b] || 0) ? a : b;
}

function bestPriority(a, b) {
  return (PRIORITY_WEIGHT[a] || 0) >= (PRIORITY_WEIGHT[b] || 0) ? a : b;
}

function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function resolveBaseName(baseName, spriteMap) {
  if (!baseName) return null;
  const key = baseName.toLowerCase().trim();
  if (key.startsWith("sprite_")) return key;
  if (MIGRATION_MAP[key]) return MIGRATION_MAP[key];
  if (MIGRATION_MAP[baseName]) return MIGRATION_MAP[baseName];
  if (spriteMap[key]) return spriteMap[key];
  // Try removing trailing "sprite" if user wrote "Water Sprite Sprite"
  if (key.endsWith(" sprite")) {
    const alt = key.slice(0, -7).trim();
    if (spriteMap[alt]) return spriteMap[alt];
  }
  return null;
}

function normalizeVariantName(name) {
  const n = name.trim();
  const lower = n.toLowerCase();
  if (lower === "holo" || lower === "holofoil") return "Holofoil";
  const known = FLAT_VARIANT_SUFFIXES.find((v) => lower === v.toLowerCase());
  if (known) return known;
  // Capitalize first letter
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

function parseLegacySpriteId(rawId, spriteMap, variantMap, flatVariantMap, errors) {
  if (!rawId || typeof rawId !== "string") {
    errors.push({ rawId, reason: "empty_or_invalid" });
    return null;
  }

  // Direct mapping for flat full names like "Water Sprite Holo".
  if (MIGRATION_MAP[rawId]) {
    const mapped = MIGRATION_MAP[rawId];
    if (mapped.includes("::")) {
      const [base, variant] = mapped.split("::");
      return { spriteId: base, variant: normalizeVariantName(variant), full: mapped };
    }
    // If mapped value contains an underscore variant suffix, e.g. "sprite_water_holo".
    for (const suffix of FLAT_VARIANT_SUFFIXES) {
      const suffixLower = suffix.toLowerCase();
      if (mapped.toLowerCase().endsWith(`_${suffixLower}`)) {
        const base = mapped.slice(0, -(suffix.length + 1));
        return { spriteId: base, variant: normalizeVariantName(suffix), full: `${base}::${normalizeVariantName(suffix)}` };
      }
    }
    // Base only -> default Base variant.
    return { spriteId: mapped, variant: "Base", full: `${mapped}::Base` };
  }

  // base::variant format. Resolve the base if it is not yet a stable id.
  if (rawId.includes("::")) {
    const [basePart, variantPart] = rawId.split("::");
    if (basePart.toLowerCase().startsWith("sprite_")) {
      return { spriteId: basePart, variant: normalizeVariantName(variantPart), full: rawId };
    }
    const resolvedBase = resolveBaseName(basePart, spriteMap);
    if (!resolvedBase) {
      errors.push({ rawId, reason: "unknown_base", baseName: basePart });
      return null;
    }
    const variant = normalizeVariantName(variantPart);
    return { spriteId: resolvedBase, variant, full: `${resolvedBase}::${variant}` };
  }

  // Base_variant flat format like "sprite_water_holo" or "water_holo".
  for (const suffix of FLAT_VARIANT_SUFFIXES) {
    const suffixLower = suffix.toLowerCase();
    const regex = new RegExp(`[_-]${suffixLower}$`, "i");
    if (regex.test(rawId)) {
      const basePart = rawId.replace(regex, "");
      const baseId = resolveBaseName(basePart, spriteMap);
      if (!baseId) {
        errors.push({ rawId, reason: "unknown_base", baseName: basePart });
        return null;
      }
      const variant = normalizeVariantName(suffix);
      return { spriteId: baseId, variant, full: `${baseId}::${variant}` };
    }
  }

  // Try to extract a trailing variant word from the display name, e.g. "Water Sprite Holo".
  const parts = rawId.trim().split(/\s+/);
  let variant = "Base";
  let baseParts = parts;
  const last = parts[parts.length - 1];
  const matchedSuffix = FLAT_VARIANT_SUFFIXES.find((s) => s.toLowerCase() === last.toLowerCase());
  if (matchedSuffix) {
    variant = normalizeVariantName(matchedSuffix);
    baseParts = parts.slice(0, -1);
  }
  const baseName = baseParts.join(" ").trim();

  // Resolve base name.
  const baseId = resolveBaseName(baseName, spriteMap);
  if (!baseId) {
    errors.push({ rawId, reason: "unknown_base", baseName });
    return null;
  }

  return { spriteId: baseId, variant, full: `${baseId}::${variant}` };
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS legacy_sprite_name_map (
      old_name TEXT PRIMARY KEY,
      sprite_id TEXT NOT NULL,
      variant_name TEXT NOT NULL DEFAULT 'Base',
      status TEXT NOT NULL DEFAULT 'mapped',
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_errors (
      id SERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      original_key TEXT NOT NULL,
      user_id INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function loadMaps(client) {
  const spriteRows = await client.query(`SELECT id, name, official_name, slug FROM sprites`);
  const spriteMap = {};
  for (const r of spriteRows.rows) {
    if (r.name) spriteMap[r.name.toLowerCase()] = r.id;
    if (r.official_name) spriteMap[r.official_name.toLowerCase()] = r.id;
    if (r.slug) spriteMap[r.slug.toLowerCase()] = r.id;
  }

  const variantRows = await client.query(`SELECT id, sprite_id, variant_type, name, official_name FROM sprite_variants`);
  const variantMap = {};
  const flatVariantMap = {};
  for (const r of variantRows.rows) {
    const key = `${r.sprite_id}::${r.variant_type.toLowerCase()}`;
    variantMap[key] = r.id;
    if (r.official_name) flatVariantMap[r.official_name.toLowerCase()] = r.id;
    if (r.name) flatVariantMap[r.name.toLowerCase()] = r.id;
  }

  const mapRows = await client.query(`SELECT old_name, sprite_id, variant_name FROM legacy_sprite_name_map WHERE status = 'mapped'`);
  const dbMap = {};
  for (const r of mapRows.rows) {
    dbMap[r.old_name] = `${r.sprite_id}::${r.variant_name}`;
  }

  return { spriteMap, variantMap, flatVariantMap, dbMap };
}

async function resolveAndRecord(client, rawId, userId, tableName, spriteMap, variantMap, flatVariantMap, dbMap, errors) {
  // If already in DB map, use it directly.
  if (dbMap[rawId]) {
    const [base, variant] = dbMap[rawId].split("::");
    return { spriteId: base, variant, full: dbMap[rawId] };
  }

  const parsed = parseLegacySpriteId(rawId, spriteMap, variantMap, flatVariantMap, errors);
  if (!parsed) {
    await client.query(
      `INSERT INTO migration_errors (table_name, original_key, user_id, error) VALUES ($1, $2, $3, $4)`,
      [tableName, rawId, userId || null, errors[errors.length - 1]?.reason || "unknown"]
    );
    return null;
  }

  // Validate that the target variant exists; if not, fall back to Base for the sprite.
  const variantKey = `${parsed.spriteId}::${parsed.variant.toLowerCase()}`;
  if (!variantMap[variantKey]) {
    const baseKey = `${parsed.spriteId}::base`;
    if (variantMap[baseKey]) {
      parsed.variant = "Base";
      parsed.full = `${parsed.spriteId}::Base`;
    } else {
      const reason = `variant_not_found:${parsed.spriteId}::${parsed.variant}`;
      errors.push({ rawId, reason });
      await client.query(
        `INSERT INTO migration_errors (table_name, original_key, user_id, error) VALUES ($1, $2, $3, $4)`,
        [tableName, rawId, userId || null, reason]
      );
      return null;
    }
  }

  // Record the successful mapping only when the raw id is not already normalized.
  if (rawId !== parsed.full && !rawId.toLowerCase().startsWith("sprite_")) {
    await client.query(
      `INSERT INTO legacy_sprite_name_map (old_name, sprite_id, variant_name, status)
       VALUES ($1, $2, $3, 'mapped')
       ON CONFLICT (old_name) DO UPDATE SET sprite_id = $2, variant_name = $3, status = 'mapped', updated_at = NOW()`,
      [rawId, parsed.spriteId, parsed.variant]
    );
  }
  dbMap[rawId] = parsed.full;
  return parsed;
}

async function migrateSpriteEntries(client, spriteMap, variantMap, flatVariantMap, dbMap) {
  const rows = await client.query(`
    SELECT id, user_id, sprite_id, status, note, priority, obtained_at, updated_at
    FROM sprite_entries
    ORDER BY user_id, sprite_id, updated_at DESC
  `);

  const byUserVariant = {};
  for (const r of rows.rows) {
    const errors = [];
    const resolved = await resolveAndRecord(client, r.sprite_id, r.user_id, "sprite_entries", spriteMap, variantMap, flatVariantMap, dbMap, errors);
    if (!resolved) {
      console.warn(`[sprite_entries] Could not migrate id=${r.id} key=${r.sprite_id} user=${r.user_id}:`, errors);
      continue;
    }
    const key = `${r.user_id}::${resolved.full}`;
    if (!byUserVariant[key]) {
      byUserVariant[key] = { ...r, newSpriteId: resolved.full };
    } else {
      const existing = byUserVariant[key];
      existing.status = bestStatus(existing.status, r.status);
      existing.priority = bestPriority(existing.priority, r.priority);
      existing.note = [existing.note, r.note].filter(Boolean).join("\n---\n");
      existing.obtained_at = earliest(existing.obtained_at, r.obtained_at);
      existing.updated_at = latest(existing.updated_at, r.updated_at);
      // Mark duplicate row for deletion (first row is the most recent survivor).
      existing.idsToDelete = existing.idsToDelete || [];
      existing.idsToDelete.push(r.id);
    }
  }

  // Apply merges: update the survivor row, then delete duplicate legacy rows.
  for (const key of Object.keys(byUserVariant)) {
    const e = byUserVariant[key];

    // If nothing changed and no duplicates, skip the write.
    if (e.sprite_id === e.newSpriteId && (!e.idsToDelete || e.idsToDelete.length === 0)) {
      continue;
    }

    // Delete duplicate or stale rows first to avoid unique-constraint conflicts.
    const idsToDelete = e.idsToDelete || [];
    if (idsToDelete.length > 0) {
      await client.query(`DELETE FROM sprite_entries WHERE id = ANY($1::int[])`, [idsToDelete]);
    }

    // Update the survivor to the normalized id and merged values.
    await client.query(
      `UPDATE sprite_entries
       SET sprite_id = $1, status = $2, note = $3, priority = $4, obtained_at = $5::timestamptz, updated_at = $6::timestamptz
       WHERE id = $7`,
      [e.newSpriteId, e.status, e.note, e.priority, e.obtained_at, e.updated_at, e.id]
    );
  }
}

async function migrateCollectionHistory(client, spriteMap, variantMap, flatVariantMap, dbMap) {
  const rows = await client.query(`SELECT id, user_id, sprite_id, old_status, new_status, created_at FROM collection_history`);
  for (const r of rows.rows) {
    const errors = [];
    const resolved = await resolveAndRecord(client, r.sprite_id, r.user_id, "collection_history", spriteMap, variantMap, flatVariantMap, dbMap, errors);
    if (!resolved) {
      console.warn(`[collection_history] Could not migrate id=${r.id} key=${r.sprite_id}:`, errors);
      continue;
    }
    if (r.sprite_id !== resolved.full) {
      await client.query(`UPDATE collection_history SET sprite_id = $1 WHERE id = $2`, [resolved.full, r.id]);
    }
  }

  // Deduplicate identical history rows after migration.
  await client.query(`
    DELETE FROM collection_history
    WHERE id IN (
      SELECT id
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, sprite_id, old_status, new_status, created_at ORDER BY id) as rn
        FROM collection_history
      ) t
      WHERE t.rn > 1
    )
  `);
}

async function migrateSquadActivity(client, spriteMap, variantMap, flatVariantMap, dbMap) {
  const rows = await client.query(`SELECT id, user_id, sprite_id, action, created_at FROM squad_activity`);
  for (const r of rows.rows) {
    const errors = [];
    const resolved = await resolveAndRecord(client, r.sprite_id, r.user_id, "squad_activity", spriteMap, variantMap, flatVariantMap, dbMap, errors);
    if (!resolved) {
      console.warn(`[squad_activity] Could not migrate id=${r.id} key=${r.sprite_id}:`, errors);
      continue;
    }
    if (r.sprite_id !== resolved.full) {
      await client.query(`UPDATE squad_activity SET sprite_id = $1 WHERE id = $2`, [resolved.full, r.id]);
    }
  }
}

async function checkDuplicates(client) {
  const dSprites = await client.query(`
    SELECT LOWER(name) as name_key, array_agg(id ORDER BY id) as ids
    FROM sprites
    GROUP BY LOWER(name)
    HAVING count(*) > 1
  `);
  console.log("[CHECK] Duplicate sprites by name:", dSprites.rows);

  const dOfficial = await client.query(`
    SELECT LOWER(official_name) as name_key, array_agg(id ORDER BY id) as ids
    FROM sprites
    WHERE official_name IS NOT NULL AND official_name <> ''
    GROUP BY LOWER(official_name)
    HAVING count(*) > 1
  `);
  console.log("[CHECK] Duplicate sprites by official_name:", dOfficial.rows);

  const dVariants = await client.query(`
    SELECT sprite_id, LOWER(variant_type) as variant, array_agg(id ORDER BY id) as ids
    FROM sprite_variants
    GROUP BY sprite_id, LOWER(variant_type)
    HAVING count(*) > 1
  `);
  console.log("[CHECK] Duplicate variants by sprite_id + variant_type:", dVariants.rows);

  const dEntries = await client.query(`
    SELECT user_id, sprite_id, COUNT(*) as c
    FROM sprite_entries
    GROUP BY user_id, sprite_id
    HAVING COUNT(*) > 1
    LIMIT 50
  `);
  console.log("[CHECK] Duplicate sprite_entries per user:", dEntries.rows);
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureTables(client);
    const { spriteMap, variantMap, flatVariantMap, dbMap } = await loadMaps(client);

    console.log("Loaded sprite map keys:", Object.keys(spriteMap).length);
    console.log("Loaded variant map keys:", Object.keys(variantMap).length);

    await migrateSpriteEntries(client, spriteMap, variantMap, flatVariantMap, dbMap);
    await migrateCollectionHistory(client, spriteMap, variantMap, flatVariantMap, dbMap);
    await migrateSquadActivity(client, spriteMap, variantMap, flatVariantMap, dbMap);
    await checkDuplicates(client);

    const errCount = await client.query(`SELECT COUNT(*) as c FROM migration_errors`);
    const mapCount = await client.query(`SELECT COUNT(*) as c FROM legacy_sprite_name_map`);
    console.log(`Migration complete. Mapped names: ${mapCount.rows[0].c}, errors: ${errCount.rows[0].c}`);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
