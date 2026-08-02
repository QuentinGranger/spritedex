(() => {
  "use strict";

  window.SpriteIndexAccount.register("passport-share-preview", function initializeAccountFeature() {
  function passportShareDefaults(card) {
    const avail = (card && card.availableFields) || {};
    return {
      showSquad: avail.squad !== false && !!card.primarySquadName,
      showBadges: avail.badges !== false && !!card.featuredBadgeLabel,
      showJoinedAt: avail.joinedAt !== false && !!card.joinedAt,
      showCompletion: avail.completion !== false,
      showEvents: avail.events !== false && card.completedEventCount != null,
      includeInvite: false
    };
  }

  function formatPassportJoinDate(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(uiLocale(), { day: "numeric", month: "long", year: "numeric" });
  }

  function buildPassportCardLines(card, opts) {
    const lines = [];
    const name = card.displayName || card.username || "";
    lines.push({ kind: "title", text: name });
    if (card.username && card.displayName && card.username !== card.displayName) {
      lines.push({ kind: "sub", text: `@${card.username}` });
    }
    if (opts.showCompletion && card.completionRateDisplay != null) {
      const rate = formatUiNumber(card.completionRateDisplay, { maximumFractionDigits: 1 });
      lines.push({ kind: "stat", text: t("account.share.completionRate", { rate }) });
    }
    if (opts.showCompletion && card.ownedVariantCount != null && card.releasedVariantCount != null) {
      lines.push({ kind: "stat", text: t("account.share.variantsOf", { owned: card.ownedVariantCount, total: card.releasedVariantCount }) });
    }
    if (opts.showEvents && card.completedEventCount != null) {
      const n = Number(card.completedEventCount) || 0;
      lines.push({ kind: "stat", text: n === 1 ? t("account.passport.eventsShareOne") : t("account.passport.eventsShareMany", { count: n }) });
    }
    if (opts.showBadges && card.featuredBadgeLabel) {
      lines.push({ kind: "meta", text: t("account.share.badge", { label: card.featuredBadgeLabel }) });
    }
    if (opts.showSquad && card.primarySquadName) {
      lines.push({ kind: "meta", text: t("account.share.squad", { name: card.primarySquadName }) });
    }
    if (opts.showJoinedAt && card.joinedAt) {
      lines.push({ kind: "meta", text: t("account.share.joinedOn", { date: formatPassportJoinDate(card.joinedAt) }) });
    }
    if (opts.includeInvite) {
      lines.push({ kind: "meta", text: t("passport.shareInviteCardLine") });
    }
    return lines;
  }

  function renderPassportSharePreviewBody(card, opts) {
    const lines = buildPassportCardLines(card, opts);
    const shareTarget = opts.includeInvite
      ? t("passport.shareInvitePreviewUrl")
      : ((card.publicUrl && `${webOrigin()}${card.publicUrl}`) || "");
    return `
      <ul class="passport-share-preview__list">
        ${lines.map((l) => `<li class="passport-share-preview__${escapeHtml(l.kind)}">${escapeHtml(l.text)}</li>`).join("")}
      </ul>
      <p class="passport-share-preview__url">${escapeHtml(shareTarget)}</p>
      <p class="passport-share-preview__note">${t("account.passportShareNote")}</p>
    `;
  }

  async function fetchPassportCardPayload(username) {
    const res = await fetch(`${API_BASE}/u/${encodeURIComponent(username)}/passport/card`, {
      headers: authHeadersOnly()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || t("account.cardUnavailable"));
    return data;
  }

  let passportSharePreviewUrl = "";

  function resetPassportShareResult() {
    const result = document.getElementById("passportShareResult");
    const image = document.getElementById("passportShareResultImage");
    if (passportSharePreviewUrl) URL.revokeObjectURL(passportSharePreviewUrl);
    passportSharePreviewUrl = "";
    if (image) image.removeAttribute("src");
    if (result) result.hidden = true;
  }

  function showPassportShareResult(result) {
    const root = document.getElementById("passportShareResult");
    const image = document.getElementById("passportShareResultImage");
    const download = document.getElementById("passportShareDownload");
    const copy = document.getElementById("passportShareCopyLink");
    const nativeShare = document.getElementById("passportShareNative");
    if (!root || !image || !result) return;

    resetPassportShareResult();
    passportSharePreviewUrl = URL.createObjectURL(result.blob);
    image.src = passportSharePreviewUrl;
    image.alt = t("passport.shareReadyTitle");
    root.hidden = false;

    if (download) {
      download.onclick = () => {
        const url = URL.createObjectURL(result.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.fileName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1_000);
      };
    }
    if (copy) {
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(result.shareUrl);
          toast(t("passport.shareLinkCopied"));
        } catch (_) {
          toast(result.shareUrl);
        }
      };
    }
    const nativeSupported = !!(navigator.canShare && navigator.canShare({ files: [result.file] }));
    if (nativeShare) {
      nativeShare.hidden = !nativeSupported;
      nativeShare.onclick = nativeSupported ? async () => {
        try {
          await navigator.share({
            title: result.title,
            text: result.text,
            url: result.shareUrl,
            files: [result.file]
          });
        } catch (err) {
          if (err?.name !== "AbortError") toastError(err, "account.cantGenerateCard");
        }
      } : null;
    }
  }

  function openPassportSharePreview(passportData) {
    const username = passportData.user && passportData.user.username;
    if (!username) {
      toast(t("account.missingUsername"));
      return;
    }
    const dialog = document.getElementById("passportShareDialog");
    const preview = document.getElementById("passportSharePreview");
    const generateBtn = document.getElementById("passportShareGenerate");
    if (!dialog || !preview) return;

    resetPassportShareResult();
    preview.innerHTML = `<p class="collector-passport__empty">${t("account.sharePreviewLoading")}</p>`;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    fetchPassportCardPayload(username).then((card) => {
      const opts = passportShareDefaults(card);
      let invitation = null;
      const sync = () => {
        opts.showSquad = !!document.getElementById("passportShareOptSquad")?.checked;
        opts.showBadges = !!document.getElementById("passportShareOptBadges")?.checked;
        opts.showJoinedAt = !!document.getElementById("passportShareOptJoined")?.checked;
        opts.showCompletion = !!document.getElementById("passportShareOptCompletion")?.checked;
        opts.showEvents = !!document.getElementById("passportShareOptEvents")?.checked;
        opts.includeInvite = !!document.getElementById("passportShareOptInvite")?.checked;
        preview.innerHTML = renderPassportSharePreviewBody(card, opts);
      };
      const squadEl = document.getElementById("passportShareOptSquad");
      const badgesEl = document.getElementById("passportShareOptBadges");
      const joinedEl = document.getElementById("passportShareOptJoined");
      const completionEl = document.getElementById("passportShareOptCompletion");
      const eventsEl = document.getElementById("passportShareOptEvents");
      const inviteEl = document.getElementById("passportShareOptInvite");
      if (squadEl) {
        squadEl.checked = opts.showSquad;
        squadEl.disabled = !card.primarySquadName;
      }
      if (badgesEl) {
        badgesEl.checked = opts.showBadges;
        badgesEl.disabled = !card.featuredBadgeLabel;
      }
      if (joinedEl) {
        joinedEl.checked = opts.showJoinedAt;
        joinedEl.disabled = !card.joinedAt;
      }
      if (completionEl) completionEl.checked = opts.showCompletion;
      if (eventsEl) {
        eventsEl.checked = opts.showEvents;
        eventsEl.disabled = card.completedEventCount == null;
      }
      if (inviteEl) inviteEl.checked = false;
      ["passportShareOptSquad", "passportShareOptBadges", "passportShareOptJoined", "passportShareOptCompletion", "passportShareOptEvents", "passportShareOptInvite"]
        .forEach((id) => document.getElementById(id)?.addEventListener("change", sync));
      sync();

      if (generateBtn) {
        generateBtn.onclick = async () => {
          sync();
          const format = document.getElementById("passportShareFormat")?.value || "1080x1080";
          const originalLabel = generateBtn.textContent;
          generateBtn.disabled = true;
          generateBtn.textContent = t("passport.shareGenerating");
          try {
            if (opts.includeInvite && !invitation) invitation = await createPassportShareInvitation();
            const result = await generateAndSharePassportCard(card, opts, format, opts.includeInvite ? invitation : null);
            showPassportShareResult(result);
          } catch (err) {
            toastError(err, "account.cantGenerateCard");
          } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = originalLabel;
          }
        };
      }
    }).catch((err) => {
      preview.innerHTML = `<p class="collector-passport__empty">${escapeHtml(err.message ? t(err.message) : t("account.sharePreviewUnavailable"))}</p>`;
    });
  }

  function passportCardSize(format) {
    if (format === "1080x1920") return { w: 1080, h: 1920 };
    if (format === "1200x630") return { w: 1200, h: 630 };
    return { w: 1080, h: 1080 };
  }

  async function createPassportShareInvitation() {
    const res = await fetch(`${API_BASE}/friends/invite-links`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ duration: "permanent" })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.token) throw new Error(data.error || t("passport.shareInviteFailed"));
    return { token: String(data.token) };
  }

  function passportShareUrl(card, invitation) {
    const base = new URL(card.publicUrl || "/", webOrigin());
    if (invitation?.token) base.searchParams.set("invite", invitation.token);
    return base.toString();
  }

  Object.assign(globalThis, { passportShareDefaults, formatPassportJoinDate, buildPassportCardLines, renderPassportSharePreviewBody, fetchPassportCardPayload, resetPassportShareResult, showPassportShareResult, openPassportSharePreview, passportCardSize, createPassportShareInvitation, passportShareUrl });
  });
})();
