let squadWishlistData = null;

function wishlistItemLabel(variantId) {
  const item = getAllItems().find(candidate => String(candidate.id) === String(variantId));
  return item ? `${item.spriteName} · ${item.variant}` : variantId;
}

function wishlistOptions() {
  return getAllItems().filter(item => getEntry(item.id).status !== "owned")
    .slice(0, 300)
    .map(item => `<option value="${escapeHtml(String(item.id))}">${escapeHtml(`${item.spriteName} · ${item.variant}`)}</option>`).join("");
}

function renderSquadWishlist() {
  const mount = document.getElementById("squadWishlist");
  if (!mount) return;
  if (!state.activeSquad || !squadWishlistData) { mount.innerHTML = ""; return; }
  const items = squadWishlistData.items || [];
  const members = squadWishlistData.members || [];
  const active = items.filter(item => item.status === "wanted");
  const uncovered = active.filter(item => item.coverage === "uncovered").length;
  const duplicates = active.filter(item => item.coverage === "duplicate").length;
  mount.innerHTML = `<header class="squad-wishlist__header"><div><p class="eyebrow">${escapeHtml(t("wishlist.eyebrow"))}</p><h3>${escapeHtml(t("wishlist.title"))}</h3><p>${escapeHtml(t("wishlist.summary", { active: active.length, uncovered, duplicates }))}</p></div></header>
    <form class="squad-wishlist__add" id="squadWishlistAdd"><select name="variantId" aria-label="${escapeHtml(t("wishlist.addAria"))}"><option value="">${escapeHtml(t("wishlist.choose"))}</option>${wishlistOptions()}</select><button class="ghost-button" type="submit">${escapeHtml(t("wishlist.add"))}</button></form>
    <div class="squad-wishlist__list">${items.length ? items.map(item => {
      const coverage = item.coverage === "duplicate" ? t("wishlist.duplicate", { count: item.ownerCount }) : item.coverage === "covered" ? t("wishlist.covered") : t("wishlist.uncovered");
      return `<article class="wishlist-row wishlist-row--${escapeHtml(item.coverage)} ${item.status === "found" ? "is-found" : ""}"><div class="wishlist-row__main"><strong>${escapeHtml(wishlistItemLabel(item.variantId))}</strong><span class="wishlist-row__coverage">${escapeHtml(coverage)}</span></div><label class="wishlist-row__assign"><span>${escapeHtml(t("wishlist.assigned"))}</span><select data-wishlist-assign="${escapeHtml(item.id)}"><option value="">${escapeHtml(t("wishlist.unassigned"))}</option>${members.map(member => `<option value="${escapeHtml(member.userId)}" ${String(member.userId) === String(item.assignedTo) ? "selected" : ""}>${escapeHtml(member.username)}</option>`).join("")}</select></label><div class="wishlist-row__actions">${item.assignedName ? `<span class="wishlist-row__owner">${escapeHtml(item.assignedName)}</span>` : ""}<button class="ghost-button" type="button" data-wishlist-found="${escapeHtml(item.id)}" ${item.status === "found" ? "disabled" : ""}>${escapeHtml(item.status === "found" ? t("wishlist.foundBy", { name: item.foundName || "—" }) : t("wishlist.markFound"))}</button></div></article>`;
    }).join("") : `<p class="squad-empty">${escapeHtml(t("wishlist.empty"))}</p>`}</div>`;
}

async function loadSquadWishlist(code = state.activeSquad) {
  if (!code || !state.userId) return;
  try {
    const response = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/wishlist`, { headers: authHeaders() });
    if (!response.ok) return;
    squadWishlistData = await response.json();
    renderSquadWishlist();
  } catch (_) { /* The squad itself remains usable when this optional view is unavailable. */ }
}

async function updateSquadWishlist(itemId, patch) {
  const response = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/wishlist/${encodeURIComponent(itemId)}`, {
    method: "PATCH", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(patch)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return toast(data.error || t("common.networkError"));
  squadWishlistData = data;
  renderSquadWishlist();
}

function setupSquadWishlistEvents() {
  const mount = document.getElementById("squadWishlist");
  if (!mount) return;
  mount.addEventListener("submit", async (event) => {
    if (event.target.id !== "squadWishlistAdd") return;
    event.preventDefault();
    const variantId = new FormData(event.target).get("variantId");
    if (!variantId) return;
    const response = await fetch(`${API_BASE}/squads/${encodeURIComponent(state.activeSquad)}/wishlist`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ variantId }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data.error || t("common.networkError"));
    squadWishlistData = data;
    renderSquadWishlist();
  });
  mount.addEventListener("change", (event) => {
    const select = event.target.closest("[data-wishlist-assign]");
    if (select) updateSquadWishlist(select.dataset.wishlistAssign, { assignedTo: select.value || null });
  });
  mount.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wishlist-found]");
    if (button) updateSquadWishlist(button.dataset.wishlistFound, { status: "found" });
  });
}
