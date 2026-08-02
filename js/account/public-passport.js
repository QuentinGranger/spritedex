(() => {
  "use strict";

async function openCollectorPassportByUsername(username, displayName = "") {
  if (!username) return;
  try {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport`, {
      headers: typeof authHeadersOnly === "function" ? authHeadersOnly() : {}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("passport.notAccessible"));
    const userId = data.user && (data.user.numericId || data.user.id);
    const name = displayName || (data.user && (data.user.displayName || data.user.username)) || username;
    if (state.userId && userId && String(userId).match(/^\d+$/) && typeof window.openCollectorPassport === "function") {
      await window.openCollectorPassport(userId, name);
      return;
    }
    renderPublicPassportOverlay(data);
  } catch (err) {
    toastError(err, "passport.unavailable");
    renderPublicPassportError(err.message);
  }
}

function renderPublicPassportOverlay(normalized) {
  document.querySelector(".public-passport-view")?.remove();
  const u = normalized.user || {};
  const p = normalized.passport || {};
  const stats = p.statistics || {};
  const overlay = document.createElement("div");
  overlay.className = "shared-view public-passport-view";
  const rate = stats.completionRateDisplay != null
    ? stats.completionRateDisplay
    : (stats.completionRate != null ? Math.round(stats.completionRate * 10) / 10 : null);
  const squad = p.primarySquad && !p.primarySquad.private ? p.primarySquad.name : null;
  const badge = p.featuredBadge ? p.featuredBadge.label : null;
  const actions = Array.isArray(normalized.actions) ? normalized.actions : [];
  let invitationPending = false;
  try { invitationPending = !!sessionStorage.getItem("sprite-index_pending_friend_invite"); } catch (_) { /* storage unavailable */ }
  const actionLabels = {
    view_public_collection: t("account.action.viewPublicCollection"),
    add_friend: t("account.action.addFriend"),
    compare_collections: t("account.action.compareCollections")
  };
  overlay.innerHTML = `
    <div class="shared-view__card">
      <div class="shared-view__header">
        <div class="shared-view__id">
          <p class="collector-passport__eyebrow">sprite-index</p>
          <h1 class="shared-view__name">${escapeHtml(u.displayName || u.username || t("shared.defaultPlayer"))}</h1>
          <p class="shared-view__sub">@${escapeHtml(u.username || "")} · ${t("account.passport.publicPassport")}</p>
          <p class="collector-passport__disclaimer">${t("account.passport.userDeclared")}</p>
        </div>
      </div>
      <div class="shared-view__overall">
        <div class="shared-view__overall-top">
          <span class="shared-view__overall-pct">${rate != null ? `${escapeHtml(String(rate))} %` : "—"}</span>
          <span class="shared-view__overall-count">${
            stats.ownedVariantCount != null && stats.releasedVariantCount != null
              ? t("account.passport.variantCount", { owned: stats.ownedVariantCount, total: stats.releasedVariantCount })
              : ""
          }</span>
        </div>
      </div>
      <div class="shared-view__section">
        ${squad ? `<p>${t("account.passport.squadLine", { name: escapeHtml(squad) })}</p>` : ""}
        ${badge ? `<p>${t("account.passport.badgeLine", { label: escapeHtml(badge) })}</p>` : ""}
        ${stats.completedEventCount != null ? `<p>${Number(stats.completedEventCount) === 1 ? t("account.passport.eventsShareOne") : t("account.passport.eventsShareMany", { count: stats.completedEventCount })}</p>` : ""}
      </div>
      <div class="collector-passport__actions public-passport-view__actions">
        ${actions.filter((a) => actionLabels[a]).map((a) =>
          `<button type="button" class="ghost-button" data-public-passport-action="${escapeHtml(a)}">${actionLabels[a]}</button>`
        ).join("")}
      </div>
      ${invitationPending ? `<p class="public-passport-view__invite">${t("passport.publicInviteHint")}</p>` : ""}
      <a href="${webOrigin()}/" class="shared-view__cta">${invitationPending ? t("passport.publicInviteCta") : t("account.passport.openApp")}</a>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll("[data-public-passport-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.publicPassportAction;
      const id = u.numericId;
      if (action === "add_friend") {
        if (!state.userId) { toast(t("account.loginToAddFriend")); return; }
        if (typeof sendFriendRequest === "function" && id) await sendFriendRequest(id);
      } else if (action === "compare_collections") {
        if (!state.userId) { toast(t("account.loginToCompare")); return; }
        if (typeof compareWithFriend === "function" && id) {
          await compareWithFriend(id, u.displayName || u.username, { source: "passport" });
        }
      } else if (action === "view_public_collection") {
        toast(t("account.visibleViaPassport"));
      }
    });
  });
}

function renderPublicPassportError(message) {
  document.querySelector(".public-passport-view")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "shared-view public-passport-view";
  overlay.innerHTML = `
    <div class="shared-view__card shared-view__card--error">
      <h1 class="shared-view__name">${escapeHtml(t("passport.unavailable"))}</h1>
      <p class="shared-view__sub">${escapeHtml(message ? t(message) : t("passport.notAccessibleBody"))}</p>
      <a href="${webOrigin()}/" class="shared-view__cta">${t("account.passport.openApp")}</a>
    </div>`;
  document.body.appendChild(overlay);
}

window.openCollectorPassportByUsername = openCollectorPassportByUsername;
window.renderPublicPassportOverlay = renderPublicPassportOverlay;
window.renderPublicPassportError = renderPublicPassportError;

function getNotifPref(_key) {
  // Legacy helper — contextual prefs live on the server (Étape 49).
  return true;
}
})();
