(() => {
  "use strict";

  function openEventEditor(mode, eventData = null) {
    state.eventEditor = { mode, id: eventData?.id || null };
    $("#eventEditorTitle").textContent =
      mode === "create"
        ? english
          ? "Create event"
          : "Créer un événement"
        : english
          ? "Edit event"
          : "Modifier l’événement";
    $("#eventEditorSummary").textContent = english
      ? "Calendar changes stay auditable and feed availability linking."
      : "Les changements de calendrier restent audités et alimentent les liaisons de disponibilité.";
    $("#eventEditorIdField").hidden = mode !== "create";
    $("#eventEditorId").required = mode === "create";
    $("#eventEditorId").value = eventData?.id || "";
    $("#eventEditorId").readOnly = mode !== "create";
    $("#eventEditorName").value = eventData?.name || "";
    $("#eventEditorType").value = eventData?.type || "";
    $("#eventEditorSeasonId").value = eventData?.season_id || "";
    $("#eventEditorStartDate").value = toLocalInput(eventData?.start_date);
    $("#eventEditorEndDate").value = toLocalInput(eventData?.end_date);
    $("#eventEditorDataStatus").value = eventData?.data_status || "incomplete";
    $("#eventEditorReason").value = "";
    $("#eventEditorError").hidden = true;
    $("#eventEditorSubmit").textContent = english ? "Save" : "Enregistrer";
    $("#eventEditorDialog").showModal();
    (mode === "create" ? $("#eventEditorId") : $("#eventEditorName")).focus();
  }

  async function editEvent(button) {
    try {
      const data = await adminFetch(`/api/admin/events/${encodeURIComponent(button.dataset.editEvent)}`);
      openEventEditor("edit", data.event);
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  function createEvent() {
    openEventEditor("create");
  }

  async function submitEventEditor(event) {
    event.preventDefault();
    const operation = state.eventEditor;
    if (!operation) return;
    const errorNode = $("#eventEditorError");
    errorNode.hidden = true;
    const payload = {
      name: $("#eventEditorName").value.trim(),
      type: $("#eventEditorType").value.trim() || null,
      seasonId: $("#eventEditorSeasonId").value.trim() || null,
      startDate: $("#eventEditorStartDate").value || "",
      endDate: $("#eventEditorEndDate").value || "",
      dataStatus: $("#eventEditorDataStatus").value,
      reason: $("#eventEditorReason").value.trim()
    };
    if (!payload.reason) {
      errorNode.textContent = tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const submit = $("#eventEditorSubmit");
    submit.disabled = true;
    try {
      if (operation.mode === "create") {
        payload.id = $("#eventEditorId").value.trim();
        await adminFetch("/api/admin/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        setNotice(english ? "Event created." : "Événement créé.");
      } else {
        await adminFetch(`/api/admin/events/${encodeURIComponent(operation.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        setNotice(english ? "Event updated." : "Événement mis à jour.");
      }
      closeEditorialDialog("#eventEditorDialog");
      await loadTab("events", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  function willFanoutNews(status = $("#newsEditorStatus")?.value) {
    const previous = state.newsEditor?.previousStatus || "draft";
    return status === "published" && previous !== "published";
  }

  function refreshNewsPreview() {
    const title = $("#newsEditorTitleInput")?.value.trim() || (english ? "Untitled" : "Sans titre");
    const body =
      $("#newsEditorDescription")?.value.trim() ||
      (english ? "The description will appear here." : "La description apparaîtra ici.");
    const image = $("#newsEditorImage")?.value.trim();
    const link = $("#newsEditorLink")?.value.trim();
    const dateValue = $("#newsEditorNewsDate")?.value;
    $("#newsEditorPreviewTitle").textContent = title;
    $("#newsEditorPreviewBody").textContent = body;
    const meta = [
      "backoffice",
      dateValue ? formatDate(dateValue, false) : null,
      link ? (english ? "has link" : "lien défini") : null
    ]
      .filter(Boolean)
      .join(" · ");
    $("#newsEditorPreviewMeta").textContent = meta;
    const media = $("#newsEditorPreviewMedia");
    if (!media) return;
    if (image) {
      media.hidden = false;
      media.innerHTML = `<img src="${escapeHtml(image)}" alt="" />`;
    } else {
      media.hidden = true;
      media.innerHTML = "";
    }
  }

  function syncNewsEditorChrome() {
    const warning = $("#newsEditorFanoutWarning");
    const submit = $("#newsEditorSubmit");
    const fanout = willFanoutNews();
    if (warning) {
      warning.hidden = !fanout;
      warning.textContent = english
        ? "Publishing will fan this story out to every player (inbox, push and live)."
        : "La publication enverra cette actualité à tous les joueurs (inbox, push et live).";
    }
    if (submit) {
      submit.textContent = fanout
        ? english
          ? "Publish & fan out"
          : "Publier & diffuser"
        : english
          ? "Save"
          : "Enregistrer";
    }
    refreshNewsPreview();
  }

  function openNewsEditor(mode, news = null, options = {}) {
    const previousStatus = options.previousStatus ?? news?.status ?? "draft";
    const statusValue = options.forceStatus || news?.status || "draft";
    state.newsEditor = { mode, id: news?.id || null, previousStatus };
    $("#newsEditorTitle").textContent =
      mode === "create"
        ? english
          ? "Create news"
          : "Créer une actualité"
        : english
          ? "Edit news"
          : "Modifier l’actualité";
    $("#newsEditorSummary").textContent = english
      ? "Draft freely. First publish fans out inbox, push and live updates."
      : "Travaillez en brouillon. La première publication déclenche le fan-out.";
    $("#newsEditorTitleInput").value = news?.title || "";
    $("#newsEditorDescription").value = news?.description || "";
    $("#newsEditorImage").value = news?.image || "";
    $("#newsEditorLink").value = news?.link || "";
    $("#newsEditorNewsDate").value =
      toLocalInput(news?.news_date) || (mode === "create" ? toLocalInput(new Date()) : "");
    $("#newsEditorStatus").value = statusValue;
    $("#newsEditorNote").value = news?.editor_note || "";
    $("#newsEditorReason").value = "";
    $("#newsEditorReason").placeholder = options.reasonHint || "";
    $("#newsEditorError").hidden = true;
    syncNewsEditorChrome();
    $("#newsEditorDialog").showModal();
    (options.focusReason ? $("#newsEditorReason") : $("#newsEditorTitleInput")).focus();
  }

  function createNews() {
    openNewsEditor("create");
  }

  async function editNews(button) {
    try {
      const data = await adminFetch(`/api/admin/news/${encodeURIComponent(button.dataset.editNews)}`);
      openNewsEditor("edit", data.news);
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  async function updateNewsStatus(button) {
    const next = button.dataset.newsAction === "publish" ? "published" : "archived";
    try {
      const data = await adminFetch(`/api/admin/news/${encodeURIComponent(button.dataset.newsId)}`);
      openNewsEditor("edit", data.news, {
        previousStatus: data.news.status,
        forceStatus: next,
        focusReason: true,
        reasonHint:
          next === "published"
            ? english
              ? "Why publish this item?"
              : "Pourquoi publier cette actualité ?"
            : english
              ? "Why archive this item?"
              : "Pourquoi archiver cette actualité ?"
      });
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  async function submitNewsEditor(event) {
    event.preventDefault();
    const operation = state.newsEditor;
    if (!operation) return;
    const errorNode = $("#newsEditorError");
    errorNode.hidden = true;
    const payload = {
      title: $("#newsEditorTitleInput").value.trim(),
      description: $("#newsEditorDescription").value.trim(),
      image: $("#newsEditorImage").value.trim(),
      link: $("#newsEditorLink").value.trim(),
      newsDate: $("#newsEditorNewsDate").value || "",
      status: $("#newsEditorStatus").value,
      editorNote: $("#newsEditorNote").value.trim(),
      reason: $("#newsEditorReason").value.trim()
    };
    if (!payload.title || !payload.reason) {
      errorNode.textContent = !payload.title
        ? english
          ? "Title is required."
          : "Le titre est requis."
        : tr("reasonRequired");
      errorNode.hidden = false;
      return;
    }
    const submit = $("#newsEditorSubmit");
    submit.disabled = true;
    try {
      let result;
      if (operation.mode === "create") {
        result = await adminFetch("/api/admin/news", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        result = await adminFetch(`/api/admin/news/${encodeURIComponent(operation.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }
      closeEditorialDialog("#newsEditorDialog");
      if (result?.fanout) {
        setNotice(
          english
            ? `Published with fan-out (${formatNumber(result.fanout.inboxNotifications || 0)} inbox notification(s)).`
            : `Publiée avec fan-out (${formatNumber(result.fanout.inboxNotifications || 0)} notification(s) inbox).`
        );
      } else {
        setNotice(english ? "News saved." : "Actualité enregistrée.");
      }
      await loadTab("events", true);
    } catch (error) {
      errorNode.textContent = error.message || tr("saveFailed");
      errorNode.hidden = false;
    } finally {
      submit.disabled = false;
    }
  }

  Object.assign(window, {
    openEventEditor,
    editEvent,
    createEvent,
    submitEventEditor,
    willFanoutNews,
    refreshNewsPreview,
    syncNewsEditorChrome,
    openNewsEditor,
    createNews,
    editNews,
    updateNewsStatus,
    submitNewsEditor
  });
})();
