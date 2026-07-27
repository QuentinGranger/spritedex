function exportData() {
  const payload = {
    app: "SPRITE-INDEX",
    version: 1,
    exportedAt: new Date().toISOString(),
    collection: state.collection
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sprite-index-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("io.exportOk"));
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result));
      const imported = payload.collection ?? payload;
      if (!imported || typeof imported !== "object") throw new Error("Format invalide");
      state.collection = sanitizeCollection(imported);
      persist();
      // persist() with no spriteId only writes locally. Importing a JSON file
      // REPLACES the collection, so push it via replaceCollection() (/import) which
      // also removes server entries absent from the file — otherwise deletions in
      // the imported file would silently reappear from the cloud.
      if (state.userId && typeof replaceCollection === "function") {
        replaceCollection();
      }
      buildDeck();
      renderAll();
      toast(t("io.importOk"));
    } catch (error) {
      toast(t("io.importInvalid"));
    }
  };
  reader.readAsText(file);
}

function copyMissingList() {
  const allItems = getAllItems();
  const notOwned = allItems.filter(item => {
    return isCollectibleMissingStatus(getEntry(item.id).status);
  });

  const priority = notOwned.filter(item => getEntry(item.id).status === "priority");
  const others = notOwned.filter(item => getEntry(item.id).status !== "priority");

  let lines = [t("io.missingHeader", { count: notOwned.length })];

  if (priority.length) {
    lines.push(t("io.highPriorityHeader"));
    priority.forEach(item => lines.push(`- ${item.spriteName} ${item.variant}`));
    lines.push("");
  }

  const byVariant = createSafeRecord();
  for (const item of others) {
    if (!byVariant[item.variant]) byVariant[item.variant] = [];
    byVariant[item.variant].push(item);
  }
  for (const [v, items] of Object.entries(byVariant)) {
    lines.push(t("io.missingVariantHeader", { variant: v.toUpperCase() }));
    items.forEach(item => lines.push(`- ${item.spriteName} ${item.variant}`));
    lines.push("");
  }

  const text = lines.join("\n");
  navigator.clipboard?.writeText(text).then(
    () => toast(t("io.copyOk")),
    () => toast(t("io.copyUnsupported"))
  );
}
