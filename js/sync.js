const SYNC_QUEUE_KEY = "sprite-index_sync_queue";
let syncTimer = null;
let syncInFlight = false;

function getSyncQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((key) => isSafeRecordKey(key)).slice(-1000) : [];
  } catch {
    return [];
  }
}

function saveSyncQueue(queue) {
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify([...new Set(queue)]));
}

function addToSyncQueue(spriteId) {
  const queue = getSyncQueue();
  if (!queue.includes(spriteId)) queue.push(spriteId);
  saveSyncQueue(queue);
}

// ── Local first, cloud second ──
async function persist(spriteId) {
  // 1. Local save — immediate, always works
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collection));
  localStorage.setItem("sprite-index_last_local_save", new Date().toISOString());

  if (!state.userId) {
    updateSyncStatus();
    return;
  }
  if (!spriteId || spriteId.startsWith("fav_")) return;

  // Never wait for a request doomed by an offline device. The exact variant id
  // is retained locally and replayed as soon as connectivity comes back.
  if (!navigator.onLine) {
    addToSyncQueue(spriteId);
    updateSyncStatus();
    return;
  }

  // 2. Cloud save — fire and retry on failure
  const entry = state.collection[spriteId];
  if (!entry) return;
  try {
    const res = await fetch(`${API_BASE}/collection/${state.userId}/${encodeURIComponent(spriteId)}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        status: entry.status,
        note: entry.note,
        priority: entry.priority,
        masteryLevel: entry.masteryLevel,
        obtainedAt: entry.obtainedAt
      })
    });
    if (!res.ok) throw new Error(res.status);
    syncErrorState = false;
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    updateSyncStatus();
  } catch (e) {
    console.warn("Cloud save failed, queued:", spriteId, e);
    addToSyncQueue(spriteId);
    scheduleSyncRetry();
    updateSyncStatus();
  }
}

// ── Retry queued items ──
function scheduleSyncRetry() {
  if (syncTimer) return;
  syncTimer = setTimeout(() => {
    syncTimer = null;
    flushSyncQueue();
  }, 5000);
}

async function flushSyncQueue() {
  if (!state.userId || syncInFlight) return;
  if (!navigator.onLine) {
    updateSyncStatus();
    return;
  }
  const queue = getSyncQueue();
  if (queue.length === 0) return;

  syncInFlight = true;
  const failed = [];
  for (const spriteId of queue) {
    const entry = state.collection[spriteId];
    if (!entry || spriteId.startsWith("fav_")) continue;
    try {
      const res = await fetch(`${API_BASE}/collection/${state.userId}/${encodeURIComponent(spriteId)}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({
          status: entry.status,
          note: entry.note,
          priority: entry.priority,
          masteryLevel: entry.masteryLevel,
          obtainedAt: entry.obtainedAt
        })
      });
      if (!res.ok) throw new Error(res.status);
    } catch {
      failed.push(spriteId);
    }
  }
  saveSyncQueue(failed);
  syncInFlight = false;
  if (failed.length > 0) {
    syncErrorState = failed.length === queue.length;
    console.warn(`Sync retry: ${queue.length - failed.length} OK, ${failed.length} still pending`);
    scheduleSyncRetry();
  } else {
    syncErrorState = false;
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    console.log("Sync queue flushed");
  }
  updateSyncStatus();
}

// ── Full sync (bulk push) ──
async function fullSync() {
  if (!state.userId) return;
  try {
    const res = await fetch(`${API_BASE}/collection/${state.userId}/sync`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ collection: state.collection })
    });
    if (!res.ok) throw new Error(res.status);
    saveSyncQueue([]);
    syncErrorState = false;
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    console.log("Full sync completed");
    updateSyncStatus();
  } catch (e) {
    syncErrorState = true;
    console.warn("Full sync failed", e);
    updateSyncStatus();
  }
}

