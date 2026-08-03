function renderBars(container, rows) {
  container.innerHTML = rows
    .map(
      (row) => `
      <div class="bar-row" data-progress="${row.percent}" aria-label="${escapeHtml(t("stats.barAriaRow", { label: row.label, owned: row.owned, total: row.total, percent: row.percent }))}">
        <div class="bar-meta">
          <span class="bar-meta__label">${escapeHtml(row.icon || "◇")} ${escapeHtml(row.label)}</span>
          <span class="bar-meta__value">${row.owned}/${row.total} · ${row.percent}%</span>
        </div>
        <div class="bar-track" role="progressbar" aria-label="${escapeHtml(t("stats.barAriaProgress", { label: row.label }))}" aria-valuemin="0" aria-valuemax="${row.total}" aria-valuenow="${row.owned}" aria-valuetext="${escapeHtml(t("stats.barAriaValuetext", { owned: row.owned, total: row.total, percent: row.percent }))}"><div class="bar-fill" style="--bar:${row.percent}%"></div></div>
      </div>
    `
    )
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
  const catalogueItems = getAllItems();
  const items = getReleasedCollectionItems(catalogueItems);
  const metrics = getCollectionMetrics(catalogueItems);
  const totalVariants = metrics.releasedTotal;
  const ownedVariants = metrics.owned;
  const pct = metrics.percent;

  const circumference = 327;
  const offset = circumference - (circumference * pct) / 100;
  if (els.statsRingCircle) els.statsRingCircle.style.strokeDashoffset = offset;
  if (els.statsHeroPct) els.statsHeroPct.textContent = `${pct}%`;
  if (els.statsHeroDetail)
    els.statsHeroDetail.textContent = t("stats.heroDetail", { owned: ownedVariants, total: totalVariants });
  const remainingVariants = Math.max(0, totalVariants - ownedVariants);
  if (els.statsHeroRemaining) els.statsHeroRemaining.textContent = remainingVariants;
  if (els.statsHeroSupport) {
    els.statsHeroSupport.textContent = remainingVariants
      ? t("stats.heroRemaining", { count: remainingVariants, plural: remainingVariants > 1 ? "s" : "" })
      : t("stats.heroComplete");
  }

  const releasedBySprite = new Map();
  items.forEach((item) => {
    const list = releasedBySprite.get(String(item.spriteId)) || [];
    list.push(item);
    releasedBySprite.set(String(item.spriteId), list);
  });
  const spritesCompleted = [...releasedBySprite.values()].filter((variants) =>
    variants.every((item) => getEntry(item.id).status === "owned")
  ).length;
  const spritesPartial = [...releasedBySprite.values()].filter((variants) =>
    variants.some((item) => getEntry(item.id).status === "owned")
  ).length;
  els.kpiSprites.textContent = `${spritesPartial} / ${releasedBySprite.size}`;
  els.kpiVariants.textContent = `${ownedVariants} / ${totalVariants}`;
  if (els.kpiSpritesHint) {
    els.kpiSpritesHint.textContent = spritesCompleted
      ? t("stats.kpiSpritesCompleted", { count: spritesCompleted, plural: spritesCompleted > 1 ? "s" : "" })
      : t("stats.kpiSpritesNone");
  }
  if (els.kpiVariantsHint) els.kpiVariantsHint.textContent = t("stats.kpiVariantsHint", { pct });

  const prioritiesLeft = items.filter((i) => {
    const e = getEntry(i.id);
    return e.priority && e.priority !== "none" && e.priority !== "ignored" && isCollectibleMissingStatus(e.status);
  }).length;
  els.kpiPriorities.textContent = prioritiesLeft;
  if (els.kpiPrioritiesHint) {
    els.kpiPrioritiesHint.textContent = prioritiesLeft
      ? t("stats.kpiPrioritiesHint", { count: prioritiesLeft, plural: prioritiesLeft > 1 ? "s" : "" })
      : t("stats.kpiPrioritiesNone");
  }

  const rarities = Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .map((rarity) => {
      const group = items.filter((i) => i.rarity === rarity);
      const owned = group.filter((i) => getEntry(i.id).status === "owned").length;
      return {
        label: localizedRarity(rarity),
        icon: { Mythique: "♛", Légendaire: "★", Épique: "◆", Rare: "◇" }[rarity] || "◇",
        total: group.length,
        owned,
        percent: collectionPercent(owned, group.length)
      };
    })
    .filter((row) => row.total > 0);

  const variants = Object.keys(VARIANT_META)
    .map((variant) => {
      const group = items.filter((i) => i.variant === variant);
      const owned = group.filter((i) => getEntry(i.id).status === "owned").length;
      return {
        label: VARIANT_META[variant]?.label || variant,
        icon: "▱",
        total: group.length,
        owned,
        percent: collectionPercent(owned, group.length)
      };
    })
    .filter((row) => row.total > 0);

  renderBars(els.rarityBars, rarities);
  renderBars(els.variantBars, variants);

  const bestRarity = rarities.length ? rarities.reduce((a, b) => (a.percent >= b.percent ? a : b)) : null;
  const worstRarity = rarities.length ? rarities.reduce((a, b) => (a.percent <= b.percent ? a : b)) : null;
  const worstVariant = variants.length ? variants.reduce((a, b) => (a.percent <= b.percent ? a : b)) : null;

  const topRarity = Object.entries(RARITY_ORDER).sort((a, b) => a[1] - b[1])[0]?.[0] || "";
  const topRaritySprites = [...releasedBySprite.entries()].filter(
    ([spriteId, variants]) => variants[0]?.rarity === topRarity && spriteId
  );
  const mythCompleted = topRaritySprites.filter(([, variants]) =>
    variants.every((item) => getEntry(item.id).status === "owned")
  ).length;
  const mythTotal = topRaritySprites.length;

  const insights = [];
  if (bestRarity) {
    insights.push(
      renderInsight({
        tone: "best",
        icon: "◇",
        label: t("stats.bestRarityLabel"),
        value: `${bestRarity.label} — ${bestRarity.percent} %`,
        detail: t("stats.variantsCollected", { owned: bestRarity.owned, total: bestRarity.total })
      })
    );
    insights.push(
      renderInsight({
        tone: "worst",
        icon: "★",
        label: t("stats.worstRarityLabel"),
        value: `${worstRarity.label} — ${worstRarity.percent} %`,
        detail: t("stats.variantsCollected", { owned: worstRarity.owned, total: worstRarity.total })
      })
    );
  }

  if (worstVariant) {
    insights.push(
      renderInsight({
        tone: "variant",
        icon: "◎",
        label: t("stats.worstVariantLabel"),
        value: `${worstVariant.label} — ${worstVariant.owned}/${worstVariant.total}`,
        detail: t("stats.variantsToDiscover", { count: Math.max(0, worstVariant.total - worstVariant.owned) })
      })
    );
  }

  insights.push(
    renderInsight({
      tone: "myth",
      icon: "♛",
      label: t("stats.mythCompleted", { rarity: topRarity }),
      value: `${mythCompleted} / ${mythTotal}`,
      detail: mythTotal
        ? t("stats.mythPercent", { pct: collectionPercent(mythCompleted, mythTotal), rarity: topRarity.toLowerCase() })
        : t("stats.mythNone")
    })
  );
  insights.push(
    renderInsight({
      tone: "full",
      icon: "◈",
      label: t("stats.fullLabel"),
      value: `${spritesCompleted} / ${SPRITES.length}`,
      detail: spritesCompleted ? t("stats.fullAllVariants") : t("stats.fullNextGoal")
    })
  );

  els.statsInsights.innerHTML = insights.join("");
  renderCommunityStats();
}
