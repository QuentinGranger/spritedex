(() => {
  "use strict";

  function applyStaticCopy() {
    if (!english) return;
    $$("[data-admin-copy]").forEach((node) => {
      node.textContent = tr(node.dataset.adminCopy, node.textContent);
    });
    $$("[data-admin-placeholder]").forEach((node) => {
      node.placeholder = tr(node.dataset.adminPlaceholder, node.placeholder);
    });
    const newsFilterLabels = { all: "All news", draft: "Drafts", published: "Published", archived: "Archived" };
    $$("#newsStatusFilter option").forEach((option) => {
      if (newsFilterLabels[option.value]) option.textContent = newsFilterLabels[option.value];
    });
    const newsStatusLabels = { draft: "Draft", published: "Published", archived: "Archived" };
    $$("#newsEditorStatus option").forEach((option) => {
      if (newsStatusLabels[option.value]) option.textContent = newsStatusLabels[option.value];
    });
    const squadJoinLabels = { all: "All access states", open: "Open joining", closed: "Closed joining" };
    $$("#squadJoinFilter option").forEach((option) => {
      if (squadJoinLabels[option.value]) option.textContent = squadJoinLabels[option.value];
    });
    const deletionFilterLabels = { all: "Entire queue", ready: "Ready to purge", pending: "In retention" };
    $$("#privacyDeletionFilter option").forEach((option) => {
      if (deletionFilterLabels[option.value]) option.textContent = deletionFilterLabels[option.value];
    });
    document.documentElement.lang = "en";
    document.title = "SPRITE-INDEX — Backoffice";
  }

  function setTab(tab) {
    if (!headings[tab]) return;
    if (state.session?.tabs && state.session.tabs[tab] !== true) {
      setAlert(english ? "This section is outside your role." : "Cette section n’est pas dans votre rôle.");
      return;
    }
    state.tab = tab;
    $$("[data-admin-tab]").forEach((node) => {
      const active = node.dataset.adminTab === tab;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-current", active ? "page" : "false");
    });
    $$("[data-admin-panel]").forEach((node) => {
      const active = node.dataset.adminPanel === tab;
      node.hidden = !active;
      node.classList.toggle("is-active", active);
    });
    const [eyebrow, title, lead] = headings[tab];
    $("#adminEyebrow").textContent = eyebrow;
    $("#adminTitle").textContent = title;
    $("#adminLead").textContent = lead;
    setAlert();
    loadTab(tab);
  }

  function openUniversalSearch() {
    const dialog = $("#adminSearchDialog");
    if (!dialog?.open) dialog?.showModal();
    state.universalSearch = {
      ...state.universalSearch,
      request: state.universalSearch.request + 1,
      results: [],
      groups: [],
      activeGroup: "all",
      activeIndex: -1,
      loading: false
    };
    $("#adminSearchInput").value = "";
    $("#adminSearchInput").setAttribute("aria-expanded", "false");
    $("#adminSearchHint").textContent = english
      ? "Type at least 2 characters. Results only include areas you can access."
      : "Saisissez au moins 2 caractères. Les résultats respectent vos droits d’accès.";
    renderUniversalQuickActions();
    $("#adminSearchState").classList.remove("is-loading");
    requestAnimationFrame(() => $("#adminSearchInput").focus());
  }

  function closeUniversalSearch() {
    clearTimeout(state.universalSearch.timer);
    state.universalSearch.request += 1;
    state.universalSearch.loading = false;
    if ($("#adminSearchDialog")?.open) $("#adminSearchDialog").close();
  }

  function universalQuickActions() {
    const commands = [
      {
        id: "players",
        title: english ? "Find or moderate a player" : "Rechercher ou modérer un joueur",
        subtitle: english ? "Open player operations" : "Ouvrir les opérations joueurs",
        icon: "♙",
        capability: "players.read"
      },
      {
        id: "catalog",
        title: english ? "Review the catalog" : "Réviser le catalogue",
        subtitle: english ? "Sprites, variants and editorial workflow" : "Sprites, variantes et workflow éditorial",
        icon: "✦",
        capability: "catalog.read"
      },
      {
        id: "event-create",
        title: english ? "Create an event" : "Créer un événement",
        subtitle: english ? "Open the audited event form" : "Ouvrir le formulaire d’événement audité",
        icon: "＋",
        capability: "events.write"
      },
      {
        id: "notifications",
        title: english ? "Review notification deliveries" : "Vérifier les livraisons de notifications",
        subtitle: english ? "Failed jobs and retry queue" : "Jobs en échec et file de relance",
        icon: "◉",
        capability: "notifications.read"
      },
      {
        id: "collections",
        title: english ? "Check collection consistency" : "Vérifier la cohérence des collections",
        subtitle: english ? "Inspect safe repair candidates" : "Inspecter les corrections sûres",
        icon: "▦",
        capability: "collections.read"
      },
      {
        id: "audit",
        title: english ? "Open the audit trail" : "Ouvrir le journal d’audit",
        subtitle: english ? "Review recent administrative actions" : "Consulter les dernières actions administratives",
        icon: "◌",
        capability: "audit.read"
      }
    ];
    return commands.filter((command) => can(command.capability)).map((command) => ({ ...command, action: "command" }));
  }

  function renderUniversalQuickActions() {
    const items = universalQuickActions();
    state.universalSearch.groups = items.length
      ? [{ key: "commands", label: english ? "Quick actions" : "Actions rapides", items }]
      : [];
    state.universalSearch.activeGroup = "all";
    state.universalSearch.activeIndex = items.length ? 0 : -1;
    state.universalSearch.query = "";
    $("#adminSearchHint").textContent = english
      ? "Start from a safe shortcut, or search across the backoffice."
      : "Démarrez par un raccourci sûr, ou recherchez dans tout le backoffice.";
    renderUniversalSearch();
  }

  function highlightUniversalText(value, query = state.universalSearch.query) {
    const escaped = escapeHtml(value || "");
    const term = escapeHtml((query || "").trim());
    if (!term) return escaped;
    const pattern = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(new RegExp(`(${pattern})`, "ig"), "<mark>$1</mark>");
  }

  function renderUniversalSearch(groups = state.universalSearch.groups) {
    const filter = state.universalSearch.activeGroup;
    const visibleGroups = filter === "all" ? groups : groups.filter((group) => group.key === filter);
    const filters = $("#adminSearchFilters");
    filters.hidden = !groups.length;
    filters.innerHTML = groups.length
      ? `<button class="${filter === "all" ? "is-active" : ""}" type="button" data-universal-filter="all">${english ? "All" : "Tout"}<b>${formatNumber(groups.reduce((count, group) => count + group.items.length, 0))}</b></button>${groups.map((group) => `<button type="button" class="${filter === group.key ? "is-active" : ""}" data-universal-filter="${escapeHtml(group.key)}">${escapeHtml(group.label)}<b>${formatNumber(group.items.length)}</b></button>`).join("")}`
      : "";
    filters.querySelector(`[data-universal-filter="${CSS.escape(filter)}"]`)?.classList.add("is-active");
    state.universalSearch.results = visibleGroups.flatMap((group) =>
      group.items.map((item) => ({ ...item, group: group.key }))
    );
    if (state.universalSearch.activeIndex >= state.universalSearch.results.length)
      state.universalSearch.activeIndex = state.universalSearch.results.length - 1;
    const icons = {
      player: "♙",
      catalog: "✦",
      event: "◷",
      squad: "⌘",
      invitation: "✉",
      friendInvite: "↗",
      notification: "◉",
      audit: "◌",
      command: "⌁"
    };
    $("#adminSearchInput").setAttribute("aria-expanded", state.universalSearch.results.length ? "true" : "false");
    $("#adminSearchResults").innerHTML = visibleGroups.length
      ? visibleGroups
          .map(
            (group) =>
              `<section class="admin-search-group"><h3>${escapeHtml(group.label)}<span>${formatNumber(group.items.length)}</span></h3>${group.items
                .map((item) => {
                  const index = state.universalSearch.results.findIndex(
                    (result) => result.group === group.key && result.id === item.id && result.action === item.action
                  );
                  return `<button class="admin-search-result ${index === state.universalSearch.activeIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${index === state.universalSearch.activeIndex}" data-universal-index="${index}" data-universal-result="${escapeHtml(item.action)}" data-universal-id="${escapeHtml(item.id)}" data-universal-parent="${escapeHtml(item.parentId || "")}"><span class="admin-search-result__icon" aria-hidden="true">${item.icon || icons[item.action] || "◈"}</span><span><strong>${highlightUniversalText(item.title)}</strong><small>${highlightUniversalText(item.subtitle || "")}</small></span><b aria-hidden="true">›</b></button>`;
                })
                .join("")}</section>`
          )
          .join("")
      : empty(english ? "No accessible result." : "Aucun résultat accessible.");
  }

  function moveUniversalSelection(step) {
    const results = state.universalSearch.results;
    if (!results.length) return;
    state.universalSearch.activeIndex = (state.universalSearch.activeIndex + step + results.length) % results.length;
    $$(".admin-search-result").forEach((node, index) => {
      const active = index === state.universalSearch.activeIndex;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", String(active));
      if (active) node.scrollIntoView({ block: "nearest" });
    });
  }

  async function searchUniversally(query) {
    const request = ++state.universalSearch.request;
    const clean = query.trim();
    if (clean.length < 2) {
      renderUniversalQuickActions();
      return;
    }
    state.universalSearch.loading = true;
    $("#adminSearchState").classList.add("is-loading");
    $("#adminSearchHint").textContent = english ? "Searching across the backoffice…" : "Recherche dans le backoffice…";
    try {
      const data = await adminFetch(`/api/admin/search?q=${encodeURIComponent(clean)}`);
      if (request !== state.universalSearch.request) return;
      state.universalSearch.loading = false;
      $("#adminSearchState").classList.remove("is-loading");
      state.universalSearch.groups = data.groups || [];
      state.universalSearch.query = clean;
      state.universalSearch.activeGroup = "all";
      state.universalSearch.activeIndex = state.universalSearch.groups.length ? 0 : -1;
      $("#adminSearchHint").textContent = data.groups?.length
        ? english
          ? "Use ↑ ↓ to browse, Enter to open."
          : "Utilisez ↑ ↓ pour parcourir, Entrée pour ouvrir."
        : english
          ? "No accessible result."
          : "Aucun résultat accessible.";
      renderUniversalSearch();
    } catch (error) {
      if (request !== state.universalSearch.request) return;
      state.universalSearch.loading = false;
      $("#adminSearchState").classList.remove("is-loading");
      $("#adminSearchHint").textContent = error.message || tr("loadFailed");
      $("#adminSearchResults").innerHTML = "";
    }
  }

  async function openUniversalResult(button) {
    const action = button.dataset.universalResult,
      id = button.dataset.universalId,
      parent = button.dataset.universalParent;
    closeUniversalSearch();
    try {
      if (action === "player") {
        setTab("players");
        await selectPlayer(id);
      } else if (action === "catalog") {
        setTab("catalog");
        await selectCatalog(parent || id);
      } else if (action === "event") {
        setTab("events");
        if (can("events.write")) await editEvent({ dataset: { editEvent: id } });
      } else if (action === "squad") {
        setTab("social");
        await selectSquad(id);
      } else if (action === "invitation") {
        setTab("social");
        await selectSquad(parent);
      } else if (action === "friendInvite") {
        setTab("social");
      } else if (action === "notification") {
        setTab("notifications");
        requestAnimationFrame(() =>
          document
            .querySelector(`[data-retry-job="${CSS.escape(id)}"]`)
            ?.closest("article")
            ?.scrollIntoView({ block: "center", behavior: "smooth" })
        );
      } else if (action === "audit") {
        state.audit = { ...state.audit, page: 1, q: button.querySelector("strong")?.textContent || "" };
        setTab("privacy");
      } else if (action === "command") {
        if (id === "event-create") {
          setTab("events");
          openEventEditor("create");
        } else setTab(id);
      }
    } catch (error) {
      setAlert(error.message || tr("loadFailed"));
    }
  }

  async function loadTab(tab, force = false) {
    if (state.loading.has(tab) && !force) return;
    setLoading(tab, true);
    try {
      const loaders = {
        overview: loadOverview,
        players: loadPlayers,
        catalog: loadCatalog,
        events: loadEvents,
        collections: loadCollections,
        social: loadSocial,
        notifications: loadNotifications,
        intelligence: loadIntelligence,
        passports: loadPassports,
        privacy: loadPrivacy
      };
      await (loaders[tab] || loadOverview)();
      $("#adminUpdated").textContent = tr("updated", "Actualisé {time}").replace("{time}", formatDate(new Date()));
    } catch (error) {
      if (error.message !== "unauthorized") setAlert(error.message || tr("loadFailed"));
    } finally {
      setLoading(tab, false);
    }
  }

  Object.assign(window, {
    applyStaticCopy,
    setTab,
    openUniversalSearch,
    closeUniversalSearch,
    universalQuickActions,
    renderUniversalQuickActions,
    highlightUniversalText,
    renderUniversalSearch,
    moveUniversalSelection,
    searchUniversally,
    openUniversalResult,
    loadTab
  });
})();
