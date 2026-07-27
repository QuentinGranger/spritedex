// Étape 21 — Statistiques communautaires (Fortnite.GG / SPRITE-INDEX)
// Données statiques du catalogue : taux observés, légende, non sortis,
// classement des Sprites de base, et taux de possession communautaire.

const COMMUNITY_DROP_TABLE = [
  { name: "Water Sprite", rarity: "Rare", base: "0 %*", gold: "0,75 %", gummy: "0,62 %", galaxy: "0,50 %", holofoil: "0,25 %" },
  { name: "Earth Sprite", rarity: "Rare", base: "0 %*", gold: "0,75 %", gummy: "0,62 %", galaxy: "0,50 %", holofoil: "—" },
  { name: "Fire Sprite", rarity: "Rare", base: "0 %*", gold: "0,75 %", gummy: "0,62 %", galaxy: "0,50 %", holofoil: "0,25 %" },
  { name: "Fishy Sprite", rarity: "Rare", base: "0 %*", gold: "0,75 %", gummy: "0,62 %", galaxy: "0,50 %", holofoil: "—" },
  { name: "Air Sprite", rarity: "Rare", base: "0 %*", gold: "0,75 %", gummy: "0,62 %", galaxy: "0,50 %", holofoil: "0,25 %" },
  { name: "Duck Sprite", rarity: "Épique", base: "9 % ≈ 1/11", gold: "0,40 %", gummy: "0,30 %", galaxy: "0,16 %", holofoil: "—" },
  { name: "Ghost Sprite", rarity: "Épique", base: "9 % ≈ 1/11", gold: "0,40 %", gummy: "0,30 %", galaxy: "0,16 %", holofoil: "0,06 %" },
  { name: "Demon Sprite", rarity: "Épique", base: "9 % ≈ 1/11", gold: "0,40 %", gummy: "0,30 %", galaxy: "0,16 %", holofoil: "—" },
  { name: "King Sprite", rarity: "Épique", base: "9 % ≈ 1/11", gold: "0,40 %", gummy: "0,30 %", galaxy: "0,16 %", holofoil: "0,06 %" },
  { name: "Aura Sprite", rarity: "Épique", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "—" },
  { name: "Striker Sprite", rarity: "Épique", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "0,05 %" },
  { name: "Dream Sprite", rarity: "Légendaire", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "—" },
  { name: "Punk Sprite", rarity: "Légendaire", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "—" },
  { name: "Boss Sprite", rarity: "Légendaire", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "—" },
  { name: "Seven Sprite", rarity: "Légendaire", base: "6,98 % ≈ 1/14", gold: "0,31 %", gummy: "0,23 %", galaxy: "0,12 %", holofoil: "0,05 %" },
  { name: "Batman Sprite", rarity: "Mythique", base: "2,23 % ≈ 1/45", gold: "0,10 %", gummy: "0,07 %", galaxy: "0,04 %", holofoil: "0,01 %" },
  { name: "Grim Sprite", rarity: "Mythique", base: "0,09 % ≈ 1/1 111", gold: "0 %*", gummy: "0 %*", galaxy: "0 %*", holofoil: "—" },
  { name: "Zero Point Sprite", rarity: "Mythique", base: "0,00093 % ≈ 1/107 527", gold: "0,000041 %", gummy: "0,000031 %", galaxy: "0,000016 %", holofoil: "—" },
  { name: "Burnt Peanut", rarity: "Mythique", base: "0 %*", gold: "—", gummy: "—", galaxy: "—", holofoil: "—" },
  { name: "Vini Jr. Sprite", rarity: "Mythique", base: "0 %*", gold: "—", gummy: "—", galaxy: "—", holofoil: "—" }
];

const UNRELEASED_SPRITES = [
  { name: "Pollo Sprite", rarity: "Mythique", rate: "0 %", statusKey: "community.statusUnreleased" },
  { name: "John Wick Sprite", rarity: "Mythique", rate: "0 %", statusKey: "community.statusUnreleasedSimple" }
];

const BASE_SPRITE_RANKING = [
  { rank: 1, labelKey: "community.rankRarest", name: "Zero Point Sprite", rate: "0,00093 %" },
  { rank: 2, name: "Grim Sprite", rate: "0,09 %" },
  { rank: 3, name: "Batman Sprite", rate: "2,23 %" },
  { rank: 4, labelKey: "community.rankTied", names: ["Dream Sprite", "Punk Sprite", "Boss Sprite", "Seven Sprite"], rate: "6,98 %" },
  { rank: 4, labelKey: "community.rankTied", names: ["Aura Sprite", "Striker Sprite"], rate: "6,98 %" },
  { rank: 5, labelKey: "community.rankTied", names: ["Duck Sprite", "Ghost Sprite", "Demon Sprite", "King Sprite"], rate: "9 %" }
];

function formatCommunityPercent(rate) {
  return safePercentage(rate, 0).toLocaleString("fr-FR", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2
  });
}