// ── Replace the server collection with the full local one (used by JSON import) ──
// Unlike fullSync (a merge via /sync), this hits /import which removes server
// entries absent from the payload, so deleting entries in an imported file
// actually propagates the deletion to the cloud.
async function replaceCollection() {
  if (!state.userId) return false;
  try {
    const res = await fetch(`${API_BASE}/collection/${state.userId}/import`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ collection: state.collection })
    });
    if (!res.ok) throw new Error(res.status);
    saveSyncQueue([]);
    syncErrorState = false;
    localStorage.setItem("sprite-index_last_sync", new Date().toISOString());
    updateSyncStatus();
    return true;
  } catch (e) {
    syncErrorState = true;
    console.warn("Replace collection failed", e);
    updateSyncStatus();
    return false;
  }
}

async function loadFromServer() {
  if (!state.userId) return false;
  try {
    const res = await fetch(`${API_BASE}/collection/${state.userId}`, { headers: authHeaders() });
    if (!res.ok) return false;
    const serverData = sanitizeCollection(await res.json());
    if (Object.keys(serverData).length > 0) {
      const local = sanitizeCollection(state.collection);
      for (const [key, serverEntry] of Object.entries(serverData)) {
        const localEntry = local[key];
        if (!localEntry) {
          setSafeRecordValue(local, key, serverEntry);
        } else {
          const localTime = localEntry.updatedAt ? new Date(localEntry.updatedAt).getTime() : 0;
          const serverTime = serverEntry.updatedAt ? new Date(serverEntry.updatedAt).getTime() : 0;
          if (serverTime > localTime) {
            setSafeRecordValue(local, key, serverEntry);
          }
        }
      }
      state.collection = local;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local));

      // A local entry can be newer than the copy returned by the server (for
      // example after an offline action). Keep it locally *and* enqueue it so
      // the passport, public profile and the rest of the API catch up. The
      // old merge only kept that newer local value, which allowed the app to
      // show 42/83 while its server passport remained at 41/83 indefinitely.
      const knownVariantIds = new Set(getAllItems().map((item) => String(item.id)));
      for (const [id, localEntry] of Object.entries(local)) {
        if (id.startsWith("fav_") || !knownVariantIds.has(String(id))) continue;
        const serverEntry = serverData[id];
        const localTime = localEntry?.updatedAt ? new Date(localEntry.updatedAt).getTime() : 0;
        const serverTime = serverEntry?.updatedAt ? new Date(serverEntry.updatedAt).getTime() : 0;
        if (!serverEntry || localTime > serverTime) addToSyncQueue(id);
      }
      return true;
    }
  } catch (e) {
    console.warn("API load failed", e);
  }
  return false;
}

async function migrateLocalToServer() {
  if (!state.userId) return;
  const localEntries = Object.keys(state.collection).filter((k) => !k.startsWith("fav_")).length;
  if (localEntries === 0) return;
  try {
    await fetch(`${API_BASE}/collection/${state.userId}/sync`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ collection: state.collection })
    });
    console.log(`Synced ${localEntries} entries to server`);
  } catch (e) {
    console.warn("Sync to server failed", e);
  }
}

// ── Sync status indicator ──
let syncErrorState = false;

function syncIcon(kind) {
  const icons = {
    local:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/></svg>',
    offline:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 1l5.6 5.6M17.4 17.4L23 23"/><path d="M5 12.5a7 7 0 0 1 9.9-1"/><path d="M8.5 16a3.5 3.5 0 0 1 5 0"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>',
    error:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    pending:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    synced:
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
  };
  return icons[kind] || icons.local;
}

