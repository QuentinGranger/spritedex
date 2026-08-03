(() => {
  "use strict";

  async function loadCatalog() {
    const q = $("#catalogSearch").value.trim(),
      filter = $("#catalogState").value;
    if (!$("#catalogState option[value='data_issues']")) {
      $("#catalogState").insertAdjacentHTML(
        "beforeend",
        `<option value="data_issues">${english ? "Data issues" : "Données à corriger"}</option>`
      );
    }
    const params = new URLSearchParams({ page: String(state.catalog.page), pageSize: "20", status: filter });
    if (q) params.set("q", q);
    const data = await adminFetch(`/api/admin/catalog?${params}`);
    state.catalog.visibleItems = data.items;
    data.items.forEach((item) => state.catalog.bulkItems.set(item.id, item));
    $("#catalogCount").textContent = `${formatNumber(data.total)} ${english ? "sprite(s)" : "sprite(s)"}`;
    $("#catalogList").innerHTML = data.items.length
      ? data.items
          .map((sprite) => {
            const variants = Number(sprite.variantCount) || 0;
            const diagnostics = [
              variants
                ? `${variants} ${english ? "variants" : "variantes"}`
                : english
                  ? "Variant link missing"
                  : "Variantes à rattacher",
              Number(sprite.sameNameRecords) > 1
                ? english
                  ? `Potential duplicate ×${sprite.sameNameRecords}`
                  : `Doublon potentiel ×${sprite.sameNameRecords}`
                : ""
            ].filter(Boolean);
            const tone = variants ? "" : " is-attention";
            return `<div class="admin-catalog-select${tone}"><label><input type="checkbox" data-bulk-catalog-toggle="${escapeHtml(sprite.id)}" ${state.catalog.bulkIds.has(sprite.id) ? "checked" : ""} aria-label="${english ? "Select" : "Sélectionner"} ${escapeHtml(sprite.name)}" /></label><button class="admin-catalog-card ${state.catalog.selected === sprite.id ? "is-selected" : ""}" type="button" data-catalog-id="${escapeHtml(sprite.id)}"><span class="admin-catalog-card__image">${adminCatalogImage(sprite.image)}</span><span><strong>${escapeHtml(sprite.name)}</strong><small>${escapeHtml(sprite.id)} · ${escapeHtml(label(sprite.rarity))}</small></span><span class="admin-catalog-card__meta ${variants ? "" : "is-attention"}">${diagnostics.map((diagnostic) => `<small>${escapeHtml(diagnostic)}</small>`).join("")}</span></button></div>`;
          })
          .join("")
      : empty(tr("noCatalog", "Aucun sprite trouvé."));
    renderBulkBar("catalog");
    renderPagination("#catalogPagination", data, "catalog");
    if (state.catalog.selected && !data.items.some((item) => item.id === state.catalog.selected))
      state.catalog.selected = null;
    if (!state.catalog.selected) renderCatalogEmptyState(data);
  }

  function renderCatalogEmptyState(data) {
    const items = data.items || [];
    const withoutVariants = items.filter((item) => !(Number(item.variantCount) || 0)).length;
    const duplicateCandidates = items.filter((item) => Number(item.sameNameRecords) > 1).length;
    $("#catalogEditor").innerHTML =
      `<div class="admin-catalog-empty"><span class="admin-catalog-empty__icon" aria-hidden="true">✦</span><p class="admin-eyebrow">INSPECTEUR CATALOGUE</p><h2>${english ? "Choose a sprite to inspect" : "Choisissez un sprite à inspecter"}</h2><p>${english ? "Its visual, variants, availability and change history will appear here." : "Son visuel, ses variantes, disponibilités et son historique apparaîtront ici."}</p><div class="admin-catalog-empty__signals"><span><b>${formatNumber(withoutVariants)}</b>${english ? " without variant links on this page" : " sans variantes rattachées sur cette page"}</span><span><b>${formatNumber(duplicateCandidates)}</b>${english ? " potential duplicate(s)" : " doublon(s) potentiel(s)"}</span></div><button class="admin-button admin-button--quiet" type="button" data-catalog-show-issues>${english ? "Review data issues" : "Voir les données à corriger"}</button></div>`;
  }

  async function selectCatalog(spriteId) {
    state.catalog.selected = spriteId;
    $("#catalogList")
      .querySelectorAll("[data-catalog-id]")
      .forEach((node) => node.classList.toggle("is-selected", node.dataset.catalogId === spriteId));
    $("#catalogEditor").innerHTML = empty(english ? "Loading sprite details…" : "Chargement des détails du sprite…");
    try {
      renderCatalogEditor(await adminFetch(`/api/admin/catalog/${encodeURIComponent(spriteId)}`));
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  function renderBulkBar(kind) {
    const config =
      kind === "catalog"
        ? {
            state: state.catalog,
            ids: state.catalog.bulkIds,
            bar: "#catalogBulkBar",
            count: "#catalogBulkCount",
            hint: "#catalogBulkHint"
          }
        : {
            state: state.events,
            ids: state.events.bulkIds,
            bar: "#eventsBulkBar",
            count: "#eventsBulkCount",
            hint: "#eventsBulkHint",
            pageToggle: "#eventsBulkSelectPage"
          };
    const size = config.ids.size;
    $(config.bar).hidden = !size;
    $(config.count).textContent = english ? `${formatNumber(size)} selected` : `${formatNumber(size)} sélectionné(s)`;
    const visible = config.state.visibleItems || [];
    const visibleSelected = visible.filter((item) => config.ids.has(item.id)).length;
    if ($(config.hint))
      $(config.hint).textContent = english
        ? `${formatNumber(visibleSelected)} on this page · selection is retained between pages.`
        : `${formatNumber(visibleSelected)} sur cette page · la sélection est conservée entre les pages.`;
    if (config.pageToggle) {
      const toggle = $(config.pageToggle);
      toggle.checked = Boolean(visible.length) && visibleSelected === visible.length;
      toggle.indeterminate = visibleSelected > 0 && visibleSelected < visible.length;
    }
  }

  function toggleBulkPage(kind, checked) {
    const bucket = kind === "catalog" ? state.catalog : state.events;
    (bucket.visibleItems || []).forEach((item) => {
      bucket.bulkItems.set(item.id, item);
      if (checked) bucket.bulkIds.add(item.id);
      else bucket.bulkIds.delete(item.id);
    });
    $$(`[data-bulk-${kind === "catalog" ? "catalog" : "event"}-toggle]`).forEach((input) => {
      input.checked = checked;
    });
    renderBulkBar(kind);
  }

  function bulkPreviewItems(action) {
    const bucket = action.kind === "catalog" ? state.catalog : state.events;
    const key = action.kind === "catalog" ? "editorialStatus" : "data_status";
    return action.ids.map((id) => {
      const item = bucket.bulkItems.get(id) || { id, name: id };
      return { id, name: item.name || id, before: item[key] || (action.kind === "catalog" ? "published" : "unknown") };
    });
  }

  function openBulkAction(kind) {
    const ids =
      kind === "catalog"
        ? [...state.catalog.bulkIds]
        : kind === "events"
          ? [...state.events.bulkIds]
          : kind === "notifications"
            ? [...state.notifications.bulkIds]
            : kind === "collections"
              ? [...state.collections.bulkIds]
              : [];
    const count =
      kind === "notifications"
        ? ids.length || state.bulkData.failedNotifications
        : kind === "collections"
          ? ids.length || state.bulkData.repairableReferences
          : ids.length;
    if (!count) return;
    const statusValue =
      kind === "catalog" ? $("#catalogBulkStatus").value : kind === "events" ? $("#eventsBulkStatus").value : null;
    const statusName = label(statusValue);
    state.bulkAction = { kind, ids, status: statusValue };
    const preview =
      kind === "catalog" || kind === "events"
        ? bulkPreviewItems(state.bulkAction)
        : kind === "notifications" && ids.length
          ? ids.map((id) => ({ id, name: `#${id}`, before: "failed" }))
          : kind === "collections" && ids.length
            ? ids.map((id) => ({ id, name: `#${id}`, before: "mismatch" }))
            : [];
    const affected =
      preview.filter((item) => item.before !== statusValue).length ||
      (kind === "notifications" ? Math.min(50, count) : kind === "collections" ? count : 0);
    state.bulkAction.affected = affected;
    const copy =
      kind === "catalog"
        ? [
            english ? "Apply catalog workflow" : "Appliquer le workflow catalogue",
            english
              ? `${formatNumber(affected)} of ${formatNumber(count)} selected sprite(s) need this transition.`
              : `${formatNumber(affected)} sprite(s) sur ${formatNumber(count)} doivent réellement changer d’état.`,
            english
              ? "Each changed sprite receives its own history entry, so it can be restored individually from its catalog record."
              : "Chaque sprite modifié reçoit son propre historique : il peut être restauré individuellement depuis sa fiche catalogue."
          ]
        : kind === "events"
          ? [
              english ? "Update event data status" : "Mettre à jour l’état des événements",
              english
                ? `${formatNumber(affected)} of ${formatNumber(count)} selected event(s) need this update.`
                : `${formatNumber(affected)} événement(s) sur ${formatNumber(count)} doivent réellement être mis à jour.`,
              english
                ? "Only the data-status field changes. Dates, availability and published news remain untouched."
                : "Seul l’état des données change. Les dates, disponibilités et actualités publiées restent intactes."
            ]
          : kind === "notifications"
            ? [
                english ? "Retry failed deliveries" : "Relancer les livraisons en échec",
                english
                  ? `Up to ${formatNumber(Math.min(50, count))} failed delivery job(s) will be requeued.`
                  : `Jusqu’à ${formatNumber(Math.min(50, count))} job(s) en échec seront replacés dans la file.`,
                english
                  ? "Only failed or cancelled deliveries are retried; successful deliveries are never touched."
                  : "Seules les livraisons en échec ou annulées sont relancées ; les livraisons réussies ne sont jamais modifiées."
              ]
            : [
                english ? "Repair collection references" : "Réparer les références de collection",
                english
                  ? `${formatNumber(count)} inconsistent reference(s) will be safely aligned.`
                  : `${formatNumber(count)} référence(s) incohérente(s) seront réalignées de manière sûre.`,
                english
                  ? "Statuses, priorities and player notes are preserved. The repair is logged for audit."
                  : "Les statuts, priorités et notes des joueurs sont préservés. La réparation est journalisée."
              ];
    $("#bulkActionTitle").textContent = copy[0];
    $("#bulkActionSummary").textContent = copy[1];
    $("#bulkActionImpact").textContent = copy[2];
    $("#bulkActionPlan").innerHTML =
      `<span><b>${formatNumber(count)}</b><small>${english ? "selected" : "sélectionnés"}</small></span><span><b>${formatNumber(affected)}</b><small>${english ? "will change" : "vont changer"}</small></span><span><b>${escapeHtml(kind === "catalog" || kind === "events" ? statusName : english ? "safe" : "sûr")}</b><small>${english ? "target" : "cible"}</small></span>`;
    const itemsNode = $("#bulkActionItems");
    itemsNode.hidden = !preview.length;
    itemsNode.innerHTML = preview.length
      ? `<p>${english ? "Selection preview" : "Aperçu de la sélection"}</p><ul>${preview
          .slice(0, 6)
          .map(
            (item) =>
              `<li><span>${escapeHtml(item.name)}</span><small>${kind === "notifications" ? (english ? "retry delivery" : "relancer la livraison") : kind === "collections" ? (english ? "realign sprite reference" : "réaligner la référence sprite") : `${escapeHtml(label(item.before))} → ${escapeHtml(statusName)}`}</small></li>`
          )
          .join(
            ""
          )}${preview.length > 6 ? `<li class="admin-bulk-preview__more">+ ${formatNumber(preview.length - 6)} ${english ? "more" : "autre(s)"}</li>` : ""}</ul>`
      : "";
    const acknowledgement = $("#bulkActionAcknowledgeWrap");
    acknowledgement.hidden = kind === "collections";
    $("#bulkActionAcknowledge").checked = false;
    $("#bulkActionAcknowledgeTitle").textContent = english
      ? "I reviewed the exact impact."
      : "J’ai vérifié l’impact exact.";
    $("#bulkActionAcknowledgeHint").textContent =
      kind === "catalog"
        ? english
          ? "Changed sprites remain individually restorable from their history."
          : "Les sprites modifiés restent restaurables individuellement via leur historique."
        : english
          ? "The operation is applied immediately and recorded in the audit log."
          : "L’opération est appliquée immédiatement et inscrite au journal d’audit.";
    $("#bulkActionReason").value = "";
    $("#bulkActionError").hidden = true;
    $("#bulkActionProgress").hidden = true;
    $("#bulkActionSubmit").disabled = !affected;
    $("#bulkActionDialog").showModal();
    requestAnimationFrame(() => $("#bulkActionReason").focus());
  }

  function closeBulkAction(force = false) {
    if (!force && $("#bulkActionSubmit")?.dataset.running === "true") return;
    if ($("#bulkActionDialog")?.open) $("#bulkActionDialog").close();
    state.bulkAction = null;
  }

  async function submitBulkAction(event) {
    event.preventDefault();
    const action = state.bulkAction;
    if (!action) return;
    const reason = $("#bulkActionReason").value.trim(),
      errorNode = $("#bulkActionError");
    if (!reason) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    if (action.kind !== "collections" && !$("#bulkActionAcknowledge").checked) {
      errorNode.textContent = english
        ? "Confirm that you reviewed the impact before applying it."
        : "Confirmez avoir vérifié l’impact avant de l’appliquer.";
      errorNode.hidden = false;
      return;
    }
    const submit = $("#bulkActionSubmit");
    submit.disabled = true;
    submit.dataset.running = "true";
    $("#bulkActionCancel").disabled = true;
    $("#bulkActionClose").disabled = true;
    $("#bulkActionProgress").hidden = false;
    $("#bulkActionProgressLabel").textContent = english
      ? "Atomic update in progress — keep this window open."
      : "Mise à jour atomique en cours — gardez cette fenêtre ouverte.";
    try {
      const path =
        action.kind === "catalog"
          ? "/api/admin/catalog/bulk-workflow"
          : action.kind === "events"
            ? "/api/admin/events/bulk-status"
            : action.kind === "notifications"
              ? "/api/admin/notifications/retry-failed"
              : "/api/admin/collections/integrity/repair";
      const body =
        action.kind === "catalog"
          ? { spriteIds: action.ids, status: action.status, reason }
          : action.kind === "events"
            ? { eventIds: action.ids, dataStatus: action.status, reason }
            : action.kind === "notifications"
              ? { reason, limit: 50, jobIds: action.ids }
              : { action: "backfill-sprite-references", reason, entryIds: action.ids };
      const result = await adminFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const changed = Number(result.updated ?? result.retried ?? result.repaired ?? 0);
      if (action.kind === "catalog") state.catalog.bulkIds.clear();
      else if (action.kind === "events") state.events.bulkIds.clear();
      else if (action.kind === "notifications") state.notifications.bulkIds.clear();
      else if (action.kind === "collections") state.collections.bulkIds.clear();
      closeBulkAction(true);
      setNotice(
        english ? `${formatNumber(changed)} item(s) updated.` : `${formatNumber(changed)} élément(s) mis à jour.`
      );
      await loadTab(
        action.kind === "catalog"
          ? "catalog"
          : action.kind === "events"
            ? "events"
            : action.kind === "notifications"
              ? "notifications"
              : "collections",
        true
      );
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
      delete submit.dataset.running;
      $("#bulkActionCancel").disabled = false;
      $("#bulkActionClose").disabled = false;
      $("#bulkActionProgress").hidden = true;
    }
  }

  function renderCatalogEditor(data) {
    const sprite = data.sprite,
      variants = data.variants || [],
      availability = data.availabilityPeriods || [],
      history = data.history || [];
    const editorialStatus = sprite.editorial_status || (sprite.is_released === false ? "draft" : "published");
    const dataStatuses = ["complete", "verified", "incomplete", "unknown"];
    const statusOptions = (selected) =>
      dataStatuses
        .map(
          (option) =>
            `<option value="${option}" ${selected === option ? "selected" : ""}>${escapeHtml(label(option))}</option>`
        )
        .join("");
    const jsonField = (value) => escapeHtml(value == null ? "" : JSON.stringify(value, null, 2));
    $("#catalogEditor").innerHTML =
      `<div class="admin-editor__header"><div><p class="admin-eyebrow">SPRITE</p><h2>${escapeHtml(sprite.name)}</h2><p class="admin-editor__id">${escapeHtml(sprite.id)}</p></div>${stateBadge(sprite.data_status || tr("unknown"), sprite.data_status === "complete" || sprite.data_status === "verified" ? "good" : "warning")}</div>
      <section class="admin-workflow"><div><p class="admin-eyebrow">WORKFLOW ÉDITORIAL</p><strong>${escapeHtml(label(editorialStatus))}</strong><small>${sprite.editorial_updated_at ? formatDate(sprite.editorial_updated_at) : english ? "Legacy state" : "État existant"}</small></div>${can("catalog.write") ? `<div class="admin-workflow__actions"><button class="admin-row-button" type="button" data-catalog-workflow="draft" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "draft" ? "disabled" : ""}>${english ? "Draft" : "Brouillon"}</button><button class="admin-row-button" type="button" data-catalog-workflow="review" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "review" ? "disabled" : ""}>${english ? "Review" : "Relecture"}</button><button class="admin-row-button" type="button" data-catalog-workflow="published" data-sprite-id="${escapeHtml(sprite.id)}" ${editorialStatus === "published" ? "disabled" : ""}>${english ? "Publish" : "Publier"}</button></div>` : ""}</section>
      <section class="admin-catalog-preview"><div class="admin-catalog-preview__media">${adminCatalogImage(sprite.image)}</div><div><span>${english ? "Public preview" : "Prévisualisation publique"}</span><strong>${escapeHtml(sprite.name)}</strong><small>${escapeHtml(sprite.rarity || "—")} · ${escapeHtml(label(editorialStatus))}</small></div></section>
      ${
        can("catalog.write")
          ? `<form id="catalogEditForm">
        <div class="admin-editor__grid">
          <div class="admin-field"><label>${english ? "Name" : "Nom"}</label><input name="name" value="${escapeHtml(sprite.name)}" maxlength="100" required /></div>
          <div class="admin-field"><label>${english ? "Rarity" : "Rareté"}</label><input name="rarity" value="${escapeHtml(sprite.rarity || "")}" maxlength="30" /></div>
          <div class="admin-field"><label>${english ? "Color" : "Couleur"}</label><input name="color" value="${escapeHtml(sprite.color || "")}" maxlength="60" /></div>
          <div class="admin-field"><label>${english ? "Availability label" : "Libellé disponibilité"}</label><input name="available" value="${escapeHtml(sprite.available || "")}" maxlength="20" /></div>
          <div class="admin-field"><label>${english ? "Event id" : "Événement lié"}</label><input name="eventId" value="${escapeHtml(sprite.event_id || "")}" maxlength="100" /></div>
          <div class="admin-field"><label>${english ? "Season id" : "Saison"}</label><input name="seasonId" value="${escapeHtml(sprite.season_id || "")}" maxlength="50" /></div>
          <div class="admin-field"><label>${english ? "Data status" : "État des données"}</label><select name="dataStatus">${statusOptions(sprite.data_status)}</select></div>
          <div class="admin-field"><label>${english ? "Released" : "Publié"}</label><select name="isReleased"><option value="true" ${sprite.is_released !== false ? "selected" : ""}>${english ? "Yes" : "Oui"}</option><option value="false" ${sprite.is_released === false ? "selected" : ""}>${english ? "No" : "Non"}</option></select></div>
          <div class="admin-field"><label>${english ? "Last verified" : "Dernière vérif."}</label><input name="lastVerifiedAt" type="datetime-local" value="${toLocalInput(sprite.last_verified_at)}" /></div>
          <div class="admin-field admin-field--wide"><label>${english ? "Image URL" : "URL de l’image"}</label><input name="image" value="${escapeHtml(sprite.image || "")}" maxlength="2000" /></div>
          <div class="admin-field admin-field--wide"><label>${english ? "Effect / notes" : "Effet / notes"}</label><textarea name="effect" maxlength="2000" rows="3">${escapeHtml(sprite.effect || "")}</textarea></div>
          <details class="admin-editor__advanced admin-field--wide"><summary>${english ? "Identity, dates & collection" : "Identité, dates & collection"}</summary><div class="admin-editor__grid"><div class="admin-field"><label>Catalog ID</label><input name="catalogId" value="${escapeHtml(sprite.catalog_id || "")}" maxlength="50" /></div><div class="admin-field"><label>Slug</label><input name="slug" value="${escapeHtml(sprite.slug || "")}" maxlength="50" /></div><div class="admin-field"><label>${english ? "Official name" : "Nom officiel"}</label><input name="officialName" value="${escapeHtml(sprite.official_name || "")}" maxlength="100" /></div><div class="admin-field"><label>${english ? "Update introduced" : "Mise à jour d’introduction"}</label><input name="introducedInUpdate" value="${escapeHtml(sprite.introduced_in_update || "")}" maxlength="20" /></div><div class="admin-field"><label>${english ? "First observed" : "Première observation"}</label><input name="firstObservedAt" type="datetime-local" value="${toLocalInput(sprite.first_observed_at)}" /></div><div class="admin-field"><label>${english ? "Officially announced" : "Annonce officielle"}</label><input name="officiallyAnnouncedAt" type="datetime-local" value="${toLocalInput(sprite.officially_announced_at)}" /></div><div class="admin-field"><label>${english ? "Base summon cost" : "Coût d’invocation"}</label><input name="baseSummonCost" type="number" min="0" value="${escapeHtml(sprite.base_summon_cost ?? "")}" /></div><div class="admin-field"><label>${english ? "Catalog version" : "Version catalogue"}</label><input name="catalogVersion" value="${escapeHtml(sprite.catalog_version || "")}" maxlength="32" /></div></div></details>
          <details class="admin-editor__advanced admin-field--wide"><summary>${english ? "Structured data (JSON)" : "Données structurées (JSON)"}</summary><p>${english ? "Use valid JSON only. Empty values clear the corresponding optional field." : "Utilisez uniquement du JSON valide. Une valeur vide efface le champ optionnel correspondant."}</p><div class="admin-editor__grid"><div class="admin-field"><label>Variants (JSON array)</label><textarea name="variants" rows="5">${jsonField(sprite.variants)}</textarea></div><div class="admin-field"><label>Ability</label><textarea name="ability" rows="5">${jsonField(sprite.ability)}</textarea></div><div class="admin-field"><label>Acquisition</label><textarea name="acquisition" rows="5">${jsonField(sprite.acquisition)}</textarea></div><div class="admin-field"><label>Availability</label><textarea name="availability" rows="5">${jsonField(sprite.availability)}</textarea></div><div class="admin-field"><label>Recurrence</label><textarea name="recurrence" rows="5">${jsonField(sprite.recurrence)}</textarea></div><div class="admin-field"><label>Dates</label><textarea name="dates" rows="5">${jsonField(sprite.dates)}</textarea></div><div class="admin-field"><label>Missing fields</label><textarea name="missingFields" rows="5">${jsonField(sprite.missing_fields)}</textarea></div><div class="admin-field"><label>Notes</label><textarea name="notes" rows="5">${jsonField(sprite.notes)}</textarea></div><div class="admin-field"><label>Sources</label><textarea name="sources" rows="5">${jsonField(sprite.sources)}</textarea></div></div></details>
          <div class="admin-field admin-field--wide"><label>${english ? "Reason" : "Justification"}</label><input class="admin-editor__reason" name="reason" placeholder="${english ? "Required for traceability" : "Requise pour la traçabilité"}" maxlength="1000" required /></div>
        </div>
        <div class="admin-editor__footer"><button class="admin-button" type="submit">${english ? "Save changes" : "Enregistrer"}</button></div>
      </form>`
          : `<p class="admin-note">${english ? "Read-only catalog view for your role." : "Catalogue en lecture seule pour votre rôle."}</p>`
      }
      <section class="admin-editor__section"><h3>${english ? "Variants" : "Variantes"} (${variants.length})</h3><div class="admin-variant-list">${
        variants.length
          ? variants
              .map((variant) => {
                const variantWorkflow = variant.editorial_status || "published";
                const visual = variant.image_path || variant.suggested_image_path;
                const compatibility = variant.is_compatibility_variant === true;
                return `<div class="admin-variant ${compatibility ? "is-compatibility" : ""}"><span class="admin-variant__thumb">${adminCatalogImage(visual)}</span><span><strong>${escapeHtml(variant.name)}</strong><small>${escapeHtml(variant.variant_type)} · ${escapeHtml(label(variant.data_status || "unknown"))}${compatibility ? ` · ${english ? "seed reference" : "référence seed"}` : ` · ${escapeHtml(label(variantWorkflow))}`}${!adminImageUrl(visual) ? ` · ${english ? "image missing" : "image absente"}` : ""}</small></span>${can("catalog.write") && !compatibility ? `<div class="admin-row-actions"><button class="admin-row-button" type="button" data-variant-workflow="${variantWorkflow === "draft" ? "review" : variantWorkflow === "review" ? "published" : "draft"}" data-variant-id="${escapeHtml(variant.id)}">${variantWorkflow === "draft" ? (english ? "Send to review" : "Envoyer en relecture") : variantWorkflow === "review" ? (english ? "Publish" : "Publier") : english ? "Return to draft" : "Repasser en brouillon"}</button><button class="admin-row-button" type="button" data-edit-variant="${escapeHtml(variant.id)}" data-variant-name="${escapeHtml(variant.name)}" data-variant-rarity="${escapeHtml(variant.rarity || "")}" data-variant-image="${escapeHtml(variant.image_path || "")}" data-variant-release="${escapeHtml(variant.release_status || "")}" data-variant-status="${escapeHtml(variant.data_status || "unknown")}" data-variant-json="${escapeHtml(JSON.stringify(variant))}">${tr("edit", "Modifier")}</button></div>` : ""}</div>`;
              })
              .join("")
          : empty()
      }</div></section>
      <section class="admin-editor__section"><h3>${english ? "Availability" : "Disponibilités"} (${availability.length})</h3><div class="admin-status-list">${
        availability
          .slice(0, 6)
          .map(
            (period) =>
              `<div class="admin-status-row"><span>${escapeHtml(label(period.status))} · ${formatDate(period.start_date, false)} → ${formatDate(period.end_date, false)}${period.event_id ? ` · ${escapeHtml(period.event_id)}` : ""}</span><strong>${escapeHtml(label(period.confidence))}</strong></div>`
          )
          .join("") || empty()
      }</div>${can("catalog.write") ? `<div class="admin-editor__footer"><button class="admin-button admin-button--quiet" type="button" id="addAvailability" data-sprite-id="${escapeHtml(sprite.id)}" data-sprite-name="${escapeHtml(sprite.name)}">${english ? "Add availability" : "Ajouter une disponibilité"}</button></div>` : ""}</section>
      <section class="admin-editor__section"><h3>${english ? "Recent change history" : "Historique récent"}</h3><div class="admin-status-list">${
        history
          .slice(0, 5)
          .map(
            (item) =>
              `<div class="admin-status-row"><span><strong>${escapeHtml(item.field)}</strong><small>${escapeHtml(item.reason || "—")} · ${formatDate(item.changed_at)}</small></span>${can("catalog.write") && spriteEditableField(item.field) ? `<button class="admin-row-button" type="button" data-catalog-rollback="${escapeHtml(item.id)}" data-sprite-id="${escapeHtml(sprite.id)}">${english ? "Restore" : "Restaurer"}</button>` : ""}</div>`
          )
          .join("") || empty()
      }</div></section>`;
  }

  function spriteEditableField(field) {
    return [
      "name",
      "rarity",
      "color",
      "effect",
      "available",
      "image",
      "eventId",
      "seasonId",
      "dataStatus",
      "lastVerifiedAt",
      "isReleased",
      "editorialStatus"
    ].includes(field);
  }

  Object.assign(window, {
    loadCatalog,
    renderCatalogEmptyState,
    selectCatalog,
    renderBulkBar,
    toggleBulkPage,
    bulkPreviewItems,
    openBulkAction,
    closeBulkAction,
    submitBulkAction,
    renderCatalogEditor,
    spriteEditableField
  });
})();
