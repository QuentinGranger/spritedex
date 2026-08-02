"use strict";

const { defaultColor, titleCaseVariant, normalizeAvailabilityStatus, normalizeAvailability, buildRecurrence, buildDates, normalizeDataStatus, computeMissingFields } = require("./normalizers");
const { upsertAvailabilityPeriod } = require("./availability-periods");
const { diffAndRecord } = require("./changes");

async function importReleasedSprites(client, catalog, context) {
  const { version, generatedAt, variantEffectMap, existingColors, existingSprites, existingVariants, changeMeta } = context;
  const availStatusOf = (row) => (row && row.availability && typeof row.availability === "object" ? row.availability.status ?? null : null);
  let totalChanges = 0;
    // 2. Import released sprites
    for (const s of catalog.sprites) {
      const stableId = s.id;
      const variantsArr = s.variants.map((v) => titleCaseVariant(v.variantType));
      const color = s.color || existingColors[stableId] || defaultColor(s.rarity);

      const abilityDesc = s.ability?.descriptionFr || s.ability?.descriptionEn || "";
      const baseVariant = s.variants.find((v) => v.variantType === "base") || s.variants[0];
      const spriteImage = s.image || (baseVariant && (baseVariant.imagePath || baseVariant.suggestedImagePath)) || null;

      // Étape 19 — journalise les champs modifiés par rapport à la base.
      const prev = existingSprites[stableId];
      const newRarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
      const newAvailStatus = normalizeAvailabilityStatus(s.availability?.status, s.availability?.startDate, s.availability?.endDate);
      totalChanges += await diffAndRecord(client, {
        entityType: "sprite",
        entityId: stableId,
        existed: !!prev,
        meta: { ...changeMeta, sourceId: (s.sourceIds || [])[0] || null },
        fields: [
          { field: "rarity", previousValue: prev?.rarity ?? null, newValue: newRarity ?? null },
          { field: "seasonId", previousValue: prev?.season_id ?? null, newValue: s.seasonId ?? null },
          { field: "officialName", previousValue: prev?.official_name ?? null, newValue: s.officialName ?? null },
          { field: "image", previousValue: prev?.image ?? null, newValue: spriteImage ?? null },
          { field: "availability.status", previousValue: availStatusOf(prev), newValue: newAvailStatus ?? null },
        ],
      });

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

        // Étape 19 — journalise les champs de variante modifiés.
        const prevV = existingVariants[v.id];
        const newVAvailStatus = normalizeAvailability(v.availability)?.status ?? null;
        totalChanges += await diffAndRecord(client, {
          entityType: "variant",
          entityId: v.id,
          existed: !!prevV,
          meta: { ...changeMeta, sourceId: (v.sourceIds || [])[0] || null },
          fields: [
            { field: "rarity", previousValue: prevV?.rarity ?? null, newValue: rarity ?? null },
            { field: "releaseStatus", previousValue: prevV?.release_status ?? null, newValue: v.releaseStatus ?? null },
            { field: "imagePath", previousValue: prevV?.image_path ?? null, newValue: v.imagePath ?? null },
            { field: "availability.status", previousValue: availStatusOf(prevV), newValue: newVAvailStatus },
          ],
        });

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
  return totalChanges;
}

module.exports = { importReleasedSprites };
