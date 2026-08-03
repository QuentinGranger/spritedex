"use strict";

function extractShareToken(raw) {
  if (!raw) return "";
  let value = raw.trim();
  // supporte ?share=... et ?compare=...
  for (const param of ["share", "compare"]) {
    const re = new RegExp(`[?&]${param}=([a-f0-9]{64})`, "i");
    const m = value.match(re);
    if (m) return m[1].toLowerCase();
  }
  // token direct
  if (/^[a-f0-9]{64}$/i.test(value)) return value.toLowerCase();
  return "";
}

async function loadCompareTarget(raw) {
  const token = extractShareToken(raw);
  if (!token) {
    toast(t("compare.invalidToken"));
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/shared/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast(t("compare.profilePrivate"));
      return;
    }
    if (res.status === 404) {
      toast(t("compare.shareRevoked"));
      return;
    }
    if (!res.ok) throw new Error("shared failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareTarget = {
      userId: data.id,
      username: data.username || t("compare.friend"),
      avatarUrl: data.avatarUrl || "",
      collection: sanitizeCollection(data.collection)
    };
    logCompareAnalytics("comparison_viewed", { source: "shared_profile", targetId: data.id });
    if (els.compareTokenInput) els.compareTokenInput.value = raw;
    const url = new URL(location.href);
    url.searchParams.set("compare", token);
    history.replaceState(null, "", url.toString());
    renderCompare();
    toast(t("compare.loadedWith", { name: state.compareTarget.username }));
  } catch (e) {
    toast(t("compare.loadProfileFailed"));
    console.error("[compare]", e);
  }
}

function setShareResult(url, qrDataUrl = null) {
  const absoluteUrl = safeAppWebUrl(url);
  if (!absoluteUrl) {
    toast(t("compare.shareInvalid"));
    return;
  }
  if (els.shareCompareUrl) {
    els.shareCompareUrl.href = absoluteUrl;
    els.shareCompareUrl.textContent = absoluteUrl;
  }
  if (els.shareCompareQr) {
    const qrImage = safeImageUrl(qrDataUrl);
    els.shareCompareQr.style.display = qrImage ? "block" : "none";
    els.shareCompareQr.src = qrImage;
  }
  if (els.shareCompareCopy) {
    els.shareCompareCopy.onclick = async () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(absoluteUrl);
        toast(t("compare.copied"));
      } else {
        toast(absoluteUrl);
      }
    };
  }
  if (els.shareCompareResult) els.shareCompareResult.classList.add("is-visible");
}

function resetShareDialog() {
  if (els.shareCompareResult) els.shareCompareResult.classList.remove("is-visible");
  if (els.shareCompareUrl) els.shareCompareUrl.href = "#";
  if (els.shareCompareUrl) els.shareCompareUrl.textContent = "";
  if (els.shareCompareQr) els.shareCompareQr.style.display = "none";
}

async function openShareDialog(context) {
  if (!state.userId) {
    toast(t("compare.loginForShare"));
    return;
  }
  if (!els.shareCompareDialog || typeof els.shareCompareDialog.showModal !== "function") return;
  resetShareDialog();

  const isSquad = context === "squad";
  if (els.shareCompareTitle) {
    els.shareCompareTitle.textContent = isSquad ? t("compare.shareSquadTitle") : t("compare.shareTitle");
  }
  if (els.shareCompareIntro) {
    els.shareCompareIntro.textContent = isSquad ? t("compare.shareSquadIntro") : t("compare.shareCompareIntro");
  }
  if (els.shareCompareOptions) {
    els.shareCompareOptions.style.display = isSquad ? "none" : "";
  }
  if (els.shareCompareGenerate) {
    els.shareCompareGenerate.style.display = isSquad ? "none" : "";
    els.shareCompareGenerate.textContent = isSquad ? "" : t("compare.generateBtn");
  }

  els.shareCompareDialog.showModal();

  if (isSquad) {
    const code = state.activeSquad;
    if (!code) return;
    try {
      const res = await fetch(`${API_BASE}/squads/${encodeURIComponent(code)}/qr`, { headers: authHeadersOnly() });
      if (!res.ok) throw new Error("squad qr failed");
      const data = await res.json();
      setShareResult(data.url, data.qr);
    } catch (e) {
      console.error("[squad share]", e);
      toast(t("compare.squadLinkFailed"));
    }
  }
}

