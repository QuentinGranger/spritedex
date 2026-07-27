/* ── Application language ────────────────────────────────────────────────
   Sprite Index is French by default for a French device or a Francophone
   region. Every other locale receives English. The decision is made locally
   (no account data or location is collected) and is sent with API requests
   through Accept-Language so server errors use the same language. */
(function setupApplicationLanguage() {
  const FRANCOPHONE_REGIONS = new Set([
    "BE", "BF", "BI", "BJ", "CA", "CD", "CF", "CG", "CH", "CI", "CM", "DJ", "FR",
    "GA", "GF", "GN", "GP", "GQ", "HT", "KM", "LU", "MA", "MC", "MF", "MG", "ML",
    "MQ", "NC", "NE", "PF", "PM", "RE", "RW", "SC", "SN", "TD", "TG", "VU", "WF", "YT"
  ]);

  function deviceLanguage() {
    const forced = new URLSearchParams(window.location.search).get("lang");
    if (forced === "fr" || forced === "en") return forced;
    const locales = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || "en"];
    for (const value of locales) {
      const raw = String(value || "").replace(/_/g, "-");
      const [language, region] = raw.split("-");
      if (String(language).toLowerCase() === "fr") return "fr";
      if (FRANCOPHONE_REGIONS.has(String(region || "").toUpperCase())) return "fr";
    }
    return "en";
  }

  const locale = deviceLanguage();
  window.SPRITE_INDEX_LOCALE = locale;
  window.appLocale = () => locale;

  // The French source text remains the canonical content in HTML. This shared
  // memory also translates text injected later by JavaScript (toasts, empty
  // states, dashboards and dialogs) via the observer below.
  const EN = Object.freeze({
    "Accueil": "Home", "Navigation": "Navigation", "Swipe": "Swipe", "Checklist": "Checklist",
    "Manquants": "Missing", "Stats": "Stats", "Statistiques": "Statistics", "Historique": "History",
    "Social": "Social", "Amis": "Friends", "Escouade": "Squad", "Escouades": "Squads",
    "Comparer": "Compare", "Comparer un joueur": "Compare a player", "Comparaison avec un ami": "Compare with a friend",
    "Compare ta collection avec un ami pour voir ce que vous pouvez vous échanger.": "Compare your collection with a friend to see how you can help each other.",
    "Collectionner · Comparer · Progresser en squad": "Collect · Compare · Progress as a squad",
    "Votre collection": "Your collection", "variantes obtenues": "variants collected", "Progression collection": "Collection progress",
    "Déjà en votre possession": "Already in your collection", "à découvrir !": "left to discover!",
    "Rechercher": "Search", "Rechercher un sprite…": "Search for a sprite…", "Rechercher un ami…": "Search for a friend…",
    "Rechercher un sprite ou une variante…": "Search for a sprite or variant…", "Tous": "All", "Tout": "All", "Toutes": "All",
    "Trier :": "Sort:", "Tri :": "Sort:", "Alphabétique": "Alphabetical", "Par rareté": "By rarity",
    "Par variante": "By variant", "Par priorité": "By priority", "Par nouveauté": "By newest", "Plus complété": "Most complete",
    "Moins complété": "Least complete", "Plus rare d'abord": "Rarest first", "Plus commun d'abord": "Most common first",
    "Incomplets": "Incomplete", "Possédés": "Owned", "Possédé": "Owned", "Manquant": "Missing",
    "Prioritaires": "Priority", "Priorité": "Priority", "Prioritaire": "Priority", "À vérifier": "To check", "Rare vu": "Spotted",
    "Rare trouvé": "Spotted", "Rares vus": "Spotted", "Indispo": "Unavailable", "Indispos": "Unavailable", "Non disponible": "Unavailable", "Inconnu": "Unknown", "Non classé": "Unclassified", "Non classés": "Unclassified",
    "Réinitialiser": "Reset", "Reset": "Reset", "Importer": "Import", "Exporter": "Export", "Annuler": "Cancel",
    "Enregistrer": "Save", "Supprimer": "Delete", "SUPPRIMER": "DELETE", "Retour": "Back", "Quitter": "Leave",
    "Créer": "Create", "Ajouter": "Add", "Rejoindre": "Join", "Partager": "Share", "Copier le lien": "Copy link",
    "Copier la liste visible": "Copy visible list", "Mélanger": "Shuffle", "Pas encore": "Not yet",
    "Je l’ai": "I have it", "Je ne l’ai pas": "I don't have it", "Je dois vérifier": "I need to check",
    "À obtenir en priorité": "Get as a priority", "Déjà en ma possession": "Already in my collection",
    "Progression :": "Progress:", "Maîtrise": "Mastery", "Niveau 1": "Level 1", "Niveau Master": "Master level",
    "Rare": "Rare", "Épique": "Epic", "Légendaire": "Legendary", "Mythique": "Mythic", "Base": "Base",
    "Galaxy": "Galaxy", "Gold": "Gold", "Gummy": "Gummy", "Holofoil": "Holofoil", "Rift": "Rift",
    "Connecte-toi pour sauvegarder ta collection et rejoindre une squad.": "Sign in to save your collection and join a squad.",
    "Connexion": "Sign in", "Se connecter": "Sign in", "Créer un compte": "Create an account", "Créer mon compte": "Create my account",
    "Continuer avec Google": "Continue with Google", "Continuer avec Discord": "Continue with Discord", "Continuer avec Email": "Continue with email",
    "Continuer sans compte": "Continue without an account", "Déjà un compte ?": "Already have an account?",
    "Pas encore de compte ?": "Don't have an account yet?", "Mot de passe oublié ?": "Forgot password?",
    "Bienvenue dans SPRITE-INDEX": "Welcome to SPRITE-INDEX", "Choisis ton pseudo :": "Choose your username:",
    "Personnalise ton profil": "Personalize your profile", "Commencer": "Get started", "Sauvegarder ma collection": "Save my collection",
    "Tu as déjà une collection locale.": "You already have a local collection.", "Veux-tu la sauvegarder sur ton compte ?": "Would you like to save it to your account?",
    "Chargement…": "Loading…", "Chargement...": "Loading...", "Chargement de votre progression…": "Loading your progress…",
    "Aucune notification.": "No notifications.", "Aucune suggestion": "No suggestions", "Aucun historique. Commence à classer tes sprites !": "No history yet. Start sorting your sprites!",
    "Activité récente": "Recent activity", "Acquisitions": "Acquisitions", "Changements": "Changes", "Série actuelle": "Current streak",
    "Dernière mise à jour": "Last updated", "Résumé des actions": "Action summary", "Collections les plus actives": "Most active collections",
    "Journal de collection": "Collection log", "Journal personnel": "Personal log", "Sur 12 semaines": "Over 12 weeks",
    "Variantes récemment obtenues": "Recently collected variants", "Évolution de votre collection": "Your collection over time",
    "Progression de la collection": "Collection progress", "Progression totale": "Overall progress", "Progression du catalogue": "Catalogue progress",
    "Par rareté": "By rarity", "Par variante": "By variant", "Votre progression dans chaque niveau de rareté.": "Your progress in each rarity tier.",
    "Les styles de Sprite les plus proches de votre objectif.": "The Sprite styles closest to your goal.",
    "Familles découvertes": "Families discovered", "Sprites possédés": "Sprites owned", "Variantes possédées": "Variants owned",
    "Priorités restantes": "Remaining priorities", "Sprites complétés": "Completed sprites", "Vue d'ensemble": "Overview",
    "Mes amis": "My friends", "Demandes reçues": "Received requests", "Demandes envoyées": "Sent requests",
    "Ajouter": "Add", "Mon QR code": "My QR code", "Bloqués": "Blocked", "Ajouter un ami": "Add a friend",
    "Pseudo (min. 3 caractères)": "Username (min. 3 characters)", "Rechercher": "Search", "Résultats": "Results",
    "Suggestions d'escouade": "Squad suggestions", "Copier mon lien d'ami": "Copy my friend link", "Afficher mon QR code": "Show my QR code",
    "Générer mon QR code": "Generate my QR code", "Génère un lien et un QR code à envoyer à tes amis.": "Generate a link and QR code to send to your friends.",
    "Génère un lien permanent pour afficher ton QR code.": "Generate a permanent link to display your QR code.",
    "Créer une escouade": "Create a squad", "Rejoindre avec un code": "Join with a code", "Nom de l'escouade (optionnel)": "Squad name (optional)",
    "Mon escouade": "My squad", "Moteur": "Engine", "Moteur de complétion": "Completion engine", "Optimisation": "Optimization",
    "Recommandations": "Recommendations", "Manque à quelqu'un": "Missing for someone", "Personne ne l'a": "Nobody owns it",
    "Ce qu'il me manque": "What I'm missing", "Ce qu’il te manque": "What you're missing", "Mes exclusivités": "My exclusives",
    "Tout le monde l'a": "Everyone owns it", "Tout afficher": "Show all", "Duo — échange possible": "Duo — exchange possible",
    "Priorités de l'équipe": "Team priorities", "Ce qu’il te manque": "What you're missing", "Farm list": "Farm list",
    "Prépare ta prochaine session : priorise, retrouve une variante et marque-la dès qu’elle est obtenue.": "Prepare your next session: set priorities, find a variant and mark it when collected.",
    "Copier mon lien d'ami": "Copy my friend link", "Créer": "Create", "Rejoindre": "Join", "Partager ma collection": "Share my collection",
    "Lien ou token de partage de ton ami": "Your friend's sharing link or token", "Synchroniser maintenant": "Sync now",
    "Mon compte": "My account", "Espace collectionneur": "Collector space", "Gérez votre profil, vos préférences et votre expérience de collection.": "Manage your profile, preferences and collecting experience.",
    "Votre passeport, vos variantes et vos squads en un seul endroit.": "Your passport, variants and squads in one place.",
    "Badges obtenus": "Badges earned", "Squad principale": "Primary squad", "Fiabilité": "Reliability", "variantes possédées": "variants owned",
    "Ma collection": "My collection", "Aucune donnée de collection": "No collection data", "Sprites complétés": "Completed sprites", "Voir ma collection complète": "View my complete collection",
    "Activité": "Activity", "Récent": "Recent", "Événements terminés": "Completed events", "En cours": "In progress", "Nouveaux badges": "New badges", "Variantes ajoutées": "Variants added",
    "Aucun événement récent.": "No recent activity.", "Voir mon historique": "View my history", "Aperçu des badges": "Badge preview", "Voir tout": "View all",
    "Préférences rapides": "Quick preferences", "E-mails": "Emails", "Invitations d’amis": "Friend invitations", "Configurer les notifications": "Configure notifications",
    "Activé": "Enabled", "Désactivé": "Disabled", "Catalogue indisponible": "Catalog unavailable", "Aucun badge débloqué.": "No badges unlocked.",
    "Aucune squad principale": "No primary squad", "Aucune squad": "No squad", "Aucun": "None", "Aucune": "None",
    "Aperçu": "Overview", "Passeport": "Passport", "Badges": "Badges", "Modifier mon profil": "Edit my profile", "Fermer mon compte": "Close my account",
    "Actualités": "News", "Lire l’actualité": "Read the news", "Actualité indisponible.": "News item unavailable.",
    "Modifier le pseudo": "Edit username", "Changer d'avatar": "Change avatar", "Modifier avatar": "Edit avatar",
    "Déconnexion": "Sign out", "Confidentialité": "Privacy", "Sécurité": "Security", "Notifications": "Notifications",
    "Notifications push": "Push notifications", "Sauvegarde cloud": "Cloud backup", "Gérer mes données": "Manage my data",
    "Supprimer mon compte": "Delete my account", "Supprimer définitivement": "Delete permanently", "Exporter mes données avant suppression": "Export my data before deletion",
    "Politique de confidentialité": "Privacy policy", "Mentions légales": "Legal notice", "Conditions générales d'utilisation": "Terms of service",
    "Règles communautaires": "Community rules", "Licences et crédits": "Licenses and credits", "Contacter le support": "Contact support",
    "Visibilité": "Visibility", "Profil privé": "Private profile", "Profil public": "Public profile", "Profil public via lien": "Public profile via link",
    "Visible par mes squads": "Visible to my squads", "Partager mon profil": "Share my profile", "Passeport": "Passport",
    "Passeport du collectionneur": "Collector passport", "Partager mon passeport": "Share my passport", "Afficher la squad": "Show squad",
    "Afficher les badges": "Show badges", "Afficher les notes": "Show notes", "Afficher les priorités": "Show priorities",
    "Afficher la date d’inscription": "Show join date", "Afficher le taux de complétion": "Show completion rate",
    "Afficher les événements complétés": "Show completed events", "Format": "Format", "Générer la carte": "Generate card",
    "Information officielle": "Official information", "Observation directe": "Direct observation", "Information communautaire": "Community information", "Estimation": "Estimate", "À confirmer": "To confirm",
    "Fin estimée, non confirmée par Epic Games.": "Estimated end date, not confirmed by Epic Games.",
    "1 heure": "1 hour", "24 heures": "24 hours", "7 jours": "7 days", "30 jours": "30 days", "8 (recommandé)": "8 (recommended)",
    "Actions": "Actions", "Activé": "Enabled", "Désactivé": "Disabled", "Activé seulement pour les priorités": "Enabled for priorities only",
    "Administrateurs": "Administrators", "Alertes": "Alerts", "Aperçu exact des informations visibles sur la carte :": "Exact preview of the information visible on the card:",
    "Aucune recherche prioritaire": "No priority searches", "Avatar :": "Avatar:", "Calcul du passeport…": "Calculating passport…",
    "Canaux": "Channels", "Cette action désactive immédiatement ton compte : profil, collection cloud, escouades et préférences ne seront plus accessibles.": "This action immediately disables your account: profile, cloud collection, squads and preferences will no longer be available.",
    "Collection détectée": "Collection detected", "Collection mise à jour récemment": "Collection updated recently", "Collection visible": "Visible collection",
    "Collections": "Collections", "Collections et squads": "Collections and squads", "Complémentarité": "Complementarity",
    "Confidentialité :": "Privacy:", "Confidentialité et traceurs": "Privacy and tracking", "Confort": "Comfort", "Dans l'application": "In the app",
    "Date d'ajout": "Date added", "De": "From", "Demandes en attente": "Pending requests", "Dernière activité": "Last activity", "Dernière sync": "Last sync",
    "Discord": "Discord", "Durée": "Duration", "Désactiver le lien de partage": "Disable share link", "E-mails": "Emails",
    "Effet": "Effect", "Effet du sprite": "Sprite effect", "Email non vérifié — vérifie ta boîte mail": "Email not verified — check your inbox", "En ligne": "Online",
    "et la": "and", "Explorez, classez et complétez votre collection de sprites.": "Explore, sort and complete your sprite collection.",
    "Faible": "Low", "Moyen": "Medium", "Important": "Important", "Urgent": "Urgent", "Fréquence": "Frequency", "Fuseau horaire": "Time zone",
    "Générer le lien": "Generate link", "Heures silencieuses": "Quiet hours", "Ignoré": "Ignored", "Illimité": "Unlimited", "Immédiatement": "Immediately",
    "Informations et confidentialité": "Information and privacy", "Invitations d'amis acceptées": "Accepted friend invitations", "Inviter": "Invite", "Inviter dans une escouade": "Invite to a squad",
    "J'accepte les": "I accept the", "J'ai au moins 15 ans.": "I am at least 15 years old.",
    "Les acquisitions multiples peuvent être regroupées dans un résumé quotidien.": "Multiple acquisitions can be grouped in a daily summary.",
    "Les données sont ensuite effacées définitivement dans un délai de": "The data is then permanently deleted within", "Les fonctions essentielles restent disponibles sans ce consentement.": "Essential features remain available without this consent.",
    "Les push non urgents sont reportés pendant cette plage (fuseau local).": "Non-urgent pushes are postponed during this period (local time zone).",
    "Limite de sécurité pour les notifications sprite-index ordinaires. Les alertes critiques (sécurité, juridique, service) ne sont pas plafonnées.": "Safety limit for regular sprite-index notifications. Critical alerts (security, legal, service) are not capped.",
    "Maximum de push par jour": "Maximum pushes per day", "Membre depuis —": "Member since —", "Modifier pseudo": "Edit username",
    "Même squad": "Same squad", "Nom": "Name", "Non lues": "Unread", "Non-amis": "Non-friends", "Note perso": "Personal note", "OK": "OK", "Options": "Options", "ou": "or",
    "Paliers importants uniquement": "Important milestones only", "Partager ma comparaison": "Share my comparison", "Participer aux statistiques communautaires anonymisées": "Contribute to anonymous community statistics",
    "Permettre la comparaison avec le visiteur": "Allow comparison with the visitor", "Plus tard": "Later", "pour confirmer :": "to confirm:",
    "Priorité de farm :": "Farm priority:", "Priorités": "Priorities", "Priorités et événements": "Priorities and events", "Progression": "Progress", "Progression de mes squads": "My squads' progress",
    "Push": "Push", "Quelques infos et c'est parti": "A few details and you're ready to go", "Renvoyer": "Resend", "Repartir de zéro": "Start over", "Retrouvez les évolutions de votre collection.": "See how your collection has evolved.",
    "Résumé quotidien": "Daily summary", "Sans expiration": "No expiration", "Sauvegarde ta collection et rejoins une escouade": "Save your collection and join a squad", "Signaler un contenu": "Report content",
    "Sprite": "Sprite", "sprites enregistrés": "sprites recorded", "Squads": "Squads", "Statut : Non classé": "Status: Unclassified", "Tout lu": "Mark all as read",
    "Authentification requise": "Authentication required", "Accès refusé": "Access denied", "Accès interdit": "Access forbidden", "Compte suspendu": "Account suspended",
    "Utilisateur non trouvé": "User not found", "Session expirée": "Session expired", "Token invalide": "Invalid token", "Email ou mot de passe incorrect": "Incorrect email or password",
    "Erreur serveur": "Server error", "Erreur réseau.": "Network error.", "Impossible de charger l'historique.": "Unable to load history.", "Impossible de charger les données.": "Unable to load data.",
    "Provider google non configuré": "Google provider is not configured", "Provider discord non configuré": "Discord provider is not configured", "Provider email non configuré": "Email provider is not configured",
    "Un ami possède une variante qui me manque": "A friend owns a variant I'm missing", "Un événement recherché se termine bientôt": "A tracked event ends soon", "Une variante prioritaire devient disponible": "A priority variant becomes available",
    "Variante": "Variant", "variantes": "variants", "Variantes complémentaires": "Complementary variants", "Voir ma collection": "View my collection", "à": "to", "À planifier": "To plan", "Écris": "Write", "⌘ K": "Ctrl K",
    "Appuyez sur Échap pour effacer la recherche.": "Press Escape to clear the search.",
    "Carte : → possédé · ← manquant · ↑ priorité · ↓ à vérifier · Tap = détails · Long press = note": "Card: → owned · ← missing · ↑ priority · ↓ check · Tap = details · Long press = note",
    "Écran : glisse depuis le bord pour changer d’onglet": "Screen: swipe from an edge to change tabs",
    "SPRITE-INDEX est une application non officielle de suivi de collection. Cette application n'est pas affiliée, sponsorisée ou approuvée par Epic Games. Fortnite est une marque appartenant à Epic Games.": "SPRITE-INDEX is an unofficial collection-tracking app. It is not affiliated with, sponsored by or endorsed by Epic Games. Fortnite is a trademark of Epic Games."
  });

  const PATTERNS = [
    [/^Niveau (\d+)$/, "Level $1"],
    [/^(\d+) variantes? obtenues$/, "$1 variants collected"],
    [/^(\d+) variantes? possédées$/, "$1 variants owned"],
    [/^(\d+) variantes? à découvrir$/, "$1 variants left to discover"],
    [/^(\d+) actions$/, "$1 actions"],
    [/^(\d+) semaines? actives$/, "$1 active weeks"],
    [/^Il y a (\d+) (minute|heure|jour|semaine|mois)s?$/, "$1 $2 ago"],
    [/^Aujourd’hui · (.+)$/, "Today · $1"],
    [/^Hier · (.+)$/, "Yesterday · $1"],
    [/^Aucune activité ne correspond à ce filtre\.$/, "No activity matches this filter."],
    [/^Impossible de charger (.+)\.$/, "Unable to load $1."],
    [/^Erreur réseau\.$/, "Network error."],
    [/^Statut : (.+)$/, "Status: $1"]
  ];

  function translate(value) {
    const source = String(value == null ? "" : value);
    if (locale === "fr" || !source) return source;
    const trimmed = source.trim();
    const direct = EN[trimmed];
    if (direct) return source.replace(trimmed, direct);
    for (const [pattern, replacement] of PATTERNS) {
      if (pattern.test(trimmed)) return source.replace(trimmed, trimmed.replace(pattern, replacement));
    }
    return source;
  }

  window.t = translate;

  function translateTextNode(node) {
    if (!node || !node.nodeValue || !node.nodeValue.trim()) return;
    const parent = node.parentElement;
    if (!parent || parent.closest("script, style, code, pre, textarea")) return;
    const translated = translate(node.nodeValue);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }

  const ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description", "alt", "value"];
  function translateElement(element) {
    if (!(element instanceof Element) || element.closest("script, style, code, pre")) return;
    for (const name of ATTRIBUTES) {
      if (!element.hasAttribute(name)) continue;
      const raw = element.getAttribute(name);
      const translated = translate(raw);
      if (translated !== raw) element.setAttribute(name, translated);
    }
    for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) translateTextNode(child);
  }

  function translateDocument(root = document.body) {
    if (locale === "fr" || !root) return;
    document.documentElement.lang = "en";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(translateTextNode);
    translateElement(root);
    if (root.querySelectorAll) root.querySelectorAll("*").forEach(translateElement);
  }

  window.translateDocument = translateDocument;
  if (locale === "en") {
    translateDocument();
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") translateTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
          else if (node.nodeType === Node.ELEMENT_NODE) translateDocument(node);
        });
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    document.documentElement.lang = "fr";
  }

  // One header covers every existing fetch call without having to duplicate
  // language plumbing in each feature module.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Accept-Language")) headers.set("Accept-Language", locale);
    return nativeFetch(input, { ...init, headers });
  };
})();
