function renderBars(container, rows) {
  container.innerHTML = rows
    .map((row) => `
      <div class="bar-row" data-progress="${row.percent}" aria-label="${escapeHtml(row.label)} : ${row.owned} sur ${row.total}, ${row.percent} %">
        <div class="bar-meta">
          <span class="bar-meta__label">${escapeHtml(row.icon || "◇")} ${escapeHtml(row.label)}</span>
          <span class="bar-meta__value">${row.owned}/${row.total} · ${row.percent}%</span>
        </div>
        <div class="bar-track" role="progressbar" aria-label="Progression ${escapeHtml(row.label)}" aria-valuemin="0" aria-valuemax="${row.total}" aria-valuenow="${row.owned}" aria-valuetext="${row.owned} sur ${row.total}, ${row.percent} %"><div class="bar-fill" style="--bar:${row.percent}%"></div></div>
      </div>
    `)
    .join("");
}

function pluralize(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function renderInsight({ tone, icon, label, value, detail }) {
  return `
    <article class="insight-card insight-card--${tone}">
      <span class="insight-card__icon" aria-hidden="true">${escapeHtml(icon)}</span>
      <div class="insight-card__content">
        <span class="insight-card__label">${escapeHtml(label)}</span>
        <strong class="insight-card__value">${escapeHtml(value)}</strong>
        ${detail ? `<span class="insight-card__detail">${escapeHtml(detail)}</span>` : ""}
      </div>
    </article>
  `;
}

function renderStats() {
  const items = getAllItems();
  const totalVariants = items.length;
  const ownedVariants = items.filter(i => getEntry(i.id).status === "owned").length;
  const pct = totalVariants ? Math.round((ownedVariants / totalVariants) * 100) : 0;

  const circumference = 327;
  const offset = circumference - (circumference * pct / 100);
  if (els.statsRingCircle) els.statsRingCircle.style.strokeDashoffset = offset;
  if (els.statsHeroPct) els.statsHeroPct.textContent = `${pct}%`;
  if (els.statsHeroDetail) els.statsHeroDetail.textContent = `${ownedVariants} / ${totalVariants} variantes collectées`;
  const remainingVariants = Math.max(0, totalVariants - ownedVariants);
  if (els.statsHeroRemaining) els.statsHeroRemaining.textContent = remainingVariants;
  if (els.statsHeroSupport) {
    els.statsHeroSupport.textContent = remainingVariants
      ? `Encore ${pluralize(remainingVariants, "variante")} à découvrir.`
      : "Collection complète : toutes les variantes publiées sont réunies.";
  }

  const spritesCompleted = SPRITES.filter(s => {
    const vl = Object.keys(s.variantDetails || {}).length ? Object.keys(s.variantDetails) : (s.variants || ["Base"]);
    return vl.every(v => getEntry(variantId(s.id, v)).status === "owned");
  }).length;
  const spritesPartial = SPRITES.filter(s => {
    const vl = Object.keys(s.variantDetails || {}).length ? Object.keys(s.variantDetails) : (s.variants || ["Base"]);
    return vl.some(v => getEntry(variantId(s.id, v)).status === "owned");
  }).length;
  els.kpiSprites.textContent = `${spritesPartial} / ${SPRITES.length}`;
  els.kpiVariants.textContent = `${ownedVariants} / ${totalVariants}`;
  if (els.kpiSpritesHint) {
    els.kpiSpritesHint.textContent = spritesCompleted
      ? `${pluralize(spritesCompleted, "Sprite")} complété${spritesCompleted > 1 ? "s" : ""} à 100 %`
      : "Aucune famille complète";
  }
  if (els.kpiVariantsHint) els.kpiVariantsHint.textContent = `${pct} % du catalogue publié`;

  const prioritiesLeft = items.filter(i => {
    const e = getEntry(i.id);
    return e.priority && e.priority !== "none" && e.priority !== "ignored" && isCollectibleMissingStatus(e.status);
  }).length;
  els.kpiPriorities.textContent = prioritiesLeft;
  if (els.kpiPrioritiesHint) {
    els.kpiPrioritiesHint.textContent = prioritiesLeft
      ? `${pluralize(prioritiesLeft, "recherche")} à planifier`
      : "Aucune recherche prioritaire";
  }

  const rarities = Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .map(rarity => {
      const group = items.filter(i => i.rarity === rarity);
      const owned = group.filter(i => getEntry(i.id).status === "owned").length;
      return { label: rarity, icon: { Mythique: "♛", "Légendaire": "★", "Épique": "◆", Rare: "◇" }[rarity] || "◇", total: group.length, owned, percent: group.length ? Math.round((owned / group.length) * 100) : 0 };
    }).filter(row => row.total > 0);

  const variants = Object.keys(VARIANT_META).map(variant => {
    const group = items.filter(i => i.variant === variant);
    const owned = group.filter(i => getEntry(i.id).status === "owned").length;
    return { label: VARIANT_META[variant]?.label || variant, icon: "▱", total: group.length, owned, percent: group.length ? Math.round((owned / group.length) * 100) : 0 };
  }).filter(row => row.total > 0);

  renderBars(els.rarityBars, rarities);
  renderBars(els.variantBars, variants);

  const bestRarity = rarities.length ? rarities.reduce((a, b) => a.percent >= b.percent ? a : b) : null;
  const worstRarity = rarities.length ? rarities.reduce((a, b) => a.percent <= b.percent ? a : b) : null;
  const worstVariant = variants.length ? variants.reduce((a, b) => a.percent <= b.percent ? a : b) : null;

  const topRarity = Object.entries(RARITY_ORDER).sort((a, b) => a[1] - b[1])[0]?.[0] || "";
  const mythCompleted = SPRITES.filter(s => {
    const vl = Object.keys(s.variantDetails || {}).length ? Object.keys(s.variantDetails) : (s.variants || ["Base"]);
    return s.rarity === topRarity && vl.every(v => getEntry(variantId(s.id, v)).status === "owned");
  }).length;
  const mythTotal = SPRITES.filter(s => s.rarity === topRarity).length;

  const insights = [];
  if (bestRarity) {
    insights.push(renderInsight({
      tone: "best",
      icon: "◇",
      label: "Collection la plus avancée",
      value: `${bestRarity.label} — ${bestRarity.percent} %`,
      detail: `${bestRarity.owned} sur ${bestRarity.total} variantes réunies`
    }));
    insights.push(renderInsight({
      tone: "worst",
      icon: "★",
      label: "Collection la moins avancée",
      value: `${worstRarity.label} — ${worstRarity.percent} %`,
      detail: `${worstRarity.owned} sur ${worstRarity.total} variantes réunies`
    }));
  }

  if (worstVariant) {
    insights.push(renderInsight({
      tone: "variant",
      icon: "◎",
      label: "Variante la plus manquante",
      value: `${worstVariant.label} — ${worstVariant.owned}/${worstVariant.total}`,
      detail: `${Math.max(0, worstVariant.total - worstVariant.owned)} à découvrir`
    }));
  }

  insights.push(renderInsight({
    tone: "myth",
    icon: "♛",
    label: `${topRarity} complétés`,
    value: `${mythCompleted} / ${mythTotal}`,
    detail: mythTotal ? `${Math.round((mythCompleted / mythTotal) * 100)} % des Sprites ${topRarity.toLowerCase()}` : "Aucun Sprite concerné"
  }));
  insights.push(renderInsight({
    tone: "full",
    icon: "◈",
    label: "Sprites 100 % complétés",
    value: `${spritesCompleted} / ${SPRITES.length}`,
    detail: spritesCompleted ? "Toutes leurs variantes sont possédées" : "Votre prochain objectif de maîtrise"
  }));

  els.statsInsights.innerHTML = insights.join("");
  renderCommunityStats();
}
