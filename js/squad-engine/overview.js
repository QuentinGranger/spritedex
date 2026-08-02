function formatPct(n) {
  return new Intl.NumberFormat(uiLocale(), { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(safeFiniteNumber(n, 0, { min: -100, max: 100 }) / 100);
}

function uniqueContributionCount(member) {
  if (!member) return 0;
  return safeFiniteNumber(member.uniqueVariantCount ?? member.uniqueCount ?? member.count, 0, { min: 0, max: 1000000 });
}

function priorityDisplay(p) {
  return p.display || p.impactDisplay || "";
}

function renderUniqueOwnersLeaderboard(uniqueOwners) {
  const byMember = (uniqueOwners && uniqueOwners.byMember) || [];
  if (!byMember.length) {
    return `<p class="engine-empty">${t("engine.noUniqueContrib")}</p>`;
  }
  return `
    <ul class="engine-list engine-list--ranked">
      ${byMember.slice(0, 12).map((m, i) => `
        <li>
          <span class="engine-list__label"><span class="engine-rank">${i + 1}</span>${escapeHtml(m.username || m.userId)}</span>
          <span class="engine-list__count">${uniqueContributionCount(m)}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderEngineOverview(r) {
  const s = r.summary || {};
  const a = r.analysis || {};
  const mc = a.mostComplementaryMember || {};
  const uniqueOwners = a.uniqueOwners || {};
  // Étape 83 — community context mounts asynchronously (no ranking).
  queueMicrotask(() => loadSquadCommunityContext(r.squadId || state.activeSquad));
  return `
    <div class="engine-grid engine-grid--4">
      <div class="engine-card">
        <div class="engine-card__value">${formatPct(s.collectiveCompletionRate)}</div>
        <div class="engine-card__label">${t("engine.label.collectiveCompletionRate")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.coveredVariantCount, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${t("engine.label.coveredVariantCount")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.totalMissing, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${t("engine.label.totalMissing")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${safeFiniteNumber(s.totalUnique, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${t("engine.label.totalUnique")}</div>
      </div>
      <div class="engine-card">
        <div class="engine-card__value">${s.includedMemberCount != null ? safeFiniteNumber(s.includedMemberCount, 0, { min: 0, max: 1000000 }) : "—"}/${safeFiniteNumber(s.totalActiveMembers, 0, { min: 0, max: 1000000 })}</div>
        <div class="engine-card__label">${t("engine.label.includedMemberCount")}</div>
      </div>
      ${safeFiniteNumber(s.excludedPrivateCollections, 0, { min: 0, max: 1000000 }) > 0 ? `
        <div class="engine-card engine-card--warning">
          <div class="engine-card__value">${safeFiniteNumber(s.excludedPrivateCollections, 0, { min: 0, max: 1000000 })}</div>
          <div class="engine-card__label">${t("engine.label.excludedPrivateCollections")}</div>
        </div>
      ` : ""}
    </div>
    <div class="engine-section engine-section--community" id="squadCommunityContext" hidden>
      <h4 class="engine-section__title">${t("engine.communityContextTitle")}</h4>
      <p class="engine-section__hint">${t("engine.communityContextHint")}</p>
      <div class="engine-community" id="squadCommunityLines"></div>
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.label.mostComplementaryMember")}</h4>
      ${mc.username ? `
        <div class="engine-card engine-card--member">
          <div class="engine-card__value">${escapeHtml(mc.username)}</div>
          <div class="engine-card__label">${t("engine.uniqueContrib", { count: uniqueContributionCount(mc) })}</div>
          ${mc.contributionDisplay ? `<div class="engine-card__sub">${escapeHtml(mc.contributionDisplay)}</div>` : ""}
        </div>
      ` : `<p class="engine-empty">${t("engine.noComplementaryMember")}</p>`}
    </div>
    <div class="engine-section">
      <h4 class="engine-section__title">${t("engine.label.uniqueOwner")}</h4>
      ${renderUniqueOwnersLeaderboard(uniqueOwners)}
    </div>
    <div class="engine-meta">
      <span>${t("engine.generatedAt", { date: new Date(r.generatedAt).toLocaleString() })}</span>
      <span>${t("engine.catalogueVersion", { version: escapeHtml(r.catalogueVersion) })}</span>
    </div>
    ${(r.warnings || []).length ? `<div class="engine-warnings">${r.warnings.map(w => `<p class="engine-warning">${escapeHtml(w)}</p>`).join("")}</div>` : ""}
  `;
}

/** Étape 83–84 — gentle peer averages (by size band), never a leaderboard. */
async function loadSquadCommunityContext(squadRef) {
  const mount = document.getElementById("squadCommunityContext");
  const linesEl = document.getElementById("squadCommunityLines");
  if (!mount || !linesEl || !squadRef) return;
  try {
    const res = await fetch(
      `${API_BASE}/sprite-graph/squads/${encodeURIComponent(squadRef)}/community`,
      { headers: typeof authHeaders === "function" ? authHeaders() : {} }
    );
    if (!res.ok) {
      mount.hidden = true;
      return;
    }
    const data = await res.json();
    const coverage = data.coverage || {};
    const peerGroup = data.peerGroup || {};
    const band = {
      "2": t("engine.peerBand2"),
      "3": t("engine.peerBand3"),
      "4_6": t("engine.peerBand4To6"),
      "7_10": t("engine.peerBand7To10"),
      "11_plus": t("engine.peerBand11Plus")
    }[peerGroup.sizeBand?.id] || "—";
    const lines = [];
    if (coverage.collectiveCompletionRate != null) {
      lines.push(t("engine.communityCoverage", {
        name: data.squadName || t("engine.communitySquadDefault"),
        rate: formatUiPercent(coverage.collectiveCompletionRate, { maximumFractionDigits: 1 })
      }));
    }
    if (Number(peerGroup.comparableSquadCount) >= 3 && peerGroup.avgWeeklyProgressPoints != null) {
      const points = Number(peerGroup.avgWeeklyProgressPoints);
      lines.push(t("engine.communityPeerProgress", {
        band,
        points: `${points >= 0 ? "+" : ""}${formatUiNumber(points, { maximumFractionDigits: 1 })}`,
        s: Math.abs(points) === 1 ? "" : "s"
      }));
    } else if (Number(peerGroup.comparableSquadCount) > 0) {
      lines.push(t("engine.communityPeerLimited", { band }));
    }
    if (!lines.length) {
      mount.hidden = true;
      return;
    }
    linesEl.innerHTML = lines.map((line) => `
      <p class="engine-community__line">${escapeHtml(t(line))}</p>
    `).join("") + `<p class="engine-community__disclaimer">${escapeHtml(t("engine.communityDisclaimer"))}</p>`;
    mount.hidden = false;
  } catch (_e) {
    mount.hidden = true;
  }
}