function updateSyncStatus() {
  const bar = document.getElementById("syncBar");
  const icon = document.getElementById("syncBarIcon");
  const text = document.getElementById("syncBarText");
  const detail = document.getElementById("syncBarDetail");
  const retry = document.getElementById("syncBarRetry");
  if (!bar || !icon || !text || !detail) return;

  bar.style.display = "";
  bar.className = "sync-bar";
  if (retry) retry.hidden = true;

  // Guest collections are protected locally too. Showing that explicitly
  // avoids the false impression that a network account is required to save.
  if (!state.userId) {
    bar.classList.add("sync-bar--local");
    icon.innerHTML = syncIcon("local");
    text.textContent = t("sync.local");
    detail.textContent = t("sync.localDetail");
    return;
  }

  const queue = getSyncQueue();
  if (!navigator.onLine) {
    bar.classList.add("sync-bar--offline");
    icon.innerHTML = syncIcon("offline");
    text.textContent = t("sync.offline");
    detail.textContent = queue.length ? t("sync.offlineQueued", { count: queue.length }) : t("sync.offlineDetail");
    return;
  }

  if (syncErrorState) {
    bar.classList.add("sync-bar--error");
    icon.innerHTML = syncIcon("error");
    text.textContent = t("sync.error");
    detail.textContent = queue.length ? t("sync.errorQueued", { count: queue.length }) : t("sync.errorDetail");
    if (retry) retry.hidden = false;
  } else if (queue.length > 0) {
    bar.classList.add("sync-bar--pending");
    icon.innerHTML = syncIcon("pending");
    text.textContent = t("sync.pending");
    detail.textContent = queue.length === 1 ? t("sync.pendingOne") : t("sync.pendingMany", { count: queue.length });
    if (retry) retry.hidden = false;
  } else {
    bar.classList.add("sync-bar--synced");
    icon.innerHTML = syncIcon("synced");
    text.textContent = t("sync.synced");
    const lastSync = localStorage.getItem("sprite-index_last_sync");
    detail.textContent = lastSync
      ? t("sync.lastSync", {
          time: new Date(lastSync).toLocaleTimeString(uiLocale(), { hour: "2-digit", minute: "2-digit" })
        })
      : t("sync.syncedDetail");
  }
}

// Call after each persist / flush / online change
window.addEventListener("online", () => {
  updateSyncStatus();
  if (state.userId) flushSyncQueue();
});
window.addEventListener("offline", () => updateSyncStatus());

