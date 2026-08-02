"use strict";

const { defaultColor, normalizeAvailabilityStatus, normalizeAvailability, buildRecurrence, buildDates, normalizeDataStatus, computeMissingFields } = require("./normalizers");
const { upsertAvailabilityPeriod } = require("./availability-periods");
const { diffAndRecord } = require("./changes");

async function importUnreleasedSprites(client, catalog, context) {
  const { version, generatedAt, existingColors, existingSprites, changeMeta } = context;
  const availStatusOf = (row) => (row && row.availability && typeof row.availability === "object" ? row.availability.status ?? null : null);
  let totalChanges = 0;
    // 4. Import unreleased base sprites
    for (const s of catalog.unreleasedContent?.baseSprites || []) {
      const stableId = s.id;
      const unreleasedImage = s.image || null;

      // Étape 19 — journalise les champs modifiés des sprites non publiés.
      const prevU = existingSprites[stableId];
      const newURarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
      const newUAvailStatus = normalizeAvailabilityStatus(s.availability?.status, s.availability?.startDate, s.availability?.endDate);
      totalChanges += await diffAndRecord(client, {
        entityType: "sprite",
        entityId: stableId,
        existed: !!prevU,
        meta: { ...changeMeta, sourceId: (s.sourceIds || [])[0] || null },
        fields: [
          { field: "rarity", previousValue: prevU?.rarity ?? null, newValue: newURarity ?? null },
          { field: "seasonId", previousValue: prevU?.season_id ?? null, newValue: s.seasonId ?? null },
          { field: "officialName", previousValue: prevU?.official_name ?? null, newValue: s.officialName ?? null },
          { field: "image", previousValue: prevU?.image ?? null, newValue: unreleasedImage },
          { field: "availability.status", previousValue: availStatusOf(prevU), newValue: newUAvailStatus ?? null },
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
  return totalChanges;
}

module.exports = { importUnreleasedSprites };
