async function loadSpritesFromAPI() {
  try {
    const res = await fetch(`${API_BASE}/sprites`);
    if (!res.ok) throw new Error("API sprites failed");
    const data = await res.json();

    SPRITES = data.sprites.map(s => ({
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

    SPRITE_IMAGES = {};
    for (const s of data.sprites) {
      SPRITE_IMAGES[s.id] = s.images;
    }

    SPRITE_VARIANTS = {};
    for (const s of data.sprites) {
      SPRITE_VARIANTS[s.id] = s.variantDetails || {};
    }

    SEASONS = {};
    for (const season of data.seasons || []) {
      SEASONS[season.id] = season;
    }

    EVENTS = {};
    for (const event of data.events || []) {
      EVENTS[event.id] = event;
    }

    VARIANT_META = {};
    for (const v of data.variantMeta) {
      VARIANT_META[v.name] = { label: v.label, bonus: v.bonus };
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