function bestStatus(a, b) {
  const order = { owned: 100, spotted: 90, priority: 80, missing: 70, unsure: 60, unavailable: 50, new: 0 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

function bestPriority(a, b) {
  const order = { urgent: 100, important: 80, medium: 60, low: 40, ignored: 20, none: 0 };
  return (order[a] || 0) >= (order[b] || 0) ? a : b;
}

function earliest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function latest(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function normalizeVariantName(name) {
  const n = (name || "").trim();
  const lower = n.toLowerCase();
  if (lower === "holo" || lower === "holofoil") return "Holofoil";
  const known = ["Base", "Holofoil", "Galaxy", "Gold", "Gummy", "Gem", "Rift"].find((v) => v.toLowerCase() === lower);
  if (known) return known;
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

// Build a runtime map from old display names / slugs to current sprite ids.
function buildSpriteNameMap() {
  const map = createSafeRecord();
  for (const s of SPRITES || []) {
    if (s.name) setSafeRecordValue(map, s.name.toLowerCase(), s.id);
    if (s.officialName) setSafeRecordValue(map, s.officialName.toLowerCase(), s.id);
    if (s.slug) setSafeRecordValue(map, s.slug.toLowerCase(), s.id);
  }
  return map;
}

function resolveLegacyKey(key, spriteMap) {
  if (!key || typeof key !== "string") return null;
  if (key.startsWith("fav_")) return key;

  // Already looks like a stable variant id (e.g. sprite_water_holofoil)
  if (key.toLowerCase().startsWith("sprite_") && !key.includes("::")) {
    return key;
  }

  // Legacy "base::Variant" format.
  if (key.includes("::")) {
    const [base, variant] = key.split("::");
    const resolvedBase = spriteMap[base.toLowerCase()] || base;
    return variantId(resolvedBase, normalizeVariantName(variant));
  }

  // Flat base_variant format like "sprite_water_holo" or "water_holo".
  for (const suffix of ["Holofoil", "Holo", "Galaxy", "Gold", "Gummy", "Gem", "Rift", "Base"]) {
    const regex = new RegExp(`[_-]${suffix.toLowerCase()}$`, "i");
    if (regex.test(key)) {
      const base = key.replace(regex, "");
      const resolvedBase = spriteMap[base.toLowerCase()];
      if (!resolvedBase) return null;
      return variantId(resolvedBase, normalizeVariantName(suffix));
    }
  }

  // Try to extract a trailing variant word from the display name, e.g. "Water Sprite Holo".
  const parts = key.trim().split(/\s+/);
  let variant = "Base";
  let baseParts = parts;
  const last = parts[parts.length - 1];
  const matched = ["Holofoil", "Holo", "Galaxy", "Gold", "Gummy", "Gem", "Rift", "Base"].find(
    (v) => v.toLowerCase() === last.toLowerCase()
  );
  if (matched) {
    variant = normalizeVariantName(matched);
    baseParts = parts.slice(0, -1);
  }
  const baseName = baseParts.join(" ").trim();
  const resolvedBase = spriteMap[baseName.toLowerCase()];
  if (!resolvedBase) return null;
  return variantId(resolvedBase, variant);
}

// Clean up localStorage collection: merge legacy/old-format keys into the current
// stable `spriteId::variant` format. This fixes duplicate checklist / card entries
// caused by old localStorage keys matching the same variant.
function normalizeLocalCollection() {
  if (!SPRITES || !SPRITES.length) return;
  const spriteMap = buildSpriteNameMap();
  const normalized = createSafeRecord();
  const unknown = createSafeRecord();

  for (const [key, entry] of Object.entries(state.collection || {})) {
    if (key.startsWith("fav_")) {
      setSafeRecordValue(normalized, key, entry === true);
      continue;
    }
    const resolved = resolveLegacyKey(key, spriteMap);
    if (!resolved) {
      setSafeRecordValue(unknown, key, entry);
      continue;
    }

    if (normalized[resolved]) {
      const existing = normalized[resolved];
      existing.status = bestStatus(existing.status, entry.status);
      existing.priority = bestPriority(existing.priority, entry.priority);
      existing.note = [existing.note, entry.note].filter(Boolean).join("\n---\n");
      if (entry.obtainedAt) existing.obtainedAt = earliest(existing.obtainedAt, entry.obtainedAt);
      if (entry.updatedAt) existing.updatedAt = latest(existing.updatedAt, entry.updatedAt);
    } else {
      setSafeRecordValue(normalized, resolved, sanitizeCollectionEntry(entry));
    }
  }

  // Preserve unrecognized keys so no data is deleted.
  const merged = createSafeRecord();
  for (const [key, entry] of Object.entries(normalized)) setSafeRecordValue(merged, key, entry);
  for (const [key, entry] of Object.entries(unknown)) setSafeRecordValue(merged, key, entry);
  state.collection = merged;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collection));
}

async function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.collection = sanitizeCollection(raw ? JSON.parse(raw) : {});
  } catch {
    state.collection = createSafeRecord();
  }

  const serverLoaded = await loadFromServer();
  if (!serverLoaded && Object.keys(state.collection).length > 0) {
    await migrateLocalToServer();
  }

  // Merge/dedupe legacy keys after server merge.
  normalizeLocalCollection();

  // Flush any pending changes from a previous offline session
  if (state.userId && getSyncQueue().length > 0) {
    flushSyncQueue();
  }

  updateSyncStatus();

  const theme = localStorage.getItem(THEME_KEY);
  if (theme === "light") document.body.classList.add("light");
  updateThemeButton();
}
