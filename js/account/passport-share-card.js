(() => {
  "use strict";

  window.SpriteIndexAccount.register("passport-share-card", function initializeAccountFeature() {
    async function generateAndSharePassportCard(card, opts, format, invitation = null) {
      try {
        await fetch(`${API_BASE}/passport/share-card`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            format,
            showSquad: !!opts.showSquad,
            showBadges: !!opts.showBadges,
            showJoinedAt: !!opts.showJoinedAt,
            showCompletion: opts.showCompletion !== false,
            showEvents: !!opts.showEvents,
            includesInvitation: !!invitation
          })
        });
      } catch (_) {}

      const shareUrl = passportShareUrl(card, invitation);
      const { w, h } = passportCardSize(format);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");

      const s = w / 1080;
      const isWide = h / w < 0.78;
      const isTall = h / w > 1.35;
      const px = (value) => Math.round(value * s);
      const roundRect = (x, y, width, height, radius) => {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + width, y, x + width, y + height, r);
        ctx.arcTo(x + width, y + height, x, y + height, r);
        ctx.arcTo(x, y + height, x, y, r);
        ctx.arcTo(x, y, x + width, y, r);
        ctx.closePath();
      };
      const ellipsis = (value, maxWidth) => {
        const text = String(value || "");
        if (ctx.measureText(text).width <= maxWidth) return text;
        let out = text;
        while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
        return `${out}…`;
      };
      const panel = (x, y, width, height, fill, stroke = "rgba(186,224,255,0.14)") => {
        roundRect(x, y, width, height, px(24));
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = px(1);
        ctx.stroke();
      };
      const line = (x1, y1, x2, y2, color, width = 1) => {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = color;
        ctx.lineWidth = px(width);
        ctx.stroke();
      };
      const spark = (cx, cy, radius, color, alpha = 1) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(cx, cy - radius);
        ctx.quadraticCurveTo(cx + radius * 0.18, cy - radius * 0.18, cx + radius, cy);
        ctx.quadraticCurveTo(cx + radius * 0.18, cy + radius * 0.18, cx, cy + radius);
        ctx.quadraticCurveTo(cx - radius * 0.18, cy + radius * 0.18, cx - radius, cy);
        ctx.quadraticCurveTo(cx - radius * 0.18, cy - radius * 0.18, cx, cy - radius);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
        ctx.restore();
      };
      const hexagon = (cx, cy, radius, fill, stroke) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 6 + (i * Math.PI) / 3;
          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill();
        }
        if (stroke) {
          ctx.strokeStyle = stroke;
          ctx.lineWidth = px(2);
          ctx.stroke();
        }
      };
      const idIcon = (x, y, size, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = px(1.8);
        roundRect(x, y, size, size * 0.72, px(3));
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + size * 0.27, y + size * 0.28, size * 0.1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + size * 0.27, y + size * 0.5, size * 0.16, Math.PI, 0);
        ctx.stroke();
        line(x + size * 0.53, y + size * 0.27, x + size * 0.78, y + size * 0.27, color, 1.4);
        line(x + size * 0.53, y + size * 0.47, x + size * 0.72, y + size * 0.47, color, 1.4);
      };
      const factIcon = (kind, x, y, size, color) => {
        const midX = x + size / 2;
        const midY = y + size / 2;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = px(2);
        if (kind === "badge") {
          hexagon(midX, midY, size * 0.28, "rgba(255,215,109,0.12)", color);
          spark(midX, midY, size * 0.15, color);
        } else if (kind === "events") {
          roundRect(x + size * 0.22, y + size * 0.22, size * 0.56, size * 0.56, px(4));
          ctx.stroke();
          line(x + size * 0.22, y + size * 0.4, x + size * 0.78, y + size * 0.4, color, 1.8);
          line(x + size * 0.38, y + size * 0.57, x + size * 0.47, y + size * 0.65, color, 1.8);
          line(x + size * 0.47, y + size * 0.65, x + size * 0.66, y + size * 0.48, color, 1.8);
        } else if (kind === "member") {
          ctx.beginPath();
          ctx.arc(midX, y + size * 0.38, size * 0.14, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(midX, y + size * 0.82, size * 0.27, Math.PI, 0);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(midX, midY, size * 0.2, 0, Math.PI * 2);
          ctx.stroke();
        }
      };

      const backdrop = ctx.createLinearGradient(0, 0, w, h);
      backdrop.addColorStop(0, "#050a1b");
      backdrop.addColorStop(0.52, "#111d46");
      backdrop.addColorStop(1, "#160d31");
      ctx.fillStyle = backdrop;
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w * 0.8, h * 0.13, 0, w * 0.8, h * 0.13, w * 0.7);
      glow.addColorStop(0, "rgba(85, 77, 255, 0.2)");
      glow.addColorStop(1, "rgba(0,225,255,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const inset = px(isWide ? 32 : 42);
      const cardX = inset;
      const cardY = inset;
      const cardW = w - inset * 2;
      const cardH = h - inset * 2;
      panel(cardX, cardY, cardW, cardH, "rgba(5, 13, 36, 0.82)", "rgba(80, 166, 255, 0.3)");

      // Sparse stars keep the card alive without competing with the information.
      [
        [0.21, 0.08, 2],
        [0.66, 0.04, 1.5],
        [0.9, 0.16, 2],
        [0.83, 0.42, 1.5],
        [0.12, 0.83, 1.5]
      ].forEach(([rx, ry, r]) => {
        spark(cardX + cardW * rx, cardY + cardH * ry, px(r), "#5f8dff", 0.42);
      });

      const contentX = cardX + px(isWide ? 38 : 52);
      const contentW = cardW - px(isWide ? 76 : 104);
      let y = cardY + px(isWide ? 45 : 58);
      const brandSize = px(isWide ? 16 : 19);
      const nameSize = px(isWide ? 42 : 55);
      const markSize = px(isWide ? 15 : 18);
      hexagon(contentX + markSize, y - markSize * 0.35, markSize, "rgba(46, 108, 255, 0.24)", "#557eff");
      spark(contentX + markSize, y - markSize * 0.35, markSize * 0.48, "#d9faff");
      ctx.font = `800 ${brandSize}px system-ui, sans-serif`;
      const brandX = contentX + markSize * 2 + px(10);
      const brandPrefix = "SPRITE-INDEX";
      ctx.fillStyle = "#42e9ff";
      ctx.fillText(brandPrefix, brandX, y);
      const prefixWidth = ctx.measureText(brandPrefix).width;
      ctx.fillStyle = "#c8d5ff";
      ctx.fillText(" · ", brandX + prefixWidth, y);
      ctx.fillStyle = "#ae83ff";
      ctx.fillText("PASSEPORT", brandX + prefixWidth + ctx.measureText(" · ").width, y);
      const status = invitation ? t("passport.cardInvite") : t("passport.cardPublic");
      ctx.font = `700 ${px(isWide ? 14 : 16)}px system-ui, sans-serif`;
      const statusW = ctx.measureText(status).width + px(52);
      const statusX = contentX + contentW - statusW;
      panel(
        statusX,
        y - px(25),
        statusW,
        px(34),
        invitation ? "rgba(100, 238, 190, 0.13)" : "rgba(126, 102, 255, 0.15)",
        invitation ? "rgba(100, 238, 190, 0.35)" : "rgba(162, 143, 255, 0.5)"
      );
      ctx.fillStyle = invitation ? "#a3ffe2" : "#cdc4ff";
      idIcon(statusX + px(12), y - px(16), px(19), ctx.fillStyle);
      ctx.fillText(status, statusX + px(39), y - px(1));

      y += px(isWide ? 49 : 61);
      const name = card.displayName || card.username || "SPRITE-INDEX";
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${nameSize}px system-ui, sans-serif`;
      ctx.fillText(ellipsis(name, contentW), contentX, y);
      if (card.username && card.username !== name) {
        y += px(isWide ? 27 : 31);
        ctx.fillStyle = "rgba(216, 231, 255, 0.65)";
        ctx.font = `600 ${px(isWide ? 17 : 20)}px system-ui, sans-serif`;
        ctx.fillText(ellipsis(`@${card.username}`, contentW), contentX, y);
      }

      const progressY = y + px(isWide ? 25 : 32);
      const progressH = px(isWide ? 158 : isTall ? 274 : 232);
      const progressBg = ctx.createLinearGradient(contentX, progressY, contentX + contentW, progressY + progressH);
      progressBg.addColorStop(0, "rgba(12, 61, 121, 0.96)");
      progressBg.addColorStop(0.55, "rgba(16, 43, 104, 0.95)");
      progressBg.addColorStop(1, "rgba(48, 20, 112, 0.96)");
      panel(contentX, progressY, contentW, progressH, progressBg, "rgba(104, 216, 255, 0.72)");

      const emblemX = contentX + px(isWide ? 62 : 94);
      const emblemY = progressY + px(isWide ? 65 : 91);
      const emblemR = px(isWide ? 32 : 48);
      const emblemGlow = ctx.createRadialGradient(emblemX, emblemY, 0, emblemX, emblemY, emblemR * 1.8);
      emblemGlow.addColorStop(0, "rgba(44, 234, 255, 0.35)");
      emblemGlow.addColorStop(1, "rgba(44, 234, 255, 0)");
      ctx.fillStyle = emblemGlow;
      ctx.fillRect(emblemX - emblemR * 2, emblemY - emblemR * 2, emblemR * 4, emblemR * 4);
      hexagon(emblemX, emblemY, emblemR, "rgba(6, 40, 98, 0.7)", "#5ad9ff");
      hexagon(emblemX, emblemY, emblemR * 0.78, null, "rgba(119, 137, 255, 0.65)");
      spark(emblemX, emblemY, emblemR * 0.62, "#dcffff");
      const dividerX = contentX + px(isWide ? 126 : 182);
      line(
        dividerX,
        progressY + px(isWide ? 27 : 44),
        dividerX,
        progressY + progressH - px(isWide ? 42 : 60),
        "rgba(109, 208, 255, 0.42)",
        1
      );

      const rate = Number(card.completionRateDisplay);
      const safeRate = Number.isFinite(rate) ? Math.max(0, Math.min(100, rate)) : 0;
      const statsX = dividerX + px(isWide ? 25 : 42);
      ctx.fillStyle = "#f8fcff";
      ctx.font = `800 ${px(isWide ? 52 : 76)}px system-ui, sans-serif`;
      ctx.fillText(
        opts.showCompletion ? formatUiPercent(safeRate, { maximumFractionDigits: 1 }) : "—",
        statsX,
        progressY + px(isWide ? 70 : 96)
      );
      ctx.fillStyle = "#58d8ff";
      ctx.font = `800 ${px(isWide ? 14 : 19)}px system-ui, sans-serif`;
      ctx.fillText(t("passport.cardCollection"), statsX, progressY + px(isWide ? 96 : 127));
      if (opts.showCompletion && card.ownedVariantCount != null && card.releasedVariantCount != null) {
        ctx.fillStyle = "rgba(233, 247, 255, 0.82)";
        ctx.font = `600 ${px(isWide ? 15 : 19)}px system-ui, sans-serif`;
        ctx.fillText(
          t("account.share.variantsOf", { owned: card.ownedVariantCount, total: card.releasedVariantCount }),
          statsX,
          progressY + px(isWide ? 120 : 164)
        );
      }
      const orbitX = contentX + contentW - px(isWide ? 88 : 143);
      const orbitY = progressY + progressH * 0.46;
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = "#7756ff";
      ctx.lineWidth = px(1);
      [px(isWide ? 28 : 50), px(isWide ? 46 : 78)].forEach((radius) => {
        ctx.beginPath();
        ctx.arc(orbitX, orbitY, radius, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY, px(isWide ? 58 : 100), px(isWide ? 19 : 34), -0.55, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      spark(orbitX, orbitY, px(isWide ? 15 : 25), "#8d70ff", 0.7);
      ctx.fillStyle = "#346ddc";
      ctx.beginPath();
      ctx.arc(orbitX - px(isWide ? 46 : 86), orbitY + px(isWide ? 9 : 15), px(5), 0, Math.PI * 2);
      ctx.fill();

      const barX = contentX + px(isWide ? 24 : 34);
      const barY = progressY + progressH - px(isWide ? 30 : 39);
      const barW = contentW - px(isWide ? 48 : 68);
      const barH = px(isWide ? 13 : 18);
      panel(barX, barY, barW, barH, "rgba(2, 10, 41, 0.56)", "rgba(170, 217, 255, 0.17)");
      if (opts.showCompletion && safeRate > 0) {
        const fillW = Math.max(barH, barW * (safeRate / 100));
        const fill = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
        fill.addColorStop(0, "#00e1ff");
        fill.addColorStop(0.55, "#2586ff");
        fill.addColorStop(1, "#9a6dff");
        panel(barX, barY, fillW, barH, fill, "rgba(255,255,255,0)");
        const tipGlow = ctx.createRadialGradient(
          barX + fillW,
          barY + barH / 2,
          0,
          barX + fillW,
          barY + barH / 2,
          barH * 1.5
        );
        tipGlow.addColorStop(0, "rgba(231, 207, 255, 0.9)");
        tipGlow.addColorStop(1, "rgba(157, 110, 255, 0)");
        ctx.fillStyle = tipGlow;
        ctx.fillRect(barX + fillW - barH * 1.5, barY - barH, barH * 3, barH * 3);
      }

      const facts = [];
      if (opts.showBadges && card.featuredBadgeLabel)
        facts.push({ kind: "badge", label: t("passport.cardBadge"), value: card.featuredBadgeLabel, color: "#ffd560" });
      if (opts.showEvents && card.completedEventCount != null)
        facts.push({
          kind: "events",
          label: t("passport.cardEvents"),
          value: String(card.completedEventCount),
          color: "#74ec9d"
        });
      if (opts.showJoinedAt && card.joinedAt)
        facts.push({
          kind: "member",
          label: t("passport.cardMemberSince"),
          value: formatPassportJoinDate(card.joinedAt),
          color: "#af83ff"
        });
      if (opts.showSquad && card.primarySquadName)
        facts.push({ kind: "squad", label: t("passport.cardSquad"), value: card.primarySquadName, color: "#72dcff" });
      if (invitation)
        facts.push({
          kind: "invite",
          label: t("passport.cardInvite"),
          value: t("passport.cardInviteValue"),
          color: "#8ff9e1"
        });

      const factsY = progressY + progressH + px(isWide ? 20 : 26);
      const maxFacts = isWide ? 4 : 5;
      const displayedFacts = facts.slice(0, maxFacts);
      const columns = isWide ? 2 : 1;
      const factGap = px(10);
      const factW = columns === 2 ? (contentW - factGap) / 2 : contentW;
      const factH = px(isWide ? 58 : 78);
      displayedFacts.forEach((fact, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const x = contentX + col * (factW + factGap);
        const fy = factsY + row * (factH + factGap);
        panel(x, fy, factW, factH, "rgba(11, 29, 69, 0.78)", "rgba(112, 167, 255, 0.22)");
        const iconSize = px(isWide ? 39 : 54);
        const iconX = x + px(isWide ? 9 : 14);
        const iconY = fy + (factH - iconSize) / 2;
        panel(iconX, iconY, iconSize, iconSize, "rgba(18, 41, 86, 0.86)", `${fact.color}66`);
        factIcon(fact.kind, iconX, iconY, iconSize, fact.color);
        const factDividerX = iconX + iconSize + px(isWide ? 11 : 18);
        line(factDividerX, fy + px(12), factDividerX, fy + factH - px(12), "rgba(115, 180, 255, 0.26)", 1);
        const factTextX = factDividerX + px(isWide ? 12 : 22);
        ctx.fillStyle = fact.color;
        ctx.font = `800 ${px(isWide ? 12 : 14)}px system-ui, sans-serif`;
        ctx.fillText(
          ellipsis(fact.label.toUpperCase(), factW - (factTextX - x) - px(42)),
          factTextX,
          fy + px(isWide ? 22 : 29)
        );
        ctx.fillStyle = "rgba(248, 252, 255, 0.93)";
        ctx.font = `700 ${px(isWide ? 16 : 19)}px system-ui, sans-serif`;
        ctx.fillText(
          ellipsis(fact.value, factW - (factTextX - x) - px(42)),
          factTextX,
          fy + factH - px(isWide ? 15 : 18)
        );
        spark(x + factW - px(isWide ? 19 : 34), fy + factH / 2, px(isWide ? 7 : 10), fact.color, 0.46);
      });

      const footerY = cardY + cardH - px(isWide ? 32 : 40);
      ctx.fillStyle = "rgba(211, 231, 255, 0.55)";
      ctx.font = `600 ${px(isWide ? 14 : 16)}px system-ui, sans-serif`;
      const footer = invitation ? t("passport.shareInviteCardFooter") : t("passport.cardFooter");
      ctx.fillText(ellipsis(footer, contentW), contentX, footerY);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t("account.cardExportFailed")))), "image/png");
      });
      const fileName = `sprite-index-passeport-${card.username || "carte"}-${w}x${h}.png`;
      const file = new File([blob], fileName, { type: "image/png" });
      return {
        blob,
        file,
        fileName,
        shareUrl,
        title: t("passport.shareNativeTitle", { name: card.displayName || card.username }),
        text: invitation ? t("passport.shareNativeTextInvite") : t("passport.shareNativeText")
      };
    }

    Object.assign(globalThis, { generateAndSharePassportCard });
  });
})();
