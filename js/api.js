async function loadSpritesFromAPI() {
  try {
    const res = await fetch(`${API_BASE}/sprites`);
    if (!res.ok) throw new Error("API sprites failed");
    const data = await res.json();

    const sprites = Array.isArray(data.sprites) ? data.sprites : [];
    SPRITES = sprites
      .filter((s) => s && typeof s === "object" && isSafeRecordKey(String(s.id || "")))
      .map(s => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      officialName: s.officialName,
      image: s.image,
      variantIds: s.variantIds,
      seasonId: s.seasonId,
      season: s.season,
      eventId: s.eventId,
      event: s.event,
      acquisitionMethod: s.acquisitionMethod,
      availability: s.availability,
      availabilityPeriods: s.availabilityPeriods || [],
      recurrence: s.recurrence,
      dates: s.dates,
      missingFields: s.missingFields || [],
      sourceIds: s.sourceIds,
      sources: s.sources || [],
      dataStatus: s.dataStatus,
      confidence: s.confidence,
      rarity: s.rarity,
      color: s.color,
      effect: s.effect,
      variants: s.variants,
      variantDetails: s.variantDetails || {},
      available: s.available,
      addedDate: s.addedDate
    }));

    SPRITE_IMAGES = createSafeRecord();
    for (const s of sprites) {
      if (!s || !isSafeRecordKey(String(s.id || ""))) continue;
      const images = createSafeRecord();
      for (const [variant, image] of Object.entries(s.images || {})) {
        setSafeRecordValue(images, variant, safeImageUrl(image));
      }
      setSafeRecordValue(SPRITE_IMAGES, s.id, images);
    }

    SPRITE_VARIANTS = createSafeRecord();
    for (const s of sprites) {
      if (!s || !isSafeRecordKey(String(s.id || ""))) continue;
      const variants = createSafeRecord();
      for (const [variant, detail] of Object.entries(s.variantDetails || {})) {
        setSafeRecordValue(variants, variant, detail && typeof detail === "object" ? detail : {});
      }
      setSafeRecordValue(SPRITE_VARIANTS, s.id, variants);
    }

    SEASONS = createSafeRecord();
    for (const season of (Array.isArray(data.seasons) ? data.seasons : [])) {
      if (season && isSafeRecordKey(String(season.id || ""))) setSafeRecordValue(SEASONS, season.id, season);
    }

    EVENTS = createSafeRecord();
    for (const event of (Array.isArray(data.events) ? data.events : [])) {
      if (event && isSafeRecordKey(String(event.id || ""))) setSafeRecordValue(EVENTS, event.id, event);
    }

    VARIANT_META = createSafeRecord();
    for (const v of Array.isArray(data.variantMeta) ? data.variantMeta : []) {
      if (!v || !isSafeRecordKey(String(v.name || ""))) continue;
      setSafeRecordValue(VARIANT_META, v.name, { label: safeText(v.label), bonus: safeText(v.bonus) });
    }

    console.log(`Loaded ${SPRITES.length} sprites from DB`);
    return true;
  } catch (e) {
    console.warn("API sprites load failed, using fallback", e);
    return false;
  }
}

// NOTE: the previous loginUser()/"/api/auth/quick" pseudo-only login has been
// removed server-side (critical account-takeover risk: it let anyone log in
// as any existing username with no password). This function was unused by
// the current UI (email/password and OAuth are the supported login paths).
