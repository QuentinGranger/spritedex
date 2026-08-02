"use strict";

const { titleCaseVariant } = require("./normalizers");

async function importMetadataAndLegacyEntries(client, catalog, context) {
  const { variantEffectMap } = context;
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
      if (!row.sprite_id) continue;
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
}

module.exports = { importMetadataAndLegacyEntries };
