"use strict";

async function copyFriendInviteLink() {
  try {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    if (!res.ok) throw new Error("invite link failed");
    const data = await res.json();
    const fallbackLink = data.token ? `${webOrigin()}/?invite=${encodeURIComponent(String(data.token))}` : "";
    const link = safeAppWebUrl(data.url) || safeAppWebUrl(fallbackLink);
    if (!link) throw new Error("invalid invite link");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(link);
      toast(t("friends.linkCopied"));
    } else {
      toast(t("friends.linkFallback", { link }));
    }
  } catch (e) {
    console.error("[friends] invite link error", e);
    toast(t("friends.linkFailed"));
  }
}

async function showMyQrCode() {
  const img = getFriendsEl("friendQrImg");
  const hint = getFriendsEl("friendQrHint");
  if (!state.userId || !hasAuthSession()) {
    if (hint) hint.textContent = t("friends.loginForQr");
    toast(t("friends.loginForQr"));
    return;
  }
  if (img) {
    img.style.display = "none";
    img.src = "";
  }
  if (hint) hint.textContent = t("friends.qrGenerating");
  try {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    if (!res.ok) {
      throw new Error(`invite link failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) throw new Error("missing token");

    // Prefer server-rendered QR, fallback to a public QR API if the endpoint is unavailable.
    const qrUrl = `${API_BASE}/friends/invite-links/${encodeURIComponent(data.token)}/qr`;
    const qrRes = await fetch(qrUrl, { headers: authHeadersOnly() });
    if (!qrRes.ok) {
      throw new Error(`qr failed: ${qrRes.status}`);
    }
    const qrData = await qrRes.json();
    const qrImage = safeImageUrl(qrData.qr);
    if (img && qrImage) {
      img.src = qrImage;
      img.style.display = "block";
      if (hint) hint.style.display = "none";
      return;
    }
    throw new Error("no qr data");
  } catch (e) {
    console.error("[friends] qr error", e);
    if (hint) hint.textContent = t("friends.qrFailed");
    toast(t("friends.qrFailedShort"));
  }
}
