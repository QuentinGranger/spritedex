"use strict";

const {
  defaultColor,
  titleCaseVariant,
  normalizeAvailabilityStatus,
  normalizeAvailability,
  buildRecurrence,
  buildDates,
  normalizeDataStatus,
  computeMissingFields
} = require("./normalizers");
const { upsertAvailabilityPeriod } = require("./availability-periods");
const { diffAndRecord } = require("./changes");
const { syncSpriteSnapshot, syncVariantSnapshot, SOURCES } = require("../../server/catalog-registry");

async function importReleasedSprites(client, catalog, context) {
  const { version, generatedAt, variantEffectMap, existingColors, existingSprites, existingVariants, changeMeta } =
    context;
  const availStatusOf = (row) =>
    row && row.availability && typeof row.availability === "object" ? (row.availability.status ?? null) : null;
  let totalChanges = 0;
  for (const s of catalog.sprites) {
    const stableId = s.id;
    const variantsArr = s.variants.map((v) => titleCaseVariant(v.variantType));
    const color = s.color || existingColors[stableId] || defaultColor(s.rarity);

    const abilityDesc = s.ability?.descriptionFr || s.ability?.descriptionEn || "";
    const baseVariant = s.variants.find((v) => v.variantType === "base") || s.variants[0];
    const spriteImage = s.image || (baseVariant && (baseVariant.imagePath || baseVariant.suggestedImagePath)) || null;

    const prev = existingSprites[stableId];
    const newRarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
    const newAvailStatus = normalizeAvailabilityStatus(
      s.availability?.status,
      s.availability?.startDate,
      s.availability?.endDate
    );
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
        { field: "availability.status", previousValue: availStatusOf(prev), newValue: newAvailStatus ?? null }
      ]
    });

    const dates = buildDates(s.dates, s.firstObservedAt, s.lastVerifiedAt, s.officiallyAnnouncedAt);
    const recurrence = buildRecurrence(s.recurrence || s.availability?.recurrence);
    const availability = normalizeAvailability(s.availability) || {};
    const spriteForMissing = {
      officialName: s.officialName,
      seasonId: s.seasonId,
      image: spriteImage,
      acquisition: s.acquisition || {},
      availability,
      recurrence,
      dates,
      sources: s.sourceIds || [],
      availabilityPeriods: s.availability?.startDate || s.availability?.endDate ? [{}] : []
    };
    const missingFields = computeMissingFields(spriteForMissing);
    const dataStatus = normalizeDataStatus(s.dataStatus, missingFields);

    await syncSpriteSnapshot(client, {
      spriteId: stableId,
      client,
      source: SOURCES.IMPORT,
      actorLabel: changeMeta.changedBy || "import",
      reason: changeMeta.reason || "catalog import",
      snapshot: {
        name: s.name,
        rarity: newRarity,
        color,
        effect: abilityDesc,
        variants: variantsArr,
        available: newAvailStatus,
        added_date: s.firstObservedAt,
        catalog_id: s.id,
        slug: s.slug,
        official_name: s.officialName,
        season_id: s.seasonId,
        event_id: s.eventId,
        image: spriteImage,
        introduced_in_update: s.introducedInUpdate,
        first_observed_at: dates.firstObservedAt,
        last_verified_at: dates.lastVerifiedAt,
        officially_announced_at: dates.officiallyAnnouncedAt,
        ability: s.ability || {},
        acquisition: s.acquisition || {},
        availability,
        recurrence,
        dates,
        missing_fields: missingFields,
        base_summon_cost: s.baseSummonCostSpriteDust,
        data_status: dataStatus,
        notes: s.notes || [],
        sources: s.sourceIds || [],
        catalog_version: version,
        catalog_generated_at: generatedAt,
        is_released: true
      }
    });

    await upsertAvailabilityPeriod(client, stableId, normalizeAvailability(s.availability), s.eventId, s.sourceIds);

    for (const v of s.variants) {
      const variantName = titleCaseVariant(v.variantType);
      const imagePath = v.imagePath || v.suggestedImagePath || null;
      const rarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
      const effect = variantEffectMap[v.variantType] || variantEffectMap[variantName.toLowerCase()] || null;

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
          { field: "availability.status", previousValue: availStatusOf(prevV), newValue: newVAvailStatus }
        ]
      });

      const variantDates = buildDates(null, v.firstObservedAt, null, null);
      const variantRecurrence = buildRecurrence(v.recurrence || v.availability?.recurrence);
      const variantAvailability = normalizeAvailability(v.availability) || {};
      const variantForMissing = {
        officialName: v.officialName || v.name,
        seasonId: s.seasonId,
        image: v.imagePath || v.suggestedImagePath,
        acquisition: s.acquisition || {},
        availability: variantAvailability,
        recurrence: variantRecurrence,
        dates: variantDates,
        sources: v.sourceIds || [],
        availabilityPeriods: []
      };
      const variantMissingFields = computeMissingFields(variantForMissing);
      const variantDataStatus = normalizeDataStatus(v.dataStatus, variantMissingFields);

      await syncVariantSnapshot(client, {
        variantId: v.id,
        parentSpriteId: stableId,
        client,
        source: SOURCES.IMPORT,
        actorLabel: changeMeta.changedBy || "import",
        reason: changeMeta.reason || "catalog import",
        snapshot: {
          sprite_id: stableId,
          variant_type: variantName,
          name: v.name,
          official_name: v.officialName || v.name,
          slug: v.slug,
          rarity,
          release_status: v.releaseStatus,
          first_observed_at: v.firstObservedAt,
          summon_cost: v.summonCostSpriteDust,
          sprite_chest_drop_chance_pct: v.spriteChestDropChancePct,
          extra_effect_ref: v.extraEffectRef,
          effect: effect || {},
          acquisition: s.acquisition || {},
          image_path: v.imagePath,
          suggested_image_path: v.suggestedImagePath,
          availability: variantAvailability,
          recurrence: variantRecurrence,
          dates: variantDates,
          missing_fields: variantMissingFields,
          data_status: variantDataStatus,
          sources: v.sourceIds || []
        }
      });

      await client.query(
        `INSERT INTO sprite_images (sprite_id, variant, image_path)
           VALUES ($1, $2, $3)
           ON CONFLICT (sprite_id, variant) DO UPDATE SET image_path = $3`,
        [stableId, variantName, imagePath]
      );
    }
  }
  return totalChanges;
}

module.exports = { importReleasedSprites };
