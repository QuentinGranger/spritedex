(() => {
  "use strict";

  async function saveCatalogForm(form) {
    const data = Object.fromEntries(new FormData(form));
    data.isReleased = data.isReleased === "true";
    if (!data.lastVerifiedAt) data.lastVerifiedAt = "";
    const id = state.catalog.selected;
    if (!id) return;
    await request(`/api/admin/catalog/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates: data, reason: data.reason })
    }, { refresh: "catalog" });
    await selectCatalog(id);
  }

  async function setCatalogWorkflow(button) {
    const reason = await requestReason(english ? "Why change this editorial status?" : "Pourquoi changer ce statut éditorial ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/${encodeURIComponent(button.dataset.spriteId)}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editorialStatus: button.dataset.catalogWorkflow, reason }) }, { refresh: "catalog" });
    if (result) await selectCatalog(button.dataset.spriteId);
  }

  async function rollbackCatalogHistory(button) {
    const reason = await requestReason(english ? "Why restore this previous catalog value?" : "Pourquoi restaurer cette valeur précédente ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/${encodeURIComponent(button.dataset.spriteId)}/history/${encodeURIComponent(button.dataset.catalogRollback)}/rollback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) }, { refresh: "catalog" });
    if (result) await selectCatalog(button.dataset.spriteId);
  }

  async function setVariantWorkflow(button) {
    const reason = await requestReason(english ? "Why change this variant editorial status?" : "Pourquoi changer ce statut éditorial de variante ?");
    if (!reason) return;
    const result = await request(`/api/admin/catalog/variants/${encodeURIComponent(button.dataset.variantId)}/workflow`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editorialStatus: button.dataset.variantWorkflow, reason }) }, { refresh: "catalog" });
    if (result && state.catalog.selected) await selectCatalog(state.catalog.selected);
  }
  function closeEditorialDialog(id) {
    const dialog = $(id);
    if (dialog?.open) dialog.close();
  }

  Object.assign(window, { saveCatalogForm, setCatalogWorkflow, rollbackCatalogHistory, setVariantWorkflow, closeEditorialDialog });
})();
