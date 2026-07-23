function exportData() {
  const payload = {
    app: "SPRITNEX",
    version: 1,
    exportedAt: new Date().toISOString(),
    collection: state.collection
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spritedex-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Export JSON téléchargé");
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result));
      const imported = payload.collection ?? payload;
      if (!imported || typeof imported !== "object") throw new Error("Format invalide");
      state.collection = imported;
      persist();
      buildDeck();
      renderAll();
      toast("Import réussi");
    } catch (error) {
      toast("Import impossible : fichier JSON invalide");
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

  let lines = [`Il me manque ${notOwned.length} variantes.\n`];

  if (priority.length) {
    lines.push("PRIORITÉ HAUTE :");
    priority.forEach(item => lines.push(`- ${item.spriteName} ${item.variant}`));
    lines.push("");
  }

  const byVariant = {};
  for (const item of others) {
    if (!byVariant[item.variant]) byVariant[item.variant] = [];
    byVariant[item.variant].push(item);
  }
  for (const [v, items] of Object.entries(byVariant)) {
    lines.push(`${v.toUpperCase()} MANQUANTES :`);
    items.forEach(item => lines.push(`- ${item.spriteName} ${item.variant}`));
    lines.push("");
  }

  const text = lines.join("\n");
  navigator.clipboard?.writeText(text).then(
    () => toast("Liste copiée"),
    () => toast("Copie impossible sur ce navigateur")
  );
}