async function shareCompareLink() {
  openShareDialog("compare");
}

async function createCompareShare() {
  if (!state.userId) {
    toast(t("compare.loginForShare"));
    return;
  }
  if (!els.shareCompareDuration) return;

  const duration = els.shareCompareDuration.value || "24h";
  const collectionVisible = els.shareCompareCollection ? els.shareCompareCollection.checked : true;
  const showNotes = els.shareCompareNotes ? els.shareCompareNotes.checked : false;
  const showPriorities = els.shareComparePriorities ? els.shareComparePriorities.checked : true;
  const allowVisitorCompare = els.shareCompareVisitor ? els.shareCompareVisitor.checked : true;

  try {
    const res = await fetch(`${API_BASE}/compare/share`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ duration, collectionVisible, showNotes, showPriorities, allowVisitorCompare })
    });
    if (!res.ok) throw new Error("create share failed");
    const data = await res.json();
    logCompareAnalytics("compare_invitation_generated", { source: "compare_dialog" });
    setShareResult(data.url, data.qr);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(data.url);
      toast(t("compare.copied"));
    } else {
      toast(data.url);
    }
  } catch (e) {
    toast(t("common.networkError"));
    console.error("[compare share]", e);
  }
}

async function loadCompareShare(token) {
  try {
    const res = await fetch(`${API_BASE}/compare/share/${encodeURIComponent(token)}`, { headers: authHeadersOnly() });
    if (res.status === 403) {
      toast(t("compare.profilePrivate"));
      return;
    }
    if (res.status === 404) {
      toast(t("compare.shareExpiredRevoked"));
      return;
    }
    if (!res.ok) throw new Error("compare share failed");
    const data = await res.json();
    state.compareToken = token;
    state.compareShareOptions = data.options;

    const owner = data.result?.users?.userA;
    const ownerCollection = createSafeRecord();
    for (const r of data.result?.records || []) {
      setSafeRecordValue(ownerCollection, r.variantId, sanitizeCollectionEntry(r.userA));
    }

    state.compareTarget = {
      userId: owner?.id,
      username: owner?.displayName || t("compare.friend"),
      collection: ownerCollection
    };

    if (els.compareTokenInput) els.compareTokenInput.value = token;
    logCompareAnalytics("app_returned_from_compare", { source: "share_link", targetId: state.compareTarget.userId });
    renderCompare();
    switchToCompareView();
    toast(t("compare.loadedWith", { name: state.compareTarget.username }));
  } catch (e) {
    toast(t("compare.loadShareFailed"));
    console.error("[compare share load]", e);
  }
}

function setCompareMode(mode) {
  state.compareMode = mode === "squad" ? "squad" : "friend";
  if (state.compareMode === "squad") {
    if (typeof setSocialTab === "function") setSocialTab("squad");
    if (state.activeSquad && typeof loadSquad === "function") {
      loadSquad(state.activeSquad);
      if (typeof startSquadPolling === "function") startSquadPolling();
    }
  } else {
    if (typeof setSocialTab === "function") setSocialTab("compare");
    renderCompare();
    if (typeof stopSquadPolling === "function") stopSquadPolling();
  }
}

function switchToCompareView() {
  const socialTab = document.querySelector('.tab[data-view="social"]');
  if (socialTab) socialTab.click();
  if (typeof setSocialTab === "function") setSocialTab("compare");
}

async function handleCompareParams() {
  const params = new URLSearchParams(location.search);
  const token = params.get("compare");
  if (!token) return false;
  await loadCompareTarget(token);
  if (state.compareTarget) switchToCompareView();
  return true;
}

async function handleCompareShareParams() {
  const pathMatch = location.pathname.match(/\/compare\/share\/([a-f0-9]{64})/i);
  const token = pathMatch ? pathMatch[1].toLowerCase() : new URLSearchParams(location.search).get("compareShare");
  if (!token) return false;
  await loadCompareShare(token);
  return true;
}