function renderCommunityStats() {
  const container = document.getElementById("communityStats");
  if (!container) return;

  const escape = typeof escapeHtml === "function" ? escapeHtml : (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const tableRows = COMMUNITY_DROP_TABLE.map((row) => `
    <tr>
      <td class="community-table__name">${escape(row.name)}</td>
      <td>${escape(row.rarity)}</td>
      <td class="community-table__rate">${escape(row.base)}</td>
      <td class="community-table__rate">${escape(row.gold)}</td>
      <td class="community-table__rate">${escape(row.gummy)}</td>
      <td class="community-table__rate">${escape(row.galaxy)}</td>
      <td class="community-table__rate">${escape(row.holofoil)}</td>
    </tr>
  `).join("");

  const unreleasedRows = UNRELEASED_SPRITES.map((row) => `
    <tr>
      <td class="community-table__name">${escape(row.name)}</td>
      <td>${escape(row.rarity)}</td>
      <td class="community-table__rate">${escape(row.rate)}</td>
      <td>${escape(t(row.statusKey))}</td>
    </tr>
  `).join("");

  const rankingRows = BASE_SPRITE_RANKING.map((row) => {
    const names = row.names
      ? row.names.map((n) => escape(n)).join("<br>")
      : escape(row.name);
    const labelText = row.labelKey ? t(row.labelKey) : "";
    const label = labelText ? ` — ${escape(labelText)}` : "";
    return `
      <tr>
        <td class="community-table__rank">${row.rank}${label}</td>
        <td class="community-table__name">${names}</td>
        <td class="community-table__rate">${escape(row.rate)}</td>
      </tr>
    `;
  }).join("");

  container.innerHTML = `
    <div class="stats-module community-module">
      <h3 class="stats-module__title">${escape(t("community.dropTableTitle"))}</h3>
      <div class="community-table-wrapper">
        <table class="community-table">
          <thead>
            <tr>
              <th>Sprite</th>
              <th>${escape(t("community.thBaseRarity"))}</th>
              <th>Base</th>
              <th>Gold</th>
              <th>Gummy</th>
              <th>Galaxy</th>
              <th>Holofoil</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </div>

      <div class="community-legend">
        <p><strong>${escape(t("community.legendTitle"))}</strong></p>
        <ul>
          <li><span class="community-legend__dash">—</span>${escape(t("community.legendDash"))}</li>
          <li><span class="community-legend__zero">0 %*</span>${escape(t("community.legendZero"))}</li>
          <li>${escape(t("community.legendZeroNote"))}</li>
          <li>${escape(t("community.legendRates"))}</li>
          <li>${escape(t("community.legendVariants"))}</li>
        </ul>
      </div>

      <h4 class="community-subtitle">${escape(t("community.unreleasedTitle"))}</h4>
      <div class="community-table-wrapper">
        <table class="community-table community-table--unreleased">
          <thead>
            <tr>
              <th>Sprite</th>
              <th>${escape(t("community.thRarity"))}</th>
              <th>${escape(t("community.thRate"))}</th>
              <th>${escape(t("community.thStatus"))}</th>
            </tr>
          </thead>
          <tbody>
            ${unreleasedRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="stats-module community-module">
      <h3 class="stats-module__title">${escape(t("community.rankingTitle"))}</h3>
      <div class="community-table-wrapper">
        <table class="community-table community-table--ranking">
          <thead>
            <tr>
              <th>${escape(t("community.thRank"))}</th>
              <th>Sprite</th>
              <th>${escape(t("community.thObservedRate"))}</th>
            </tr>
          </thead>
          <tbody>
            ${rankingRows}
          </tbody>
        </table>
      </div>
    </div>

    <div class="stats-module community-module community-ownership">
      <h3 class="stats-module__title">${escape(t("community.ownershipTitle"))}</h3>
      <div id="communityOwnershipDetail">
        <p class="community-ownership__note">${escape(t("community.ownershipLoading"))}</p>
      </div>
    </div>
  `;
  loadCommunityOwnership();
  if (typeof renderSpriteIndexTrends === "function") {
    renderSpriteIndexTrends();
  }
}

function loadCommunityOwnership() {
  const detail = document.getElementById("communityOwnershipDetail");
  if (!detail) return;

  const escape = typeof escapeHtml === "function"
    ? escapeHtml
    : (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  fetch(`${API_BASE}/community-ownership`)
    .then((r) => {
      if (!r.ok) throw new Error("network");
      return r.json();
    })
    .then((data) => {
      const total = safeFiniteNumber(data.totalActive, 0, { min: 0, max: 100000000 });
      const rows = (data.sprites || [])
        .sort((a, b) => (b.ownershipRate || 0) - (a.ownershipRate || 0))
        .map((s) => `
          <tr>
            <td class="community-table__name">${escape(s.name || s.spriteId || "?")}</td>
            <td class="community-table__rate">${formatCommunityPercent(s.ownershipRate || 0)}</td>
            <td class="community-table__muted">${safeFiniteNumber(s.owners, 0, { min: 0, max: total || 100000000 })} / ${total}</td>
          </tr>
        `).join("");
      detail.innerHTML = `
        <p class="community-ownership__note">${escape(t("community.ownershipActive", { count: total }))}</p>
        <div class="community-table-wrapper">
          <table class="community-table">
            <thead>
              <tr>
                <th>Sprite</th>
                <th>${escape(t("community.thOwnedBy"))}</th>
                <th>${escape(t("community.thCollections"))}</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="community-ownership__note">${escape(t("community.ownershipDisclaimer"))}</p>
      `;
    })
    .catch((err) => {
      detail.innerHTML = `<p class="community-ownership__note">${escape(t("community.ownershipError"))}</p>`;
      console.error("[community-ownership]", err);
    });
}
