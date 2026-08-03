// ── Shared profile : read-only public viewer ──
// Rendered when the app is opened with a "?share=<token>" link. Shows a
// read-only snapshot of another player's collection. No editing controls are
// wired up, and only data returned by the public /api/shared/:token endpoint
// (status + priority, no notes) is used.

function renderSharedProfile(data) {
  const items = getReleasedCollectionItems(getAllItems());
  const collection = sanitizeCollection(data.collection);
  const isOwned = (id) => (collection[id]?.status || "new") === "owned";

  const total = items.length;
  const ownedTotal = items.filter((i) => isOwned(i.id)).length;
  const pct = collectionPercent(ownedTotal, total);

  // Per-rarity breakdown (ordered like the rest of the app).
  const rarities = Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .map((rarity) => {
      const group = items.filter((i) => i.rarity === rarity);
      const owned = group.filter((i) => isOwned(i.id)).length;
      return { label: rarity, total: group.length, owned, pct: collectionPercent(owned, group.length) };
    })
    .filter((r) => r.total > 0);

  const ownedItems = items.filter((i) => isOwned(i.id));

  const avatarUrl = safeImageUrl(data.avatarUrl);
  const avatar = avatarUrl
    ? `<img src="${escapeHtml(avatarUrl)}" alt="" class="shared-view__avatar" />`
    : `<div class="shared-view__avatar shared-view__avatar--empty">?</div>`;

  const rarityBars = rarities
    .map(
      (r) => `
    <div class="shared-stat">
      <span class="shared-stat__label">${escapeHtml(r.label)}</span>
      <div class="shared-stat__bar"><div class="shared-stat__fill" style="width:${r.pct}%"></div></div>
      <span class="shared-stat__val">${r.owned}/${r.total}</span>
    </div>`
    )
    .join("");

  const grid = ownedItems.length
    ? ownedItems
        .map(
          (i) => `
        <div class="shared-card" title="${escapeHtml(i.spriteName)} · ${escapeHtml(i.variant)}">
          ${safeImageUrl(i.img) ? `<img src="${escapeHtml(safeImageUrl(i.img))}" alt="" class="shared-card__img" loading="lazy" />` : `<div class="shared-card__img shared-card__img--empty"></div>`}
          <span class="shared-card__name">${escapeHtml(i.spriteName)}</span>
          <span class="shared-card__variant">${escapeHtml(i.variant)}</span>
        </div>`
        )
        .join("")
    : `<p class="shared-view__empty">${t("shared.empty")}</p>`;

  const overlay = document.createElement("div");
  overlay.className = "shared-view";
  overlay.innerHTML = `
    <div class="shared-view__card">
      <div class="shared-view__header">
        ${avatar}
        <div class="shared-view__id">
          <h1 class="shared-view__name">${escapeHtml(data.username || t("shared.defaultPlayer"))}</h1>
          <p class="shared-view__sub">${t("shared.subtitle")}</p>
        </div>
      </div>

      <div class="shared-view__overall">
        <div class="shared-view__overall-top">
          <span class="shared-view__overall-pct">${pct}%</span>
          <span class="shared-view__overall-count">${ownedTotal} / ${total} sprites</span>
        </div>
        <div class="shared-view__overall-bar"><div class="shared-view__overall-fill" style="width:${pct}%"></div></div>
      </div>

      <div class="shared-view__section">
        <h2 class="shared-view__section-title">${t("shared.byRarity")}</h2>
        ${rarityBars}
      </div>

      <div class="shared-view__section">
        <h2 class="shared-view__section-title">${t("shared.ownedSprites", { count: ownedItems.length })}</h2>
        <div class="shared-view__grid">${grid}</div>
      </div>

      <a href="${webOrigin()}/" class="shared-view__cta">${t("shared.openApp")}</a>
      <p class="legal-disclaimer">${t("shared.disclaimerShort")}</p>
    </div>`;

  document.body.appendChild(overlay);
}

function renderSharedError() {
  const overlay = document.createElement("div");
  overlay.className = "shared-view";
  overlay.innerHTML = `
    <div class="shared-view__card shared-view__card--error">
      <h1 class="shared-view__name">${t("shared.errorTitle")}</h1>
      <p class="shared-view__sub">${t("shared.errorBody")}</p>
      <a href="${webOrigin()}/" class="shared-view__cta">${t("shared.openApp")}</a>
    </div>`;
  document.body.appendChild(overlay);
}
