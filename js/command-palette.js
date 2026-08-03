/* Global command palette: collections, people, events and direct actions. */
let commandPaletteItems = [];
let commandPaletteActiveIndex = -1;
let commandPaletteDomTargets = new Map();
let commandPaletteDomTargetId = 0;
let commandPaletteOpener = null;
let commandPaletteSuppressDesktopReopen = false;

function commandNormalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase(typeof appLocale === "function" && appLocale() === "en" ? "en" : "fr")
    .trim();
}

function commandText(french, english) {
  return typeof appLocale === "function" && appLocale() === "en" ? english : french;
}

function commandViewName(view) {
  const labels = {
    missing: ["Manquants", "Missing"],
    checklist: ["Checklist", "Checklist"],
    social: ["Social", "Social"],
    stats: ["Stats", "Stats"],
    history: ["Historique", "History"],
    swipe: ["Swipe", "Swipe"],
    home: ["Accueil", "Home"]
  };
  const [french, english] = labels[view] || labels.home;
  return commandText(french, english);
}

function commandScore(haystack, query) {
  const value = commandNormalize(haystack);
  if (!query || !value) return 0;
  if (value === query) return 100;
  if (value.startsWith(query)) return 60;
  if (value.includes(query)) return 25;
  const terms = query.split(/\s+/).filter(Boolean);
  if (!terms.length || !terms.every((term) => value.includes(term))) return -1;
  return terms.reduce((score, term) => score + (value.startsWith(term) ? 16 : 7), 0);
}

function commandIcon(item) {
  if (item.image) return `<img src="${escapeHtml(safeImageUrl(item.image) || "")}" alt="" loading="lazy">`;
  return escapeHtml(item.icon || "•");
}

function commandItem(group, item) {
  return { group, ...item };
}

function getCommandBadges() {
  const stored = Array.isArray(globalThis.spriteIndexBadges) ? globalThis.spriteIndexBadges : [];
  if (stored.length) return stored;
  return [...document.querySelectorAll("[data-badge-code], #accountBadgePreview [data-badge-category]")]
    .map((node) => ({
      badgeCode: node.dataset.badgeCode || node.getAttribute("title") || node.textContent?.trim(),
      label:
        node.getAttribute("title") ||
        node.querySelector("small, strong")?.textContent?.trim() ||
        node.textContent?.trim(),
      iconUrl: node.querySelector("img")?.getAttribute("src") || ""
    }))
    .filter((badge) => badge.label);
}

