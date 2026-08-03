"use strict";

const { pool, buildAcquisitionMethod, buildAvailability, buildRecurrence, dedupeSpritesBySlug } = require("./shared");

function isVariantReleasedAndActiveServer(item) {
  const release = (item.releaseStatus || "").toLowerCase();
  if (["unreleased", "upcoming", "coming_soon", "soon", "unknown"].includes(release)) return false;
  const data = (item.dataStatus || "").toLowerCase();
  if (["archived", "legacy", "disabled"].includes(data)) return false;
  if (item.available === false || item.enabled === false || item.isReleased === false) return false;
  return true;
}

async function getServerCompareCatalogItems() {
  const [spritesRes, variantsRes] = await Promise.all([
    pool.query(
      `SELECT id, slug, name, rarity, color, variants, season_id, event_id, acquisition, availability, data_status, is_released, available, added_date FROM sprites`
    ),
    pool.query(
      `SELECT id, sprite_id, variant_type, name, rarity, release_status, data_status, acquisition, availability, first_observed_at, image_path, suggested_image_path FROM sprite_variants`
    )
  ]);
  // Match /api/sprites exactly: legacy rows may duplicate the same sprite
  // under different ids. All totals, badges and squad calculations must use
  // the same canonical catalogue as the client.
  const canonicalSprites = dedupeSpritesBySlug(spritesRes.rows);
  const canonicalBySlug = new Map(
    canonicalSprites.map((sprite) => [
      sprite.slug ||
        String(sprite.id)
          .replace(/^sprite_/, "")
          .replace(/_/g, "-"),
      sprite
    ])
  );
  const spriteMap = new Map(
    spritesRes.rows.map((sprite) => {
      const slug =
        sprite.slug ||
        String(sprite.id)
          .replace(/^sprite_/, "")
          .replace(/_/g, "-");
      return [sprite.id, canonicalBySlug.get(slug) || sprite];
    })
  );
  const items = [];
  const knownVariantKeys = new Set();
  for (const v of variantsRes.rows) {
    const sprite = spriteMap.get(v.sprite_id);
    if (!sprite) continue;
    const variantAcquisition = buildAcquisitionMethod(
      v.acquisition && Object.keys(v.acquisition || {}).length ? v.acquisition : sprite.acquisition
    );
    const variantAvailability = buildAvailability(
      v.availability && Object.keys(v.availability || {}).length ? v.availability : sprite.availability
    );
    const variantRecurrence = buildRecurrence(variantAvailability.recurrence);
    knownVariantKeys.add(`${sprite.id}::${v.variant_type}`);
    items.push({
      id: v.id,
      variantId: v.id,
      spriteId: sprite.id,
      variantType: v.variant_type,
      variantName: v.name || v.variant_type,
      spriteName: sprite.name || sprite.id,
      img: v.image_path || v.suggested_image_path || null,
      rarity: v.rarity || sprite.rarity,
      color: sprite.color,
      seasonId: sprite.season_id,
      eventId: sprite.event_id,
      releaseStatus: v.release_status || "",
      dataStatus: v.data_status || sprite.data_status || "",
      availabilityStatus: variantAvailability.status,
      availabilityEndDate: variantAvailability.endDate || null,
      availability: { ...variantAvailability, recurrence: variantRecurrence },
      availabilityRecurrenceStatus: variantRecurrence.status,
      acquisitionMethod: variantAcquisition.type,
      releaseDate: variantAvailability.startDate || v.first_observed_at || sprite.added_date,
      endDate: variantAvailability.endDate || null,
      available: v.available !== undefined ? v.available : sprite.available,
      isReleased: sprite.is_released
    });
  }

  // The reference catalogue historically stored some variants only in
  // sprites.variants.  They are still real collectable variants and use the
  // same legacy-stable id as the web client (spriteId::variantType).  Without
  // this fallback, progress endpoints could report 0/0 while the app showed
  // the complete catalogue.
  for (const sprite of canonicalSprites) {
    const variantTypes = Array.isArray(sprite.variants) && sprite.variants.length ? sprite.variants : ["Base"];
    const availability = buildAvailability(sprite.availability);
    const recurrence = buildRecurrence(availability.recurrence);
    for (const rawType of variantTypes) {
      const variantType = String(rawType || "Base");
      const key = `${sprite.id}::${variantType}`;
      if (knownVariantKeys.has(key)) continue;
      const released = sprite.is_released !== false;
      items.push({
        id: key,
        variantId: key,
        spriteId: sprite.id,
        variantType,
        variantName: variantType,
        spriteName: sprite.name || sprite.id,
        img: null,
        rarity: sprite.rarity,
        color: sprite.color,
        seasonId: sprite.season_id,
        eventId: sprite.event_id,
        releaseStatus: released ? "released" : "unreleased",
        dataStatus: sprite.data_status || "",
        availabilityStatus: availability.status,
        availabilityEndDate: availability.endDate || null,
        availability: { ...availability, recurrence },
        availabilityRecurrenceStatus: recurrence.status,
        acquisitionMethod: buildAcquisitionMethod(sprite.acquisition).type,
        releaseDate: availability.startDate || sprite.added_date || null,
        endDate: availability.endDate || null,
        available: sprite.available !== false,
        isReleased: released
      });
    }
  }
  return items;
}

async function loadServerCompareCollection(userId) {
  // Lazy require avoids a circular dependency with ./cache (which imports catalog).
  const { pruneCollectionCache, collectionCache, COMPARE_CACHE_TTL_MS } = require("./cache");
  pruneCollectionCache();
  const uid = String(userId);
  const cached = collectionCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.collection;
  }

  const result = await pool.query(
    "SELECT variant_id, status, note, priority, obtained_at FROM sprite_entries WHERE user_id = $1",
    [userId]
  );
  // variant_id comes from persisted collections, including legacy imports.
  // Keep a malicious legacy "__proto__" entry as data rather than changing
  // the prototype of this comparison cache record.
  const collection = Object.create(null);
  for (const row of result.rows) {
    collection[row.variant_id] = {
      status: row.status || "new",
      note: row.note || "",
      priority: row.priority || "none",
      obtainedAt: row.obtained_at || null
    };
  }

  collectionCache.set(uid, {
    collection,
    expiresAt: Date.now() + COMPARE_CACHE_TTL_MS,
    createdAt: Date.now()
  });
  return collection;
}

module.exports = { isVariantReleasedAndActiveServer, getServerCompareCatalogItems, loadServerCompareCollection };
