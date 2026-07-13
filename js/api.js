async function loadSpritesFromAPI() {
  try {
    const res = await fetch(`${API_BASE}/sprites`);
    if (!res.ok) throw new Error("API sprites failed");
    const data = await res.json();

    SPRITES = data.sprites.map(s => ({
      id: s.id,
      name: s.name,
      rarity: s.rarity,
      color: s.color,
      effect: s.effect,
      variants: s.variants,
      available: s.available,
      addedDate: s.added_date
    }));

    SPRITE_IMAGES = {};
    for (const s of data.sprites) {
      SPRITE_IMAGES[s.id] = s.images;
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
