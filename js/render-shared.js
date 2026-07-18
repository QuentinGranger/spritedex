// ── Shared profile : read-only public viewer ──
// Rendered when the app is opened with a "?share=<token>" link. Shows a
// read-only snapshot of another player's collection. No editing controls are
// wired up, and only data returned by the public /api/shared/:token endpoint
// (status + priority, no notes) is used.

function renderSharedProfile(data) {
  const items = getAllItems();
  const collection = data.collection || {};
  const isOwned = (id) => (collection[id]?.status || "new") === "owned";

  const total = items.length;
  const ownedTotal = items.filter(i => isOwned(i.id)).length;
  const pct = total ? Math.round((ownedTotal / total) * 100) : 0;

  // Per-rarity breakdown (ordered like the rest of the app).
  const rarities = Object.keys(RARITY_ORDER)
    .sort((a, b) => RARITY_ORDER[a] - RARITY_ORDER[b])
    .map(rarity => {
      const group = items.filter(i => i.rarity === rarity);
      const owned = group.filter(i => isOwned(i.id)).length;
      return { label: rarity, total: group.length, owned, pct: group.length ? Math.round((owned / group.length) * 100) : 0 };
    })
    .filter(r => r.total > 0);

  const ownedItems = items.filter(i => isOwned(i.id));

  const avatar = data.avatarUrl
    ? `<img src="${encodeURI(data.avatarUrl)}" alt="" class="shared-view__avatar" />`
    : `<div class="shared-view__avatar shared-view__avatar--empty">?</div>`;

  const rarityBars = rarities.map(r => `
    <div class="shared-stat">
      <span class="shared-stat__label">${escapeHtml(r.label)}</span>
      <div class="shared-stat__bar"><div class="shared-stat__fill" style="width:${r.pct}%"></div></div>
      <span class="shared-stat__val">${r.owned}/${r.total}</span>
    </div>`).join("");

  const grid = ownedItems.length
    ? ownedItems.map(i => `
        <div class="shared-card" title="${escapeHtml(i.spriteName)} · ${escapeHtml(i.variant)}">
          ${i.img ? `<img src="${encodeURI(i.img)}" alt="" class="shared-card__img" loading="lazy" />` : `<div class="shared-card__img shared-card__img--empty"></div>`}
          <span class="shared-card__name">${escapeHtml(i.spriteName)}</span>
          <span class="shared-card__variant">${escapeHtml(i.variant)}</span>
        </div>`).join("")
    : `<p class="shared-view__empty">Aucun sprite possédé pour le moment.</p>`;

  const overlay = document.createElement("div");
  overlay.className = "shared-view";
  overlay.innerHTML = `
    <div class="shared-view__card">
      <div class="shared-view__header">
        ${avatar}
        <div class="shared-view__id">
          <h1 class="shared-view__name">${escapeHtml(data.username || "Joueur")}</h1>
          <p class="shared-view__sub">Collection partagée · lecture seule</p>
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
        <h2 class="shared-view__section-title">Par rareté</h2>
        ${rarityBars}
      </div>

      <div class="shared-view__section">
        <h2 class="shared-view__section-title">Sprites possédés (${ownedItems.length})</h2>
        <div class="shared-view__grid">${grid}</div>
      </div>

      <a href="${location.origin}/" class="shared-view__cta">Ouvrir SPRITNEX</a>
      <p class="legal-disclaimer">SPRITNEX est une application non officielle. Non affiliée à Epic Games. Fortnite est une marque d'Epic Games.</p>
    </div>`;

  document.body.appendChild(overlay);
}

function renderSharedError() {
  const overlay = document.createElement("div");
  overlay.className = "shared-view";
  overlay.innerHTML = `
    <div class="shared-view__card shared-view__card--error">
      <h1 class="shared-view__name">Lien indisponible</h1>
      <p class="shared-view__sub">Ce lien de partage est invalide ou a été révoqué par son propriétaire.</p>
      <a href="${location.origin}/" class="shared-view__cta">Ouvrir SPRITNEX</a>
    </div>`;
  document.body.appendChild(overlay);
}
