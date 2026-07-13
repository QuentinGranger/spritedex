function renderBars(container, rows) {
  container.innerHTML = rows
    .map((row) => `
      <div class="bar-row">
        <div class="bar-meta">
          <span>${row.label}</span>
          <span>${row.owned}/${row.total} · ${row.percent}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="--bar:${row.percent}%"></div></div>
      </div>
    `)
    .join("");
}

function renderStats() {
  const items = getAllItems();
  const totalVariants = items.length;
  const ownedVariants = items.filter(i => getEntry(i.id).status === "owned").length;
  const pct = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;

  const circumference = 327;
  const offset = circumference - (circumference * pct / 100);
  els.statsRingCircle.style.strokeDashoffset = offset;
  els.statsHeroPct.textContent = `${pct}%`;
  els.statsHeroDetail.textContent = `${ownedVariants} / ${totalVariants} variantes collectées`;

  const spritesCompleted = SPRITES.filter(s =>
    s.variants.every(v => getEntry(variantId(s.id, v)).status === "owned")
  ).length;
  const spritesPartial = SPRITES.filter(s =>
    s.variants.some(v => getEntry(variantId(s.id, v)).status === "owned")
  ).length;
  els.kpiSprites.textContent = `${spritesPartial} / ${SPRITES.length}`;
  els.kpiVariants.textContent = `${ownedVariants} / ${totalVariants}`;

  const prioritiesLeft = items.filter(i => {
    const e = getEntry(i.id);
    return e.priority && e.priority !== "none" && e.priority !== "ignored" && e.status !== "owned";
  }).length;
  els.kpiPriorities.textContent = prioritiesLeft;

  const rarities = Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .map(rarity => {
      const group = items.filter(i => i.rarity === rarity);
      const owned = group.filter(i => getEntry(i.id).status === "owned").length;
      return { label: rarity, total: group.length, owned, percent: group.length ? Math.round((owned / group.length) * 100) : 0 };
    }).filter(row => row.total > 0);

  const variants = Object.keys(VARIANT_META).map(variant => {
    const group = items.filter(i => i.variant === variant);
    const owned = group.filter(i => getEntry(i.id).status === "owned").length;
    return { label: variant, total: group.length, owned, percent: group.length ? Math.round((owned / group.length) * 100) : 0 };
  }).filter(row => row.total > 0);

  renderBars(els.rarityBars, rarities);
  renderBars(els.variantBars, variants);

  const bestRarity = rarities.reduce((a, b) => a.percent >= b.percent ? a : b);
  const worstRarity = rarities.reduce((a, b) => a.percent <= b.percent ? a : b);
  const worstVariant = variants.length ? variants.reduce((a, b) => a.percent <= b.percent ? a : b) : null;

  const topRarity = Object.entries(RARITY_ORDER).sort((a, b) => a[1] - b[1])[0]?.[0] || "";
  const mythCompleted = SPRITES.filter(s =>
    s.rarity === topRarity && s.variants.every(v => getEntry(variantId(s.id, v)).status === "owned")
  ).length;
  const mythTotal = SPRITES.filter(s => s.rarity === topRarity).length;

  let insights = `
    <div class="insight-card insight-card--best">
      <span class="insight-card__label">Collection la plus avancée</span>
      <strong class="insight-card__value">${bestRarity.label} — ${bestRarity.percent}%</strong>
    </div>
    <div class="insight-card insight-card--worst">
      <span class="insight-card__label">Collection la moins avancée</span>
      <strong class="insight-card__value">${worstRarity.label} — ${worstRarity.percent}%</strong>
    </div>
  `;

  if (worstVariant) {
    insights += `
      <div class="insight-card insight-card--variant">
        <span class="insight-card__label">Variante la plus manquante</span>
        <strong class="insight-card__value">${worstVariant.label} — ${worstVariant.owned}/${worstVariant.total}</strong>
      </div>
    `;
  }

  insights += `
    <div class="insight-card insight-card--myth">
      <span class="insight-card__label">${topRarity} complétés</span>
      <strong class="insight-card__value">${mythCompleted} / ${mythTotal}</strong>
    </div>
    <div class="insight-card insight-card--full">
      <span class="insight-card__label">Sprites 100% complétés</span>
      <strong class="insight-card__value">${spritesCompleted} / ${SPRITES.length}</strong>
    </div>
  `;

  els.statsInsights.innerHTML = insights;
}
