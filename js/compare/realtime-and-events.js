"use strict";

function connectCompareWs() {
  if (compareWs && (compareWs.readyState === WebSocket.CONNECTING || compareWs.readyState === WebSocket.OPEN)) return;
  if (!state.userId) return;
  try {
    compareWs = new WebSocket(WS_URL);
  } catch (e) {
    console.error("[compare ws] connect failed", e);
    return;
  }

  compareWs.onopen = () => {
    compareWs.send(JSON.stringify(wsAuthMessage()));
    if (state.compareTarget?.userId) {
      sendCompareSubscribe(state.compareTarget.userId);
    }
  };

  compareWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleCompareWsMessage(msg);
    } catch (e) {}
  };

  compareWs.onclose = () => {
    compareWs = null;
    clearTimeout(compareWsReconnectTimer);
    compareWsReconnectTimer = setTimeout(connectCompareWs, 3000);
  };

  compareWs.onerror = () => {
    if (compareWs) compareWs.close();
  };
}

function sendCompareSubscribe(userId) {
  if (!compareWs || compareWs.readyState !== WebSocket.OPEN || !userId) return;
  compareWs.send(JSON.stringify({ type: "compare_subscribe", targetUserId: userId }));
}

function handleCompareWsMessage(msg) {
  if (!msg || !msg.type) return;
  if (msg.type === "compare_update" || msg.type === "compare_reset") {
    updateCompareFromMessage(msg);
  }
}

function updateCompareFromMessage(msg) {
  if (!state.compareTarget) return;
  const targetId = state.compareTarget.userId;
  const isTarget = targetId && String(targetId) === String(msg.userId);
  const isSelf = state.userId && String(state.userId) === String(msg.userId);
  if (!isTarget && !isSelf) return;

  if (msg.type === "compare_reset") {
    if (isTarget) state.compareTarget.collection = createSafeRecord();
    if (isSelf) state.collection = createSafeRecord();
  } else if (msg.type === "compare_update" && Array.isArray(msg.changes)) {
    for (const ch of msg.changes) {
      const entry = sanitizeCollectionEntry({
        status: ch.status || "new",
        priority: ch.priority || "none",
        note: ch.note || "",
        obtainedAt: ch.obtainedAt || null
      });
      if (isTarget) setSafeRecordValue(state.compareTarget.collection, ch.variantId, entry);
      if (isSelf) setSafeRecordValue(state.collection, ch.variantId, entry);
    }
    if (isTarget && msg.changes.length > 0) {
      showCompareUpdateToast(msg, msg.changes[0]);
    }
  }

  if (isTarget || isSelf) {
    renderCompare();
  }
}

function showCompareUpdateToast(msg, change) {
  const catalog = getCompareCatalogItems().find((i) => i.variantId === change.variantId);
  const spriteName = catalog?.spriteName || change.spriteId || t("compare.aSprite");
  const variantName = catalog?.variantName || "";
  const displayName = state.compareTarget?.username || t("compare.yourFriend");
  const action = change.status === "owned" ? t("compare.actionObtained") : t("compare.actionUpdated");
  const label = variantName && variantName !== "Base" ? `${spriteName} (${variantName})` : spriteName;
  toast(t("compare.actionToast", { name: displayName, action, label }));
}

function setupCompareEvents() {
  if (els.compareForm) {
    els.compareForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const raw = els.compareTokenInput.value.trim();
      if (!raw) return;
      loadCompareTarget(raw);
    });
  }
  if (els.compareShareBtn) {
    els.compareShareBtn.addEventListener("click", shareCompareLink);
  }
  if (els.shareCompareGenerate && els.shareCompareDialog) {
    els.shareCompareGenerate.addEventListener("click", (e) => {
      e.preventDefault();
      createCompareShare();
    });
  }
}
