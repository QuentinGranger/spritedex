"use strict";

const {
  defaultColor,
  normalizeAvailabilityStatus,
  normalizeAvailability,
  buildRecurrence,
  buildDates,
  normalizeDataStatus,
  computeMissingFields
} = require("./normalizers");
const { upsertAvailabilityPeriod } = require("./availability-periods");
const { diffAndRecord } = require("./changes");
const { syncSpriteSnapshot, SOURCES } = require("../../server/catalog-registry");

async function importUnreleasedSprites(client, catalog, context) {
  const { version, generatedAt, existingColors, existingSprites, changeMeta } = context;
  const availStatusOf = (row) =>
    row && row.availability && typeof row.availability === "object" ? (row.availability.status ?? null) : null;
  let totalChanges = 0;
  for (const s of catalog.unreleasedContent?.baseSprites || []) {
    const stableId = s.id;
    const unreleasedImage = s.image || null;

    const prevU = existingSprites[stableId];
    const newURarity = s.rarity?.charAt(0).toUpperCase() + s.rarity?.slice(1);
    const newUAvailStatus = normalizeAvailabilityStatus(
      s.availability?.status,
      s.availability?.startDate,
      s.availability?.endDate
    );
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
        { field: "availability.status", previousValue: availStatusOf(prevU), newValue: newUAvailStatus ?? null }
      ]
    });

    const unreleasedDates = buildDates(s.dates, s.firstObservedAt, s.lastVerifiedAt, s.officiallyAnnouncedAt);
    const recurrence = buildRecurrence(s.recurrence || s.availability?.recurrence);
    const availability = normalizeAvailability(s.availability) || {};
    const unreleasedSpriteForMissing = {
      officialName: s.officialName,
      seasonId: s.seasonId,
      image: unreleasedImage,
      acquisition: s.acquisition || {},
      availability,
      recurrence,
      dates: unreleasedDates,
      sources: s.sourceIds || [],
      availabilityPeriods: []
    };
    const missingFields = computeMissingFields(unreleasedSpriteForMissing);
    const dataStatus = normalizeDataStatus(s.dataStatus, missingFields);

    await syncSpriteSnapshot(client, {
      spriteId: stableId,
      client,
      source: SOURCES.IMPORT,
      actorLabel: changeMeta.changedBy || "import",
      reason: changeMeta.reason || "catalog import (unreleased)",
      snapshot: {
        name: s.name,
        rarity: newURarity,
        color: s.color || existingColors[stableId] || defaultColor(s.rarity),
        effect: s.ability?.descriptionFr || s.ability?.descriptionEn || "",
        variants: [],
        available: newUAvailStatus,
        added_date: s.firstObservedAt || null,
        catalog_id: s.id,
        slug: s.slug,
        official_name: s.officialName,
        season_id: s.seasonId,
        event_id: s.eventId,
        image: unreleasedImage,
        introduced_in_update: s.introducedInUpdate,
        first_observed_at: unreleasedDates.firstObservedAt,
        last_verified_at: unreleasedDates.lastVerifiedAt,
        officially_announced_at: unreleasedDates.officiallyAnnouncedAt,
        ability: s.ability || {},
        acquisition: s.acquisition || {},
        availability,
        recurrence,
        dates: unreleasedDates,
        missing_fields: missingFields,
        base_summon_cost: s.baseSummonCostSpriteDust,
        data_status: dataStatus,
        notes: s.notes || [],
        sources: s.sourceIds || [],
        catalog_version: version,
        catalog_generated_at: generatedAt,
        is_released: false
      }
    });

    await upsertAvailabilityPeriod(client, stableId, normalizeAvailability(s.availability), s.eventId, s.sourceIds);
  }
  return totalChanges;
}

module.exports = { importUnreleasedSprites };
