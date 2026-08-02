(() => {
  "use strict";

  async function loadEvents() {
    const newsStatus = state.events?.newsStatus || $("#newsStatusFilter")?.value || "all";
    if ($("#newsStatusFilter")) $("#newsStatusFilter").value = newsStatus;
    const newsQuery = new URLSearchParams({ pageSize: "20" });
    if (newsStatus !== "all") newsQuery.set("status", newsStatus);
    const [events, news] = await Promise.all([
      adminFetch("/api/admin/events?pageSize=20"),
      adminFetch(`/api/admin/news?${newsQuery}`)
    ]);
    state.events.visibleItems = events.items;
    events.items.forEach((item) => state.events.bulkItems.set(item.id, item));
    $("#eventsNewsMeta").textContent = english
      ? `${formatNumber(events.total)} event(s) · ${formatNumber(news.total)} news`
      : `${formatNumber(events.total)} événement(s) · ${formatNumber(news.total)} actualité(s)`;
    $("#eventsList").innerHTML = events.items.length
      ? events.items.map(item => `<tr>
          <td><input type="checkbox" data-bulk-event-toggle="${escapeHtml(item.id)}" ${state.events.bulkIds.has(item.id) ? "checked" : ""} aria-label="${english ? "Select" : "Sélectionner"} ${escapeHtml(item.name || item.id)}" /></td>
          <td><strong>${escapeHtml(item.name || item.id)}</strong><small>${escapeHtml(item.type || "—")} · ${formatNumber(item.availability_count)} ${english ? "availability periods" : "périodes"}</small></td>
          <td>${formatDate(item.start_date, false)}</td>
          <td>${formatDate(item.end_date, false)}</td>
          <td>${status(item.data_status || tr("unknown"), item.data_status === "complete" || item.data_status === "verified" ? "good" : "warning")}</td>
          <td>${can("events.write") ? `<button class="admin-row-button" type="button" data-edit-event="${escapeHtml(item.id)}">${tr("edit", "Modifier")}</button>` : ""}</td>
        </tr>`).join("")
      : `<tr><td colspan="6">${empty(tr("noEvents", "Aucun événement."))}</td></tr>`;
    renderBulkBar("events");
    $("#newsList").innerHTML = news.items.length
      ? news.items.map(item => {
        const thumb = item.image
          ? `<span class="admin-news__thumb"><img src="${escapeHtml(item.image)}" alt="" loading="lazy" /></span>`
          : `<span class="admin-news__thumb" aria-hidden="true">✦</span>`;
        const canPublish = item.status !== "published";
        const canArchive = item.status === "published";
        return `<article class="admin-news">
          ${thumb}
          <div class="admin-news__body">
            <div class="admin-news__top">
              <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.source)} · ${formatDate(item.news_date, false)}${item.editor_note ? ` · ${english ? "note" : "note"}` : ""}</small></span>
              ${status(label(item.status), item.status === "published" ? "good" : item.status === "draft" ? "warning" : "")}
            </div>
            <p>${escapeHtml(item.description || "")}</p>
            <div class="admin-news__actions">
              ${can("events.write") ? `<button class="admin-row-button" type="button" data-edit-news="${item.id}">${tr("edit", "Modifier")}</button>
              ${canPublish ? `<button class="admin-row-button" type="button" data-news-action="publish" data-news-id="${item.id}">${tr("publish", "Publier")}</button>` : ""}
              ${canArchive ? `<button class="admin-row-button" type="button" data-news-action="archive" data-news-id="${item.id}">${tr("archive", "Archiver")}</button>` : ""}` : ""}
            </div>
          </div>
        </article>`;
      }).join("")
      : empty(tr("noNews", "Aucune actualité."));
  }

  Object.assign(window, { loadEvents });
})();
