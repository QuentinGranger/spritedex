(() => {
  "use strict";

  async function loadCollections() {
    const data = await adminFetch("/api/admin/collections/integrity"), c = data.checks || {};
    state.bulkData.repairableReferences = Number(c.mismatchedSpriteReferences) || 0;
    state.collections.visibleItems = data.mismatchedEntries || [];
    state.collections.visibleItems.forEach((entry) => state.collections.bulkItems.set(String(entry.id), entry));
    $("#integrityKpis").innerHTML = [kpi(english ? "Orphaned entries" : "Entrées orphelines", formatNumber(c.orphanedEntries), english ? "unknown variant reference" : "référence de variante inconnue", Number(c.orphanedEntries) ? "danger" : ""), kpi(english ? "Mismatched references" : "Références incohérentes", formatNumber(c.mismatchedSpriteReferences), english ? "safe repair available" : "correction sûre disponible", Number(c.mismatchedSpriteReferences) ? "warning" : ""), kpi(english ? "Invalid statuses" : "Statuts invalides", formatNumber(c.invalidStatuses), english ? "requires manual review" : "révision manuelle requise", Number(c.invalidStatuses) ? "danger" : ""), kpi(english ? "Migration errors" : "Erreurs de migration", formatNumber(c.migrationErrors), english ? "historical imports" : "imports historiques", Number(c.migrationErrors) ? "warning" : "")].join("");
    $("#migrationErrors").innerHTML = data.latestMigrationErrors.length ? data.latestMigrationErrors.map(error => `<article class="admin-error"><strong>${escapeHtml(error.table_name)} · ${escapeHtml(error.original_key)}</strong><small>${escapeHtml(error.error || "—")} · ${formatDate(error.created_at)}</small></article>`).join("") : empty(tr("noErrors", "Aucune erreur de migration."));
    $("#integrityPassportQueue").innerHTML = data.passportQueue.length ? data.passportQueue.map(row => `<div class="admin-status-row"><span>${escapeHtml(label(row.status))}</span><strong>${formatNumber(row.count)}</strong></div>`).join("") : empty();
    const repairButton = $("#repairSpriteReferences");
    $("#integrityMismatchPreview")?.remove();
    if (repairButton && state.collections.visibleItems.length) {
      const selected = state.collections.bulkIds.size;
      const rows = state.collections.visibleItems.map((entry) => `<label class="admin-integrity-entry"><input type="checkbox" data-bulk-collection-toggle="${entry.id}" ${state.collections.bulkIds.has(String(entry.id)) ? "checked" : ""} /><span><strong>#${entry.id} · ${escapeHtml(entry.variant_id)}</strong><small>${entry.username ? `@${escapeHtml(entry.username)} · ` : ""}${escapeHtml(entry.current_sprite_id || "—")} → ${escapeHtml(entry.expected_sprite_id || "—")}</small></span></label>`).join("");
      repairButton.insertAdjacentHTML("afterend", `<div class="admin-integrity-preview" id="integrityMismatchPreview"><header><div><strong>${english ? "Repair a precise selection" : "Réparer une sélection précise"}</strong><small>${english ? "Choose individual entries, or repair every detected mismatch." : "Choisissez les entrées, ou corrigez toutes les incohérences détectées."}</small></div><div class="admin-inline-actions"><button class="admin-row-button" type="button" data-collection-select-page>${selected === state.collections.visibleItems.length ? (english ? "Clear shown" : "Effacer l’affichage") : (english ? "Select shown" : "Sélectionner l’affichage")}</button>${selected ? `<button class="admin-row-button" type="button" data-collection-bulk-apply>${english ? `Review ${formatNumber(selected)}` : `Vérifier ${formatNumber(selected)}`}</button>` : ""}</div></header><div class="admin-integrity-preview__list">${rows}</div></div>`);
    }
  }

  Object.assign(window, { loadCollections });
})();
