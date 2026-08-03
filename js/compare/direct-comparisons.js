"use strict";

async function compareWithUser(identifier) {
  if (!state.userId) {
    toast(t("squad.loginFirst"));
    return;
  }
  if (!identifier) return;
  const self = state.username || state.userId;
  const target = identifier;
  try {
    const url = self
      ? `${API_BASE}/compare/${encodeURIComponent(self)}/${encodeURIComponent(target)}`
      : `${API_BASE}/compare/${encodeURIComponent(target)}`;
    const res = await fetch(url, { headers: authHeadersOnly() });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toastError(data, "compare.failed");
      return;
    }
    const result = await res.json();

    const targetId = result.users?.userB?.id;
    const targetName = result.users?.userB?.displayName || target;
    const targetCollection = createSafeRecord();
    for (const rec of result.records || []) {
      const entry = rec.userB || {};
      setSafeRecordValue(
        targetCollection,
        rec.variantId,
        sanitizeCollectionEntry({
          status: entry.status || "new",
          priority: entry.priority || "none",
          note: entry.note || "",
          obtainedAt: entry.obtainedAt || null
        })
      );
    }

    state.compareTarget = {
      userId: targetId ? Number(targetId) : null,
      username: targetName,
      collection: targetCollection
    };
    if (self && typeof history !== "undefined") {
      history.replaceState(null, "", `/compare/${encodeURIComponent(self)}/${encodeURIComponent(target)}`);
    }
    renderCompare();
    switchToCompareView();
  } catch (e) {
    console.error("[compare] compare with user", e);
    toast(t("compare.error"));
  }
}

async function comparePair(userAId, userAName, userBId, userBName) {
  if (!userAId || !userBId) return;
  try {
    const res = await fetch(
      `${API_BASE}/comparisons/users/${encodeURIComponent(userAId)}/${encodeURIComponent(userBId)}?source=squad`,
      { headers: authHeadersOnly() }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toastError(data, "compare.pairFailed");
      return;
    }
    const result = await res.json();
    const collectionA = createSafeRecord();
    const collectionB = createSafeRecord();
    for (const rec of result.records || []) {
      const a = rec.userA || {};
      const b = rec.userB || {};
      const entryA = sanitizeCollectionEntry({
        status: a.status || "new",
        priority: a.priority || "none",
        note: a.note || "",
        obtainedAt: null
      });
      const entryB = sanitizeCollectionEntry({
        status: b.status || "new",
        priority: b.priority || "none",
        note: b.note || "",
        obtainedAt: null
      });
      setSafeRecordValue(collectionA, rec.variantId, entryA);
      if (rec.id && rec.id !== rec.variantId) setSafeRecordValue(collectionA, rec.id, entryA);
      setSafeRecordValue(collectionB, rec.variantId, entryB);
      if (rec.id && rec.id !== rec.variantId) setSafeRecordValue(collectionB, rec.id, entryB);
    }

    state.compareAsPair = {
      userA: { id: Number(userAId), displayName: userAName || t("compare.playerA"), collection: collectionA }
    };
    state.compareTarget = {
      userId: Number(userBId),
      username: userBName || t("compare.playerB"),
      collection: collectionB
    };
    renderCompare();
    switchToCompareView();
  } catch (e) {
    console.error("[compare] comparePair", e);
    toast(t("compare.error"));
  }
}

async function handleCompareUserParams() {
  const pathMatch = location.pathname.match(/^\/compare\/(?!share\/)([^/]+)\/([^/]+)\/?$/);
  if (!pathMatch) return false;
  const [, userA, userB] = pathMatch;
  const res = await fetch(`${API_BASE}/compare/${encodeURIComponent(userA)}/${encodeURIComponent(userB)}`, {
    headers: authHeadersOnly()
  });
  if (!res.ok) {
    if (res.status === 401) toast(t("compare.loginToView"));
    else toast(t("compare.loadFailed"));
    return false;
  }
  const result = await res.json();
  const target = String(userA) === String(state.username || state.userId) ? userB : userA;
  const targetId = result.users?.userB?.id;
  const targetName = result.users?.userB?.displayName || target;
  const targetCollection = createSafeRecord();
  for (const rec of result.records || []) {
    const entry = rec.userB || {};
    setSafeRecordValue(
      targetCollection,
      rec.variantId,
      sanitizeCollectionEntry({
        status: entry.status || "new",
        priority: entry.priority || "none",
        note: entry.note || "",
        obtainedAt: entry.obtainedAt || null
      })
    );
  }
  state.compareTarget = {
    userId: targetId ? Number(targetId) : null,
    username: targetName,
    collection: targetCollection
  };
  renderCompare();
  switchToCompareView();
  return true;
}

// ── WebSocket temps réel pour la comparaison ──
