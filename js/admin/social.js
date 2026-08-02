(() => {
  "use strict";

  async function loadSocial() {
    const q = ($("#squadSearch")?.value || state.social.q || "").trim();
    const join = $("#squadJoinFilter")?.value || state.social.join || "all";
    state.social.q = q;
    state.social.join = join;
    if ($("#squadSearch")) $("#squadSearch").value = q;
    if ($("#squadJoinFilter")) $("#squadJoinFilter").value = join;
    const params = new URLSearchParams({ page: String(state.social.page || 1), pageSize: "20", join });
    if (q) params.set("q", q);
    const data = await adminFetch(`/api/admin/social?${params}`);
    const s = data.summary || {};
    $("#socialKpis").innerHTML = [
      kpi(english ? "Squads" : "Squads", formatNumber(s.squads), `${formatNumber(s.open_join_squads)} ${english ? "open join" : "accès ouvert"} · ${formatNumber(s.active_members)} ${english ? "members" : "membres"}`),
      kpi(english ? "Activity · 24h" : "Activité · 24 h", formatNumber(s.activity24h), english ? "squad events" : "événements de squad"),
      kpi(english ? "Friendships" : "Amitiés", formatNumber(s.friendships), `${formatNumber(s.pending_friendships)} ${english ? "pending" : "en attente"}`, Number(s.pending_friendships) ? "warning" : ""),
      kpi(english ? "Squad invites" : "Invitations", formatNumber(s.pending_squad_invitations), english ? "pending" : "en attente", Number(s.pending_squad_invitations) ? "warning" : ""),
      kpi(english ? "Wishes / blocks" : "Souhaits / blocages", `${formatNumber(s.wanted_items)} / ${formatNumber(s.blocks)}`, english ? "wanted · safety" : "à trouver · sûreté", Number(s.blocks) ? "warning" : "")
    ].join("");
    const squads = data.squads || { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
    $("#squadsCount").textContent = `${formatNumber(squads.total)} ${english ? "squad(s)" : "squad(s)"}`;
    $("#squadsList").innerHTML = squads.items.length
      ? squads.items.map(squad => {
        const selected = String(state.social.selected) === String(squad.id) ? " is-selected" : "";
        const stale = !squad.last_activity_at || (Date.now() - new Date(squad.last_activity_at).getTime() > 30 * 24 * 60 * 60 * 1000);
        const riskyOpen = squad.join_open && Number(squad.member_count) >= 8;
        return `<tr class="admin-player-row${selected}" data-squad-id="${escapeHtml(squad.id)}">
          <td><strong>${escapeHtml(squad.name)}</strong><small>${escapeHtml(squad.code)} · ${escapeHtml(label(squad.visibility))}${squad.join_open ? ` · ${english ? "open" : "ouvert"}` : ` · ${english ? "closed" : "fermé"}`}${riskyOpen ? ` · ${english ? "review join" : "accès à surveiller"}` : ""}${stale ? ` · ${english ? "stale" : "inactive"}` : ""}</small></td>
          <td>${formatNumber(squad.member_count)}</td>
          <td>${formatNumber(squad.wanted_count)}</td>
          <td>${formatNumber(squad.pending_invite_count)}</td>
          <td>${formatDate(squad.last_activity_at)}${Number(squad.activity7d) ? `<small>${formatNumber(squad.activity7d)} / 7d</small>` : ""}</td>
          <td><div class="admin-row-actions">
            <button class="admin-row-button" type="button" data-open-squad="${escapeHtml(squad.id)}">${english ? "Open" : "Ouvrir"}</button>
            ${can("social.write") ? `<button class="admin-row-button ${squad.join_open ? "admin-row-button--danger" : ""}" type="button" data-squad-toggle="${escapeHtml(squad.id)}" data-squad-open="${squad.join_open ? "true" : "false"}" data-squad-name="${escapeHtml(squad.name || squad.code)}">${squad.join_open ? tr("close", "Fermer l’accès") : tr("open", "Ouvrir l’accès")}</button>` : ""}
          </div></td>
        </tr>`;
      }).join("")
      : `<tr><td colspan="6">${empty(english ? "No squad found." : "Aucune squad trouvée.")}</td></tr>`;
    renderPagination("#squadsPagination", squads, "social");
    $("#socialActivity").innerHTML = (data.activity24h || []).map(row => `<span class="admin-activity-chip">${escapeHtml(label(row.type))} · ${formatNumber(row.count)}</span>`).join("") || empty(english ? "No squad activity in 24h." : "Aucune activité squad sur 24 h.");
    $("#socialPendingInvites").innerHTML = (data.pendingInvites || []).length
      ? data.pendingInvites.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.invitee_username)}</strong> → ${escapeHtml(item.squad_name)} <small>@${escapeHtml(item.inviter_username)} · ${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-squad="${escapeHtml(item.squad_id)}">${english ? "Squad" : "Squad"}</button>${can("social.write") ? `<button class="admin-row-button admin-row-button--danger" type="button" data-cancel-invite="${escapeHtml(item.id)}" data-invite-label="@${escapeHtml(item.invitee_username)} → ${escapeHtml(item.squad_name)}">${english ? "Cancel" : "Annuler"}</button>` : ""}</div></div>`).join("")
      : empty(english ? "No pending invitations." : "Aucune invitation en attente.");
    $("#socialPendingFriends").innerHTML = (data.pendingFriendships || []).length
      ? data.pendingFriendships.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.requester_username)}</strong> → @${escapeHtml(item.addressee_username)}<small>${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.requester_id)}">${english ? "From" : "De"}</button><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.addressee_id)}">${english ? "To" : "Vers"}</button></div></div>`).join("")
      : empty(english ? "No pending friend requests." : "Aucune demande d’ami en attente.");
    $("#socialRecentBlocks").innerHTML = (data.recentBlocks || []).length
      ? data.recentBlocks.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.blocker_username)}</strong> → @${escapeHtml(item.blocked_username)}<small>${escapeHtml(item.reason || "—")} · ${formatDate(item.created_at)}</small></span><div class="admin-row-actions"><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.blocker_id)}">${english ? "Blocker" : "Bloqueur"}</button><button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.blocked_id)}">${english ? "Blocked" : "Bloqué"}</button></div></div>`).join("")
      : empty(english ? "No recent blocks." : "Aucun blocage récent.");
    if (state.social.selected) {
      try { await selectSquad(state.social.selected, { silent: true }); }
      catch (_) { state.social.selected = null; renderSquadDossierEmpty(); }
    } else {
      renderSquadDossierEmpty();
    }
  }

  function renderSquadDossierEmpty() {
    $("#squadDossier").innerHTML = `<p class="admin-empty">${escapeHtml(tr("squadPick", "Sélectionnez une squad pour voir membres, invitations, souhaits et activité."))}</p>`;
  }

  async function selectSquad(squadId, { silent = false } = {}) {
    state.social.selected = squadId;
    $("#squadsList")?.querySelectorAll("tr[data-squad-id]").forEach(node => {
      node.classList.toggle("is-selected", String(node.dataset.squadId) === String(squadId));
    });
    if (!silent) $("#squadDossier").innerHTML = empty(english ? "Loading squad details…" : "Chargement de la squad…");
    try {
      renderSquadDossier(await adminFetch(`/api/admin/social/squads/${encodeURIComponent(squadId)}`));
    } catch (error) {
      if (!silent) setAlert(error.message || tr("loadFailed"));
      throw error;
    }
  }

  function renderSquadDossier(data) {
    const squad = data.squad || {};
    const owner = data.owner;
    const members = data.members || [];
    const invitations = data.invitations || [];
    const wishlist = data.wishlist || [];
    const activity = data.activity || [];
    const openTone = squad.join_open ? "warning" : "good";
    const stale = !squad.last_activity_at || (Date.now() - new Date(squad.last_activity_at).getTime() > 30 * 24 * 60 * 60 * 1000);
    const riskyOpen = squad.join_open && Number(squad.member_count) >= 8;
    const signals = [];
    if (riskyOpen) signals.push(english ? "Public join is open on a large squad — review before leaving it open." : "L’accès public est ouvert sur une grande squad — à vérifier avant de le laisser ouvert.");
    if (stale) signals.push(english ? "No activity for more than 30 days." : "Aucune activité depuis plus de 30 jours.");
    if (Number(squad.pending_invite_count) > 0) signals.push(english ? `${formatNumber(squad.pending_invite_count)} pending invitation(s).` : `${formatNumber(squad.pending_invite_count)} invitation(s) en attente.`);
    $("#squadDossier").innerHTML = `
      <div class="admin-dossier__toolbar">
        <p class="admin-eyebrow">${english ? "SQUAD DOSSIER" : "FICHE SQUAD"}</p>
        <button class="admin-button admin-button--quiet" type="button" data-close-squad>${english ? "Close" : "Fermer"}</button>
      </div>
      <div class="admin-editor__header">
        <div>
          <h2>${escapeHtml(squad.name || "—")}</h2>
          <p class="admin-editor__id">${escapeHtml(squad.code || "")} · #${escapeHtml(squad.id)}</p>
        </div>
        ${status(squad.join_open ? (english ? "Join open" : "Accès ouvert") : (english ? "Join closed" : "Accès fermé"), openTone)}
      </div>
      <div class="admin-dossier__meta">
        <div class="admin-dossier__chip"><span>${english ? "Visibility" : "Visibilité"}</span><strong>${escapeHtml(label(squad.visibility))}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Owner" : "Créateur"}</span><strong>${owner ? `@${escapeHtml(owner.username)}` : "—"}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Members" : "Membres"}</span><strong>${formatNumber(squad.member_count)} ${english ? "active" : "actifs"}${Number(squad.inactive_member_count) ? ` · ${formatNumber(squad.inactive_member_count)} ${english ? "left" : "partis"}` : ""}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Wishes" : "Souhaits"}</span><strong>${formatNumber(squad.wanted_count)} ${english ? "wanted" : "à trouver"} · ${formatNumber(squad.found_count)} ${english ? "found" : "trouvés"}</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Activity" : "Activité"}</span><strong>${formatNumber(squad.activity24h)} / 24h · ${formatNumber(squad.activity7d)} / 7d</strong></div>
        <div class="admin-dossier__chip"><span>${english ? "Created" : "Créée"}</span><strong>${formatDate(squad.created_at, false)}</strong></div>
      </div>
      ${signals.map(signal => `<div class="admin-squad-signal">${escapeHtml(signal)}</div>`).join("")}
      <div class="admin-editor__footer">
        ${owner ? `<button class="admin-button admin-button--quiet" type="button" data-open-player="${escapeHtml(owner.id)}">${english ? "Open owner" : "Voir le créateur"}</button>` : ""}
        <button class="admin-button ${squad.join_open ? "admin-button--danger" : ""}" type="button" data-squad-toggle="${escapeHtml(squad.id)}" data-squad-open="${squad.join_open ? "true" : "false"}" data-squad-name="${escapeHtml(squad.name || squad.code)}">${squad.join_open ? tr("close", "Fermer l’accès") : tr("open", "Ouvrir l’accès")}</button>
      </div>
      <section class="admin-editor__section">
        <h3>${english ? "Members" : "Membres"} (${members.length})</h3>
        <div class="admin-status-list">${members.length ? members.map(member => {
          const suspended = member.suspended_until && new Date(member.suspended_until) > new Date();
          const deleted = !!member.deleted_at;
          return `<div class="admin-status-row"><span><strong>@${escapeHtml(member.username)}</strong><small>${escapeHtml(label(member.role))} · ${escapeHtml(label(member.status))}${suspended ? ` · ${english ? "suspended" : "suspendu"}` : ""}${deleted ? ` · ${english ? "deleted" : "supprimé"}` : ""} · ${english ? "active" : "actif"} ${formatDate(member.last_active_at)} · ${english ? "joined" : "depuis"} ${formatDate(member.joined_at, false)}</small></span><button class="admin-row-button" type="button" data-open-player="${escapeHtml(member.user_id)}">${english ? "Player" : "Joueur"}</button></div>`;
        }).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Invitations" : "Invitations"} (${invitations.length})</h3>
        <div class="admin-status-list">${invitations.length ? invitations.map(item => `<div class="admin-status-row"><span><strong>@${escapeHtml(item.invitee_username)}</strong><small>@${escapeHtml(item.inviter_username)} · ${escapeHtml(label(item.status))} · ${formatDate(item.created_at)}</small></span>${item.status === "pending" ? (can("social.write") ? `<button class="admin-row-button admin-row-button--danger" type="button" data-cancel-invite="${escapeHtml(item.id)}" data-invite-label="@${escapeHtml(item.invitee_username)}">${english ? "Cancel" : "Annuler"}</button>` : "") : `<button class="admin-row-button" type="button" data-open-player="${escapeHtml(item.invitee_id)}">${english ? "Player" : "Joueur"}</button>`}</div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Wishlist" : "Souhaits"} (${wishlist.length})</h3>
        <div class="admin-status-list">${wishlist.length ? wishlist.map(item => `<div class="admin-status-row"><span><strong>${escapeHtml(item.variant_id)}</strong><small>${escapeHtml(label(item.status))} · @${escapeHtml(item.created_by_username)}${item.assigned_to_username ? ` → @${escapeHtml(item.assigned_to_username)}` : ""}${item.found_by_username ? ` · ${english ? "found by" : "trouvé par"} @${escapeHtml(item.found_by_username)}` : ""}</small></span><strong>${formatDate(item.updated_at)}</strong></div>`).join("") : empty()}</div>
      </section>
      <section class="admin-editor__section">
        <h3>${english ? "Recent activity" : "Activité récente"} (${activity.length})</h3>
        <div class="admin-status-list">${activity.length ? activity.map(item => `<div class="admin-status-row"><span><strong>${escapeHtml(label(item.type || item.action))}</strong><small>${item.username ? `@${escapeHtml(item.username)} · ` : ""}${item.action && item.action !== item.type ? `${escapeHtml(label(item.action))} · ` : ""}${item.sprite_id ? `${escapeHtml(item.sprite_id)} · ` : ""}${formatDate(item.created_at)}</small></span><strong></strong></div>`).join("") : empty()}</div>
      </section>`;
  }

  Object.assign(window, { loadSocial, renderSquadDossierEmpty, selectSquad, renderSquadDossier });
})();