function commandTextForNode(node) {
  return [
    typeof t === "function" ? t(node.getAttribute("data-i18n") || "") : node.getAttribute("data-i18n"),
    node.getAttribute("aria-label"),
    node.getAttribute("title"),
    node.getAttribute("placeholder"),
    node.textContent
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function commandViewForNode(node) {
  const view = node.closest(".view");
  return view?.id?.replace(/^view-/, "") || "";
}

function commandDomActions(query) {
  const results = [];
  commandPaletteDomTargets = new Map();
  const excluded = [
    "#commandPalette *",
    ".login-screen *",
    ".close-button",
    "[data-command-palette-close]",
    "[data-mobile-more-close]",
    "#accountClose",
    "#deleteConfirmBtn",
    "#resetData",
    "#accountLogout",
    "#accountDeleteOpen",
    "[disabled]"
  ].join(", ");
  document
    .querySelectorAll(
      "#mainTabs button, #mainViews button, #mainViews a, #mainViews input, #mainViews select, #accountPanel button, #accountPanel input, #accountPanel select, #notifBell, #notifDropdown button"
    )
    .forEach((node) => {
      if (node.matches(excluded)) return;
      const text = commandTextForNode(node);
      const view = commandViewForNode(node);
      const scope = node.closest("#accountPanel")
        ? commandText(
            "compte réglages profil confidentialité notifications sécurité",
            "account settings profile privacy notifications security"
          )
        : view
          ? commandText(`navigation outils ${view}`, `navigation tools ${view}`)
          : commandText("outils notifications", "tools notifications");
      const score = commandScore(`${text} ${scope}`, query);
      if (score < 0 || !text) return;
      const targetKey = `dom-${++commandPaletteDomTargetId}`;
      commandPaletteDomTargets.set(targetKey, node);
      results.push(
        commandItem(scope, {
          type: "dom",
          targetKey,
          title: text,
          subtitle: view
            ? commandText(`Ouvrir dans ${commandViewName(view)}`, `Open in ${commandViewName(view)}`)
            : commandText("Action de l’application", "App action"),
          tag: commandText("Outil", "Tool"),
          icon: "⌘",
          score
        })
      );
    });
  return results;
}

function commandContentItems(query) {
  const results = [];
  const selectors = [
    "#mainViews article",
    "#mainViews .stats-module",
    "#mainViews .friend-card",
    "#mainViews .friend-row",
    "#mainViews .squad-card",
    "#mainViews .squad-table-wrap tr",
    "#mainViews .farm-planner__item",
    "#mainViews .history-item",
    "#accountPanel article",
    "#accountPanel .account-section"
  ].join(", ");
  document.querySelectorAll(selectors).forEach((node) => {
    if (node.closest("#commandPalette, .login-screen") || node.matches("[aria-hidden='true']")) return;
    const text = commandTextForNode(node);
    const score = commandScore(text, query);
    if (score < 0 || !text) return;
    const title = commandTextForNode(
      node.querySelector("h2, h3, h4, strong, .friend-name, .farm-planner__name") || node
    ).slice(0, 100);
    const targetKey = `content-${++commandPaletteDomTargetId}`;
    commandPaletteDomTargets.set(targetKey, node);
    const view = commandViewForNode(node);
    results.push(
      commandItem(commandText("Contenus", "Content"), {
        type: "content",
        targetKey,
        title: title || commandText("Contenu de l’application", "App content"),
        subtitle: view
          ? commandText(`Voir dans ${commandViewName(view)}`, `View in ${commandViewName(view)}`)
          : commandText("Voir dans Mon compte", "View in My account"),
        tag: commandText("Contenu", "Content"),
        icon: "◌",
        score
      })
    );
  });
  return results;
}

function commandCurrentCardActions(query) {
  const item = typeof currentItem === "function" ? currentItem() : null;
  if (!item) return [];
  const actions = [
    [
      "owned",
      commandText("Marquer la carte actuelle comme possédée", "Mark the current card as owned"),
      commandText("Possédé", "Owned"),
      "✓"
    ],
    [
      "missing",
      commandText("Marquer la carte actuelle comme manquante", "Mark the current card as missing"),
      commandText("Manquant", "Missing"),
      "−"
    ],
    [
      "priority",
      commandText("Mettre la carte actuelle en priorité", "Set the current card as a priority"),
      commandText("Priorité", "Priority"),
      "★"
    ],
    [
      "unsure",
      commandText("Mettre la carte actuelle à vérifier", "Mark the current card to check"),
      commandText("À vérifier", "To check"),
      "?"
    ],
    [
      "spotted",
      commandText("Signaler la carte actuelle comme rare vue", "Mark the current card as a rare sighting"),
      commandText("Rare vu", "Rare sighting"),
      "◉"
    ]
  ];
  return actions
    .map(([status, title, subtitle, icon]) => {
      const score = commandScore(`${title} ${status} ${item.spriteName} ${item.variantName || item.variant}`, query);
      return score < 0
        ? null
        : commandItem(commandText("Actions rapides", "Quick actions"), {
            type: "status",
            status,
            itemId: item.id,
            title,
            subtitle: `${item.spriteName} · ${item.variantName || item.variant}`,
            tag: commandText("Carte", "Card"),
            icon,
            score: score + 30
          });
    })
    .filter(Boolean);
}

function commandNavigationItems(query) {
  const entries = [
    [
      "navigate",
      "home",
      commandText("Accueil · Que faire maintenant ?", "Home · What should I do now?"),
      commandText("Priorités, événements et recommandations", "Priorities, events and recommendations"),
      commandText("accueil tableau de bord priorités maintenant", "home dashboard priorities now")
    ],
    [
      "navigate",
      "swipe",
      commandText("Ouvrir le swipe", "Open swipe"),
      commandText("Trier les variantes une par une", "Sort variants one by one"),
      commandText("swipe cartes tri collection", "swipe cards sort collection")
    ],
    [
      "navigate",
      "checklist",
      commandText("Ouvrir la checklist", "Open checklist"),
      commandText("Toute ta collection et ses filtres", "Your full collection and its filters"),
      commandText("checklist collection liste sprites variantes", "checklist collection list sprites variants")
    ],
    [
      "navigate",
      "missing",
      commandText("Ouvrir les manquants", "Open missing items"),
      commandText("Plan de farm et variantes à obtenir", "Farm plan and variants to collect"),
      commandText("manquants manquant farm priorités événements", "missing farm priorities events")
    ],
    [
      "navigate",
      "stats",
      commandText("Ouvrir les statistiques", "Open stats"),
      commandText("Progression, raretés et tendances", "Progress, rarities and trends"),
      commandText("stats statistiques progression rareté tendances", "stats progress rarity trends")
    ],
    [
      "navigate",
      "history",
      commandText("Ouvrir l’historique", "Open history"),
      commandText("Toutes les actions de collection", "Every collection action"),
      commandText("historique activité actions récentes", "history activity recent actions")
    ],
    [
      "social",
      "friends",
      commandText("Ouvrir les amis", "Open friends"),
      commandText("Amis, invitations et QR code", "Friends, invitations and QR code"),
      commandText("amis demandes invitations qr code", "friends requests invitations qr code")
    ],
    [
      "social",
      "compare",
      commandText("Comparer une collection", "Compare collections"),
      commandText("Comparer avec un ami ou une squad", "Compare with a friend or squad"),
      commandText(
        "comparer comparaison ami collections complémentaires",
        "compare comparison friend complementary collections"
      )
    ],
    [
      "social",
      "squad",
      commandText("Ouvrir mon escouade", "Open my squad"),
      commandText("Membres, souhaits et couverture", "Members, wishlist and coverage"),
      commandText("squad escouade membres souhaits wishlist", "squad members wishlist")
    ],
    [
      "account",
      "",
      commandText("Ouvrir mon compte", "Open my account"),
      commandText("Profil, passeport et réglages", "Profile, passport and settings"),
      commandText(
        "compte profil passeport réglages préférences confidentialité sécurité",
        "account profile passport settings preferences privacy security"
      )
    ],
    [
      "notification",
      "",
      commandText("Ouvrir les notifications", "Open notifications"),
      commandText("Actualités, alertes et invitations", "News, alerts and invitations"),
      commandText("notifications actualités alertes news invitations", "notifications news alerts invitations")
    ]
  ];
  return entries
    .map(([type, target, title, subtitle, aliases]) => {
      const score = commandScore(`${title} ${subtitle} ${aliases}`, query);
      return score < 0
        ? null
        : commandItem("Navigation", {
            type,
            target,
            title,
            subtitle,
            tag: commandText("Ouvrir", "Open"),
            icon: "→",
            score
          });
    })
    .filter(Boolean);
}

function getCommandPaletteItems(query) {
  const scoreFor = (value) => commandScore(value, query);
  const results = [];
  const add = (group, item, haystack) => {
    const score = scoreFor(haystack);
    if (!query || score >= 0) results.push(commandItem(group, { ...item, score }));
  };

  if (!query) {
    add(
      "Actions",
      {
        type: "navigate",
        target: "home",
        title: commandText("Voir quoi faire maintenant", "See what to do next"),
        subtitle: commandText("Tes priorités et prochaines étapes", "Your priorities and next steps"),
        tag: commandText("Accueil", "Home"),
        icon: "✦"
      },
      commandText("accueil priorités maintenant", "home priorities next")
    );
    add(
      "Actions",
      {
        type: "navigate",
        target: "missing",
        title: commandText("Ouvrir le plan de farm", "Open farm plan"),
        subtitle: commandText("Variantes prioritaires et événements", "Priority variants and events"),
        tag: "Plan",
        icon: "⌁"
      },
      commandText("plan farm événement", "farm plan event")
    );
    add(
      "Actions",
      {
        type: "passport",
        title: commandText("Ouvrir mon passeport", "Open my passport"),
        subtitle: commandText("Badges, progression et profil", "Badges, progress and profile"),
        tag: commandText("Profil", "Profile"),
        icon: "▣"
      },
      commandText("passeport badges profil", "passport badges profile")
    );
    add(
      "Actions",
      {
        type: "navigate",
        target: "swipe",
        title: commandText("Continuer le swipe", "Continue swiping"),
        subtitle: commandText("Mettre à jour ta collection", "Update your collection"),
        tag: "Swipe",
        icon: "↔"
      },
      "swipe collection"
    );
    results.push(...commandCurrentCardActions(commandText("carte", "card")));
    return results;
  }

  results.push(...commandNavigationItems(query));

  getAllItems().forEach((item) => {
    const entry = getEntry(item.id);
    const label = `${item.spriteName} ${item.variantName || item.variant} ${item.rarity || ""} ${entry.status || ""} ${entry.priority || ""} ${entry.note || ""}`;
    const score = scoreFor(label);
    const actionScore = scoreFor(
      `${label} ${commandText("marquer possédé obtenu collection", "mark owned collected collection")}`
    );
    if (score < 0 && actionScore < 0) return;
    if (score >= 0)
      results.push(
        commandItem(commandText("Sprites et variantes", "Sprites & variants"), {
          type: "variant",
          itemId: item.id,
          title: item.spriteName,
          subtitle: `${item.variantName || item.variant} · ${localizedRarity(item.rarity) || commandText("Variante", "Variant")}`,
          tag: commandText("Variante", "Variant"),
          image: item.img,
          score
        })
      );
    if (entry.status !== "owned") {
      if (actionScore >= 0)
        results.push(
          commandItem(commandText("Actions rapides", "Quick actions"), {
            type: "owned",
            itemId: item.id,
            title: `${commandText("Marquer possédé", "Mark owned")} · ${item.spriteName}`,
            subtitle: item.variantName || item.variant,
            tag: "Action",
            image: item.img,
            score: actionScore + 8
          })
        );
    }
  });

  (Array.isArray(friendsState?.friends) ? friendsState.friends : []).forEach((friend) => {
    const name = friend.displayName || friend.username || "";
    const score = scoreFor(`${name} ${friend.username || ""}`);
    if (score >= 0)
      results.push(
        commandItem(commandText("Amis", "Friends"), {
          type: "friend",
          friendId: friend.userId,
          title: name,
          subtitle: friend.commonSquad
            ? commandText("Ami · même squad", "Friend · same squad")
            : commandText("Ami", "Friend"),
          tag: commandText("Ami", "Friend"),
          image: friend.avatarUrl,
          icon: "☺",
          score
        })
      );
  });

  if (state.activeSquad) {
    const score = scoreFor(`${state.activeSquad} ${commandText("squad escouade", "squad")}`);
    if (score >= 0)
      results.push(
        commandItem("Squad", {
          type: "squad",
          title: `Squad ${state.activeSquad}`,
          subtitle: commandText("Ouvrir le tableau de l’escouade", "Open the squad board"),
          tag: "Squad",
          icon: "◈",
          score
        })
      );
  }
  (Array.isArray(state.squadMembers) ? state.squadMembers : []).forEach((member) => {
    const name = member.displayName || member.username || "";
    const score = scoreFor(`${name} ${member.username || ""}`);
    if (score >= 0)
      results.push(
        commandItem("Squad", {
          type: "squad",
          title: name,
          subtitle: commandText(
            `Membre de ${state.activeSquad || "ta squad"}`,
            `Member of ${state.activeSquad || "your squad"}`
          ),
          tag: commandText("Membre", "Member"),
          image: member.avatarUrl,
          icon: "◈",
          score
        })
      );
  });

  Object.values(EVENTS || {}).forEach((event) => {
    const name = event?.name || event?.id || "";
    const score = scoreFor(`${name} ${event?.id || ""} ${event?.source || ""}`);
    if (score >= 0)
      results.push(
        commandItem(commandText("Événements", "Events"), {
          type: "event",
          eventId: event.id,
          title: name,
          subtitle: event.endDate
            ? commandText(
                `Jusqu’au ${new Date(event.endDate).toLocaleDateString("fr-FR")}`,
                `Until ${new Date(event.endDate).toLocaleDateString("en-US")}`
              )
            : commandText("Voir les variantes liées", "View linked variants"),
          tag: commandText("Événement", "Event"),
          icon: "◷",
          score
        })
      );
  });

  Object.values(SEASONS || {}).forEach((season) => {
    const title =
      season?.name ||
      commandText(
        `Chapitre ${season?.chapter || ""} · Saison ${season?.season || season?.id || ""}`,
        `Chapter ${season?.chapter || ""} · Season ${season?.season || season?.id || ""}`
      ).trim();
    const score = scoreFor(`${title} ${season?.id || ""} ${commandText("chapitre saison", "chapter season")}`);
    if (score >= 0)
      results.push(
        commandItem(commandText("Saisons", "Seasons"), {
          type: "season",
          seasonId: season.id,
          title,
          subtitle: commandText("Afficher les variantes de cette saison", "Show this season's variants"),
          tag: commandText("Saison", "Season"),
          icon: "◫",
          score
        })
      );
  });

  getCommandBadges().forEach((badge) => {
    const label = badge.label || badge.badgeCode || "";
    const score = scoreFor(`${label} ${badge.badgeCode || ""} ${badge.description || ""}`);
    if (score >= 0)
      results.push(
        commandItem("Badges", {
          type: "badge",
          title: label,
          subtitle:
            badge.status === "locked"
              ? commandText("Badge à débloquer", "Badge to unlock")
              : commandText("Badge du passeport", "Passport badge"),
          tag: "Badge",
          image: badge.iconUrl,
          icon: "★",
          score
        })
      );
  });

  results.push(...commandCurrentCardActions(query));
  results.push(...commandDomActions(query));
  results.push(...commandContentItems(query));

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.title.localeCompare(b.title, typeof appLocale === "function" && appLocale() === "en" ? "en" : "fr")
    )
    .slice(0, 96);
}

function renderCommandPalette() {
  const input = document.getElementById("commandPaletteInput");
  const resultsEl = document.getElementById("commandPaletteResults");
  const hint = document.getElementById("commandPaletteHint");
  if (!input || !resultsEl) return;
  const query = commandNormalize(input.value);
  commandPaletteItems = getCommandPaletteItems(query);
  commandPaletteActiveIndex = -1;
  hint.textContent = query
    ? commandText(
        `${commandPaletteItems.length} résultat${commandPaletteItems.length > 1 ? "s" : ""} · Entrée pour ouvrir`,
        `${commandPaletteItems.length} result${commandPaletteItems.length === 1 ? "" : "s"} · Enter to open`
      )
    : commandText(
        "Accès rapide à ta collection, ton profil et ton plan de farm.",
        "Quick access to your collection, profile and farm plan."
      );
  if (!commandPaletteItems.length) {
    resultsEl.innerHTML = `<p class="command-palette__empty">${escapeHtml(commandText("Aucun résultat. Essaie le nom d’un Sprite, d’un ami ou d’un événement.", "No results. Try a Sprite, friend or event name."))}</p>`;
    return;
  }
  const groups = new Map();
  commandPaletteItems.forEach((item, index) => {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push({ item, index });
  });
  resultsEl.innerHTML = [...groups.entries()]
    .map(
      ([group, items]) => `
    <section class="command-palette__group" aria-label="${escapeHtml(group)}">
      <span class="command-palette__group-title">${escapeHtml(group)}</span>
      ${items
        .map(
          ({
            item,
            index
          }) => `<button class="command-palette__result" type="button" role="option" data-command-index="${index}" aria-selected="false">
        <span class="command-palette__result-icon">${commandIcon(item)}</span>
        <span class="command-palette__result-copy"><strong class="command-palette__result-title">${escapeHtml(item.title)}</strong><small class="command-palette__result-subtitle">${escapeHtml(item.subtitle || "")}</small></span>
        <span class="command-palette__result-tag">${escapeHtml(item.tag || "")}</span>
      </button>`
        )
        .join("")}
    </section>`
    )
    .join("");
}

function setCommandPaletteActive(index, { focus = false } = {}) {
  const buttons = [...document.querySelectorAll("[data-command-index]")];
  if (!buttons.length) return;
  commandPaletteActiveIndex = (index + buttons.length) % buttons.length;
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === commandPaletteActiveIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  const activeButton = buttons[commandPaletteActiveIndex];
  activeButton?.scrollIntoView({ block: "nearest" });
  if (focus) activeButton?.focus();
}

function markCommandItemStatus(itemId, status) {
  const item = getAllItems().find((candidate) => candidate.id === itemId);
  if (!item || !status) return;
  const previous = getEntry(itemId);
  if (previous.status === status) return;
  setEntry(
    itemId,
    { status, obtainedAt: status === "owned" ? previous.obtainedAt || new Date().toISOString() : previous.obtainedAt },
    { render: false }
  );
  markCollectionViewsDirty();
  state.homeViewDirty = true;
  const view = getActiveMainView();
  if (view === "checklist") refreshCollectionViewIfDirty("checklist");
  else if (view === "missing") refreshCollectionViewIfDirty("missing");
  else if (view === "stats") refreshCollectionViewIfDirty("stats");
  else if (view === "home") refreshHomeViewIfDirty("home");
  renderSummary();
  if (view === "swipe" && currentItem()?.id === itemId) renderCard();
  toast(
    `${item.spriteName} · ${item.variantName || item.variant} — ${status === "owned" ? t("status.owned") : statusLabel(status)}`
  );
}

function markCommandItemOwned(itemId) {
  markCommandItemStatus(itemId, "owned");
}

function runCommandDomAction(item) {
  const node = commandPaletteDomTargets.get(item.targetKey);
  if (!node || !document.contains(node)) return;
  const view = commandViewForNode(node);
  if (view) activateMainView(view);
  const socialTab = node.closest(".social-panel")?.id?.replace(/^social-panel-/, "");
  if (socialTab) setSocialTab(socialTab);
  const friendTab = node.closest(".friends-panel")?.id?.replace(/^friends-panel-/, "");
  if (friendTab && typeof setFriendsTab === "function") setFriendsTab(friendTab);
  const inAccount = node.closest("#accountPanel");
  if (inAccount) {
    if (document.getElementById("accountPanel")?.style.display === "none")
      document.getElementById("accountBtn")?.click();
    const accountSection = node.closest(".account-section, .collector-passport, .account-profile-dashboard")?.id;
    if (accountSection) document.querySelector(`[data-account-target="${CSS.escape(accountSection)}"]`)?.click();
  }
  requestAnimationFrame(() => {
    node.focus?.({ preventScroll: true });
    node.click?.();
  });
}

function runCommandContent(item) {
  const node = commandPaletteDomTargets.get(item.targetKey);
  if (!node || !document.contains(node)) return;
  const view = commandViewForNode(node);
  if (view) activateMainView(view);
  const socialTab = node.closest(".social-panel")?.id?.replace(/^social-panel-/, "");
  if (socialTab) setSocialTab(socialTab);
  const friendTab = node.closest(".friends-panel")?.id?.replace(/^friends-panel-/, "");
  if (friendTab && typeof setFriendsTab === "function") setFriendsTab(friendTab);
  if (node.closest("#accountPanel")) {
    if (document.getElementById("accountPanel")?.style.display === "none")
      document.getElementById("accountBtn")?.click();
    const accountSection = node.closest(".account-section, .collector-passport, .account-profile-dashboard")?.id;
    if (accountSection) document.querySelector(`[data-account-target="${CSS.escape(accountSection)}"]`)?.click();
  }
  requestAnimationFrame(() => {
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("is-command-focus");
    setTimeout(() => node.classList.remove("is-command-focus"), 1600);
  });
}

function closeCommandPalette({ returnFocus = true } = {}) {
  const dialog = document.getElementById("commandPalette");
  if (!dialog?.open) return;
  const opener = commandPaletteOpener;
  // Native <dialog> restores focus to its invoker after close. The desktop
  // invoker opens this palette on focus, so ignore that restoration once.
  const suppressDesktopReopen = opener?.id === "desktopSearch";
  if (suppressDesktopReopen) commandPaletteSuppressDesktopReopen = true;
  dialog.close();
  commandPaletteOpener = null;
  if (suppressDesktopReopen)
    setTimeout(() => {
      commandPaletteSuppressDesktopReopen = false;
    }, 0);
  if (!returnFocus || !opener?.isConnected) return;
  // Focusing the desktop trigger would reopen this dialog through its focus listener.
  if (opener.id === "desktopSearch") document.getElementById("appShell")?.focus?.({ preventScroll: true });
  else opener.focus?.({ preventScroll: true });
}

function runCommandPaletteItem(item) {
  if (!item) return;
  closeCommandPalette({ returnFocus: false });
  if (item.type === "owned") return markCommandItemOwned(item.itemId);
  if (item.type === "status") return markCommandItemStatus(item.itemId, item.status);
  if (item.type === "variant") return openDetail(item.itemId);
  if (item.type === "friend") {
    activateMainView("social");
    setSocialTab("friends");
    friendsState.listSearch = item.title;
    const search = document.getElementById("friendSearch");
    if (search) search.value = item.title;
    renderFriends();
    return;
  }
  if (item.type === "social") {
    activateMainView("social");
    setSocialTab(item.target || "friends");
    return;
  }
  if (item.type === "account") return document.getElementById("accountBtn")?.click();
  if (item.type === "notification") return document.getElementById("notifBell")?.click();
  if (item.type === "squad") {
    activateMainView("social");
    setSocialTab("squad");
    return;
  }
  if (item.type === "event") {
    state.missingEventFilter = { eventId: item.eventId };
    state.missingFilter = "all";
    state.missingSearch = "";
    activateMainView("missing");
    renderMissing();
    return;
  }
  if (item.type === "season") {
    state.checklistSearch = "";
    state.checklistFilter = "all";
    state.commandSeasonId = item.seasonId;
    activateMainView("checklist");
    const search = document.getElementById("searchInput");
    if (search) search.value = "";
    renderChecklist();
    return;
  }
  if (item.type === "badge" || item.type === "passport")
    return document.querySelector('[data-account-overview-action="passport"], #accountBtn')?.click();
  if (item.type === "dom") return runCommandDomAction(item);
  if (item.type === "content") return runCommandContent(item);
  if (item.type === "navigate") activateMainView(item.target);
}

function openCommandPalette(initialValue = "", opener = document.activeElement) {
  const dialog = document.getElementById("commandPalette");
  const input = document.getElementById("commandPaletteInput");
  if (!dialog || !input) return;
  if (!dialog.open) {
    commandPaletteOpener = opener;
    dialog.showModal();
  }
  input.value = initialValue;
  renderCommandPalette();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function setupCommandPalette() {
  const dialog = document.getElementById("commandPalette");
  const input = document.getElementById("commandPaletteInput");
  const desktopSearch = document.getElementById("desktopSearch");
  const mobileTrigger = document.getElementById("commandPaletteOpen");
  if (!dialog || !input) return;

  const shortcutLabel = document.getElementById("desktopSearchShortcut");
  const platform = String(navigator.userAgentData?.platform || navigator.platform || "");
  if (shortcutLabel) shortcutLabel.textContent = /mac|iphone|ipad|ipod/i.test(platform) ? "⌘ K" : "Ctrl K";
  mobileTrigger?.addEventListener("click", () => openCommandPalette());
  desktopSearch?.addEventListener("focus", () => {
    if (commandPaletteSuppressDesktopReopen) return;
    openCommandPalette(desktopSearch.value);
  });
  desktopSearch?.addEventListener("click", () => {
    if (!dialog.open) openCommandPalette(desktopSearch.value);
  });
  desktopSearch?.addEventListener("input", () => {
    openCommandPalette(desktopSearch.value);
    desktopSearch.value = "";
  });
  input.addEventListener("input", renderCommandPalette);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommandPalette();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCommandPaletteActive(commandPaletteActiveIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setCommandPaletteActive(commandPaletteActiveIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const item = commandPaletteItems[commandPaletteActiveIndex >= 0 ? commandPaletteActiveIndex : 0];
      runCommandPaletteItem(item);
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeCommandPalette();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCommandPalette();
  });
  dialog.querySelector("[data-command-palette-close]")?.addEventListener("click", () => closeCommandPalette());
  document.getElementById("commandPaletteResults")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-command-index]");
    if (button) runCommandPaletteItem(commandPaletteItems[Number(button.dataset.commandIndex)]);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      event.stopPropagation();
      closeCommandPalette();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommandPalette();
    }
  });
}
