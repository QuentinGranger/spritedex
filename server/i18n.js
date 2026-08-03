"use strict";

// API localisation is intentionally independent from account data: the client
// sends Accept-Language for every call, and API errors follow that language.
// This keeps unauthenticated flows (login, registration and OAuth) localized.
//
// French when Accept-Language is `fr*`, or the region is one of:
// Afrique: BJ BI CM KM CI DJ GA GN GQ MG CF CD CG RW SN SC TD TG
//          DZ BF ML MA MU MR NE TN
// Europe: BE FR LU MC CH AD · Amérique: CA HT · Moyen-Orient: LB · Océanie: VU
// DROM: GP MQ GF RE YT · COM: PF BL MF PM WF · Particulier: NC TF CP
//
// Dutch when Accept-Language is `nl*`, or the region is one of:
// NL (Netherlands) · SR (Suriname) · AW (Aruba) · CW (Curaçao)
// SX (Sint Maarten) · BQ (Bonaire, Sint Eustatius, Saba)
// Flanders / Dutch-speaking Brussels resolve via `nl` / `nl-BE` language tags.
const FRANCOPHONE_REGIONS = new Set([
  "BJ",
  "BI",
  "CM",
  "KM",
  "CI",
  "DJ",
  "GA",
  "GN",
  "GQ",
  "MG",
  "CF",
  "CD",
  "CG",
  "RW",
  "SN",
  "SC",
  "TD",
  "TG",
  "DZ",
  "BF",
  "ML",
  "MA",
  "MU",
  "MR",
  "NE",
  "TN",
  "BE",
  "FR",
  "LU",
  "MC",
  "CH",
  "AD",
  "CA",
  "HT",
  "LB",
  "VU",
  "GP",
  "MQ",
  "GF",
  "RE",
  "YT",
  "PF",
  "BL",
  "MF",
  "PM",
  "WF",
  "NC",
  "TF",
  "CP"
]);

const DUTCH_REGIONS = new Set(["NL", "SR", "AW", "CW", "SX", "BQ"]);

function resolveLocale(acceptLanguage) {
  const candidates = String(acceptLanguage || "")
    .split(",")
    .map((value) => value.trim().split(";")[0]);
  for (const candidate of candidates) {
    const [language, region] = candidate.replace(/_/g, "-").split("-");
    const lang = String(language || "").toLowerCase();
    const regionCode = String(region || "").toUpperCase();
    if (lang === "nl") return "nl";
    if (lang === "fr") return "fr";
    if (DUTCH_REGIONS.has(regionCode)) return "nl";
    if (FRANCOPHONE_REGIONS.has(regionCode)) return "fr";
  }
  return "en";
}

const ERROR_EN = Object.freeze({
  "Abonnement push invalide": "Invalid push subscription",
  "Accès interdit : vous ne pouvez modifier que votre propre collection":
    "Forbidden: you can only modify your own collection",
  "Accès refusé": "Access denied",
  "Accès réservé": "Access restricted",
  "Activité non accessible": "Activity not accessible",
  "Alerte forte : variante prioritaire, peu possédée, événement bientôt terminé.":
    "Strong alert: priority variant, rarely owned, event ending soon.",
  "Appareil introuvable": "Device not found",
  "Aucun membre dans le périmètre de l'objectif": "No members in the goal scope",
  "Aucune équipe ne peut couvrir l'objectif": "No team can cover the goal",
  "Aucune invitation à annuler": "No invitation to cancel",
  "Aucune invitation en attente": "No pending invitation",
  "Aucune invitation en attente pour cette escouade": "No pending invitation for this squad",
  "Aucune préférence à mettre à jour": "No preferences to update",
  "Authentification requise": "Authentication required",
  "Badge épinglé invalide": "Invalid pinned badge",
  "Badges non accessibles": "Badges not accessible",
  "Carte non disponible": "Card unavailable",
  "Ce compte est suspendu": "This account is suspended",
  "Ce pseudo est déjà pris": "This username is already taken",
  "Ce pseudo est déjà pris ou temporairement réservé": "This username is already taken or temporarily reserved",
  "Cet objectif n'est pas lié à une variante": "This goal is not linked to a variant",
  "Cet utilisateur est déjà membre de l'escouade": "This user is already a squad member",
  "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune":
    "This user only accepts invitations from members of a shared squad",
  "Cet utilisateur n'accepte pas les invitations": "This user does not accept invitations",
  "Cet utilisateur n'accepte pas les invitations d'escouade": "This user does not accept squad invitations",
  "Cet utilisateur n'est pas bloqué": "This user is not blocked",
  "Cet utilisateur ne peut pas être invité": "This user cannot be invited",
  "Cette escouade n'accepte plus de nouveaux membres": "This squad is no longer accepting new members",
  "Champ de préférence invalide": "Invalid preference field",
  "Changement de simulation invalide": "Invalid simulation change",
  "changes doit être un tableau": "changes must be an array",
  "Cible de recommendation invalide": "Invalid recommendation target",
  "Clé d'objet invalide": "Invalid object key",
  "Client OAuth obsolète : recharge l'application avant de réessayer.":
    "Outdated OAuth client: reload the application and try again.",
  "Code d'escouade introuvable": "Squad code not found",
  "Code déjà pris, réessayez": "Code already taken, try again",
  "Collection non accessible": "Collection not accessible",
  "Collection trop volumineuse": "Collection too large",
  "Collision de code, réessayez": "Code collision, try again",
  "Collision de token, réessayez": "Token collision, try again",
  "Comparaison impossible": "Comparison not possible",
  "Compte invalide": "Invalid account",
  "Compte suspendu": "Account suspended",
  "Confirmation invalide": "Invalid confirmation",
  "Consentement invalide": "Invalid consent",
  "cursor invalide": "Invalid cursor",
  "Date limite invalide": "Invalid deadline",
  "Demande introuvable": "Request not found",
  "Destinataire requis": "Recipient required",
  "Données communautaires insuffisantes": "Insufficient community data",
  "Durée de partage invalide": "Invalid share duration",
  "Email de vérification renvoyé": "Verification email resent",
  "Email déjà vérifié": "Email already verified",
  "Email non vérifié": "Email not verified",
  "Email ou mot de passe incorrect": "Incorrect email or password",
  "Erreur import": "Import error",
  "Erreur serveur": "Server error",
  "Erreur serveur OAuth": "OAuth server error",
  "Erreur sync": "Sync error",
  "Escouade introuvable": "Squad not found",
  "Escouade pleine (max 10)": "Squad is full (max 10)",
  "Événement inconnu": "Unknown event",
  "eventId requis pour le mode event": "eventId required for event mode",
  "Filtre invalide": "Invalid filter",
  "Fréquence invalide": "Invalid frequency",
  "Fréquences invalides": "Invalid frequencies",
  "friendId invalide": "Invalid friendId",
  "Fuseau horaire invalide": "Invalid time zone",
  "Heures silencieuses invalides": "Invalid quiet hours",
  "Identifiant de membre invalide": "Invalid member id",
  "Identifiant de variante invalide": "Invalid variant identifier",
  "Identifiant invalide": "Invalid identifier",
  "Impossible d'enregistrer les réglages du passeport": "Unable to save passport settings",
  "Impossible d'épingler le badge": "Unable to pin badge",
  "Impossible de calculer le passeport": "Unable to calculate passport",
  "Impossible de charger l'activité": "Unable to load activity",
  "Impossible de charger le passeport": "Unable to load passport",
  "Impossible de charger les badges": "Unable to load badges",
  "Impossible de charger les réglages du passeport": "Unable to load passport settings",
  "Impossible de choisir la squad principale": "Unable to set primary squad",
  "Impossible de créer le compte": "Unable to create account",
  "Impossible de créer un objectif entre des membres bloqués": "Unable to create a goal between blocked members",
  "Impossible de générer la carte": "Unable to generate card",
  "Impossible de partager une collection privée": "Unable to share a private collection",
  "Impossible de préparer la carte": "Unable to prepare card",
  "JSON invalide": "Invalid JSON",
  "La squad principale doit être une squad active de l'utilisateur":
    "Primary squad must be one of the user's active squads",
  "La taille d'équipe doit être entre 2 et 4": "Team size must be between 2 and 4",
  "Le badge épinglé doit être débloqué et visible": "Pinned badge must be unlocked and visible",
  "Le créateur ne peut pas être retiré": "The creator cannot be removed",
  "Le niveau de maîtrise nécessite une variante possédée.": "Mastery level requires an owned variant.",
  "Les membres assignés doivent être des membres actifs de l'escouade": "Assigned members must be active squad members",
  "Lien de partage invalide": "Invalid share link",
  "Lien de partage invalide ou révoqué": "Invalid or revoked share link",
  "Lien expiré ou révoqué": "Link expired or revoked",
  "Lien introuvable": "Link not found",
  "Lien invalide, expiré ou révoqué": "Invalid, expired or revoked link",
  "Lien non trouvé": "Link not found",
  "Limite de notifications invalide": "Invalid notification limit",
  "Liste de membres assignés invalide": "Invalid assignee list",
  "Liste de participants invalide": "Invalid participant list",
  "Liste de variantes invalide": "Invalid variant list",
  "maxActiveGoalsPerMember doit être entre 1 et 20": "maxActiveGoalsPerMember must be between 1 and 20",
  "maxActiveGoalsPerMember requis": "maxActiveGoalsPerMember is required",
  "memberId invalide": "Invalid memberId",
  "Membre introuvable dans l'escouade": "Member not found in squad",
  "method invalide (auto, greedy, exhaustive)": "Invalid method (auto, greedy, exhaustive)",
  "metricKey requis": "metricKey required",
  "Métrique introuvable": "Metric not found",
  "Mot de passe réinitialisé": "Password reset",
  "Motif invalide (1-500 caractères)": "Invalid reason (1-500 characters)",
  "Notification introuvable": "Notification not found",
  "notificationId requis": "notificationId required",
  "Objectif introuvable ou terminé": "Goal not found or completed",
  "Option de livraison invalide": "Invalid delivery option",
  "Option de partage invalide": "Invalid share option",
  "Option invalide": "Invalid option",
  "Options de livraison invalides": "Invalid delivery options",
  "Options de partage invalides": "Invalid share options",
  "Overrides invalides": "Invalid overrides",
  "Paramètre manquant pour ce targetType": "Missing parameter for this targetType",
  "Participant invalide": "Invalid participant",
  "Pas assez de membres visibles pour former une paire": "Not enough visible members to form a pair",
  "Passeport non accessible": "Passport is not accessible",
  "Passeport non trouvé": "Passport not found",
  "Préférences invalides": "Invalid preferences",
  "Pseudo réservé ou interdit": "Username reserved or forbidden",
  "pushEnabled invalide": "Invalid pushEnabled",
  "Recherche invalide": "Invalid search",
  "Recommendation requise": "Recommendation required",
  "recommendationKey requis": "recommendationKey required",
  "Réglages invalides": "Invalid settings",
  "Réponse OAuth expirée ou déjà utilisée": "Expired or already used OAuth response",
  "Réponse OAuth invalide": "Invalid OAuth response",
  "Requête invalide": "Invalid request",
  "Requête trop volumineuse": "Request body is too large",
  "Ressource introuvable": "Resource not found",
  "Rien à mettre à jour": "Nothing to update",
  "Session expirée": "Session expired",
  "Session indisponible": "Session unavailable",
  "Seul le créateur peut modifier l'accès": "Only the creator can change access",
  "Seul le créateur peut modifier les paramètres": "Only the creator can change settings",
  "Seul le créateur peut régénérer le code": "Only the creator can regenerate the code",
  "Seul le créateur peut retirer un membre": "Only the creator can remove a member",
  "Seul le créateur peut supprimer l'escouade": "Only the creator can delete the squad",
  "Seuls les amis peuvent être invités dans une escouade": "Only friends can be invited to a squad",
  "Si un compte existe, un email a été envoyé": "If an account exists, an email has been sent",
  "Sprite introuvable": "Sprite not found",
  "spriteId invalide": "Invalid spriteId",
  "spriteId requis": "spriteId required",
  "Squad introuvable": "Squad not found",
  "Squad invalide": "Invalid squad",
  "squadId invalide": "Invalid squadId",
  "subscriptionId invalide": "Invalid subscriptionId",
  "Suggestion de comparaison : plus de 15 variantes complémentaires et collections bien renseignées.":
    "Comparison suggestion: more than 15 complementary variants and well-filled collections.",
  "Surface d’interaction invalide": "Invalid interaction surface",
  "targetType invalide": "Invalid targetType",
  "targetUserId invalide": "Invalid targetUserId",
  "Titre requis": "Title required",
  "Toi-même ?": "Yourself?",
  "Token invalide": "Invalid token",
  "Token invalide ou expiré": "Invalid or expired token",
  "Token manquant": "Missing token",
  "Token ou endpoint invalide": "Invalid token or endpoint",
  "Token ou subscription requis": "Token or subscription required",
  "Trop d'enregistrements d'appareil. Réessaie plus tard.": "Too many device registrations. Try again later.",
  "Trop d'escouades créées. Réessaie plus tard.": "Too many squads created. Try again later.",
  "Trop d'événements analytiques. Réessaie plus tard.": "Too many analytics events. Try again later.",
  "Trop de comptes créés depuis cette adresse. Réessaie plus tard.":
    "Too many accounts created from this address. Try again later.",
  "Trop de créations d'objectifs depuis des recommandations. Réessaie dans quelques minutes.":
    "Too many goal creations from recommendations. Try again in a few minutes.",
  "Trop de demandes de réinitialisation. Réessaie plus tard.": "Too many reset requests. Try again later.",
  "Trop de liens actifs : révoque un lien avant d'en créer un autre":
    "Too many active links: revoke one before creating another",
  "Trop de liens créés. Réessaie plus tard.": "Too many links created. Try again later.",
  "Trop de mises à jour des préférences. Réessaie dans quelques minutes.":
    "Too many preference updates. Try again in a few minutes.",
  "Trop de mises à jour du consentement. Réessaie dans quelques minutes.":
    "Too many consent updates. Try again in a few minutes.",
  "Trop de recherches, ralentis un peu.": "Too many searches, slow down a bit.",
  "Trop de régénérations de code. Réessaie plus tard.": "Too many code regenerations. Try again later.",
  "Trop de renvois d'email. Réessaie plus tard.": "Too many email resends. Try again later.",
  "Trop de simulations. Réessaie dans une minute.": "Too many simulations. Try again in a minute.",
  "Trop de synchronisations. Ralentis un peu.": "Too many syncs. Slow down a bit.",
  "Trop de tentatives de connexion. Réessaie dans 15 minutes.": "Too many login attempts. Try again in 15 minutes.",
  "Trop de tentatives OAuth. Réessaie dans quelques minutes.": "Too many OAuth attempts. Try again in a few minutes.",
  "Trop de tentatives pour rejoindre une escouade. Réessaie plus tard.":
    "Too many attempts to join a squad. Try again later.",
  "Trop de tentatives, réessaie plus tard.": "Too many attempts, try again later.",
  "Tu as récemment envoyé une demande. Réessaie dans 7 jours.": "You recently sent a request. Try again in 7 days.",
  "Tu as récemment refusé une demande. Réessaie dans 7 jours.": "You recently declined a request. Try again in 7 days.",
  "Tu dois avoir au moins 15 ans pour créer un compte.": "You must be at least 15 years old to create an account.",
  "Tu ne peux pas t'interagir toi-même": "You cannot interact with yourself",
  "Tu ne peux pas t'inviter toi-même": "You cannot invite yourself",
  "Tu ne peux pas te comparer toi-même": "You can't compare yourself",
  "Type d’interaction invalide": "Invalid interaction type",
  "Type de changement invalide": "Invalid change type",
  "Un objectif personnel ne peut assigner que son créateur": "A personal goal can only assign its creator",
  "Une invitation est déjà en attente": "An invitation is already pending",
  "Une ou plusieurs variantes sont inconnues": "One or more variants are unknown",
  "URL d'avatar invalide": "Invalid avatar URL",
  "Utilisateur déjà bloqué": "User already blocked",
  "Utilisateur introuvable": "User not found",
  "Utilisateur invalide": "Invalid user",
  "Utilisateur non trouvé": "User not found",
  "Utilisez la route leave pour vous retirer": "Use the leave route to remove yourself",
  "Variante non trouvée dans le catalogue actif": "Variant not found in the active catalogue",
  "variantId requis": "variantId required",
  "Visibilité invalide": "Invalid visibility setting",
  "Votre compte est suspendu": "Your account is suspended",
  "Votre rôle ne permet pas d'inviter dans cette escouade": "Your role cannot invite to this squad",
  "Vous êtes déjà amis": "You are already friends",
  "Vous n'êtes pas amis": "You are not friends",
  "Vous n'êtes pas membre actif de cette escouade": "You are not an active member of this squad",
  "Vous n'êtes pas membre de cette escouade": "You are not a member of this squad",
  "Vous ne pouvez pas accéder à cette comparaison": "You cannot access this comparison",
  "Vous ne pouvez pas interagir avec cet utilisateur": "You cannot interact with this user"
});

const ERROR_NL = Object.freeze({
  "Abonnement push invalide": "Ongeldig push-abonnement",
  "Accès interdit : vous ne pouvez modifier que votre propre collection":
    "Verboden: u kunt alleen uw eigen collectie wijzigen",
  "Accès refusé": "Toegang geweigerd",
  "Accès réservé": "Toegang beperkt",
  "Activité non accessible": "Activiteit niet toegankelijk",
  "Alerte forte : variante prioritaire, peu possédée, événement bientôt terminé.":
    "Sterke waarschuwing: prioriteitsvariant, zelden in bezit, evenement eindigt binnenkort.",
  "Appareil introuvable": "Apparaat niet gevonden",
  "Aucun membre dans le périmètre de l'objectif": "Geen leden in het doelbereik",
  "Aucune équipe ne peut couvrir l'objectif": "Geen enkel team kan het doel bereiken",
  "Aucune invitation à annuler": "Geen uitnodiging om te annuleren",
  "Aucune invitation en attente": "Geen openstaande uitnodiging",
  "Aucune invitation en attente pour cette escouade": "Er is geen openstaande uitnodiging voor dit team",
  "Aucune préférence à mettre à jour": "Geen voorkeuren om bij te werken",
  "Authentification requise": "Authenticatie vereist",
  "Badge épinglé invalide": "Ongeldige vastgezette badge",
  "Badges non accessibles": "Badges niet toegankelijk",
  "Carte non disponible": "Kaart niet beschikbaar",
  "Ce compte est suspendu": "Dit account is opgeschort",
  "Ce pseudo est déjà pris": "Deze gebruikersnaam is al in gebruik",
  "Ce pseudo est déjà pris ou temporairement réservé": "Deze gebruikersnaam is al in gebruik of tijdelijk gereserveerd",
  "Cet objectif n'est pas lié à une variante": "Dit doel is niet gekoppeld aan een variant",
  "Cet utilisateur est déjà membre de l'escouade": "Deze gebruiker is al een teamlid",
  "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune":
    "Deze gebruiker accepteert alleen uitnodigingen van leden van een gedeeld team",
  "Cet utilisateur n'accepte pas les invitations": "Deze gebruiker accepteert geen uitnodigingen",
  "Cet utilisateur n'accepte pas les invitations d'escouade": "Deze gebruiker accepteert geen teamuitnodigingen",
  "Cet utilisateur n'est pas bloqué": "Deze gebruiker is niet geblokkeerd",
  "Cet utilisateur ne peut pas être invité": "Deze gebruiker kan niet worden uitgenodigd",
  "Cette escouade n'accepte plus de nouveaux membres": "Deze ploeg accepteert geen nieuwe leden meer",
  "Champ de préférence invalide": "Ongeldig voorkeursveld",
  "Changement de simulation invalide": "Ongeldige simulatiewijziging",
  "changes doit être un tableau": "wijzigingen moeten een array zijn",
  "Cible de recommendation invalide": "Ongeldig aanbevelingsdoel",
  "Clé d'objet invalide": "Ongeldige objectsleutel",
  "Client OAuth obsolète : recharge l'application avant de réessayer.":
    "Verouderde OAuth-client: laad de applicatie opnieuw en probeer het opnieuw.",
  "Code d'escouade introuvable": "Teamcode niet gevonden",
  "Code déjà pris, réessayez": "Code al in gebruik, probeer het opnieuw",
  "Collection non accessible": "Collectie niet toegankelijk",
  "Collection trop volumineuse": "Collectie te groot",
  "Collision de code, réessayez": "Codebotsing, probeer het opnieuw",
  "Collision de token, réessayez": "Tokenbotsing, probeer het opnieuw",
  "Comparaison impossible": "Vergelijking niet mogelijk",
  "Compte invalide": "Ongeldig account",
  "Compte suspendu": "Account opgeschort",
  "Confirmation invalide": "Ongeldige bevestiging",
  "Consentement invalide": "Ongeldige toestemming",
  "cursor invalide": "Ongeldige cursor",
  "Date limite invalide": "Ongeldige deadline",
  "Demande introuvable": "Verzoek niet gevonden",
  "Destinataire requis": "Ontvanger vereist",
  "Données communautaires insuffisantes": "Onvoldoende gemeenschapsgegevens",
  "Durée de partage invalide": "Ongeldige deelduur",
  "Email de vérification renvoyé": "Verificatie-e-mail opnieuw verzonden",
  "Email déjà vérifié": "E-mailadres al geverifieerd",
  "Email non vérifié": "E-mail niet geverifieerd",
  "Email ou mot de passe incorrect": "Onjuist e-mailadres of wachtwoord",
  "Erreur import": "Importfout",
  "Erreur serveur": "Serverfout",
  "Erreur serveur OAuth": "OAuth-serverfout",
  "Erreur sync": "Synchronisatiefout",
  "Escouade introuvable": "Squad niet gevonden",
  "Escouade pleine (max 10)": "Squad is vol (max 10)",
  "Événement inconnu": "Onbekende gebeurtenis",
  "eventId requis pour le mode event": "eventId vereist voor gebeurtenismodus",
  "Filtre invalide": "Ongeldig filter",
  "Fréquence invalide": "Ongeldige frequentie",
  "Fréquences invalides": "Ongeldige frequenties",
  "friendId invalide": "Ongeldige vriend-ID",
  "Fuseau horaire invalide": "Ongeldige tijdzone",
  "Heures silencieuses invalides": "Ongeldige rustige uren",
  "Identifiant de membre invalide": "Ongeldige lid-ID",
  "Identifiant de variante invalide": "Ongeldige variant-ID",
  "Identifiant invalide": "Ongeldige identificatie",
  "Impossible d'enregistrer les réglages du passeport": "Kan paspoortinstellingen niet opslaan",
  "Impossible d'épingler le badge": "Kan badge niet vastzetten",
  "Impossible de calculer le passeport": "Kan paspoort niet berekenen",
  "Impossible de charger l'activité": "Kan activiteit niet laden",
  "Impossible de charger le passeport": "Kan paspoort niet laden",
  "Impossible de charger les badges": "Kan badges niet laden",
  "Impossible de charger les réglages du passeport": "Kan paspoortinstellingen niet laden",
  "Impossible de choisir la squad principale": "Kan het primaire team niet instellen",
  "Impossible de créer le compte": "Kan account niet aanmaken",
  "Impossible de créer un objectif entre des membres bloqués": "Kan geen doel maken tussen geblokkeerde leden",
  "Impossible de générer la carte": "Kan kaart niet genereren",
  "Impossible de partager une collection privée": "Kan een privécollectie niet delen",
  "Impossible de préparer la carte": "Kan de kaart niet voorbereiden",
  "JSON invalide": "Ongeldige JSON",
  "La squad principale doit être une squad active de l'utilisateur":
    "De primaire squad moet een actieve squad van de gebruiker zijn",
  "La taille d'équipe doit être entre 2 et 4": "De teamgrootte moet tussen 2 en 4 zijn",
  "Le badge épinglé doit être débloqué et visible": "De vastgezette badge moet ontgrendeld en zichtbaar zijn",
  "Le créateur ne peut pas être retiré": "De maker kan niet worden verwijderd",
  "Le niveau de maîtrise nécessite une variante possédée.": "Beheersingsniveau vereist een eigen variant.",
  "Les membres assignés doivent être des membres actifs de l'escouade":
    "Toegewezen leden moeten actieve teamleden zijn",
  "Lien de partage invalide": "Ongeldige deellink",
  "Lien de partage invalide ou révoqué": "Ongeldige of ingetrokken deellink",
  "Lien expiré ou révoqué": "Link verlopen of ingetrokken",
  "Lien introuvable": "Link niet gevonden",
  "Lien invalide, expiré ou révoqué": "Ongeldige, verlopen of ingetrokken link",
  "Lien non trouvé": "Link niet gevonden",
  "Limite de notifications invalide": "Ongeldige meldingslimiet",
  "Liste de membres assignés invalide": "Ongeldige lijst met verantwoordelijken",
  "Liste de participants invalide": "Ongeldige deelnemerslijst",
  "Liste de variantes invalide": "Ongeldige variantlijst",
  "maxActiveGoalsPerMember doit être entre 1 et 20": "maxActiveGoalsPerMember moet tussen 1 en 20 liggen",
  "maxActiveGoalsPerMember requis": "maxActiveGoalsPerMember is vereist",
  "memberId invalide": "Ongeldige lid-ID",
  "Membre introuvable dans l'escouade": "Lid niet gevonden in team",
  "method invalide (auto, greedy, exhaustive)": "Ongeldige methode (automatisch, hebzuchtig, exhaustief)",
  "metricKey requis": "metrische sleutel vereist",
  "Métrique introuvable": "Metriek niet gevonden",
  "Mot de passe réinitialisé": "Wachtwoord opnieuw instellen",
  "Motif invalide (1-500 caractères)": "Ongeldige reden (1-500 tekens)",
  "Notification introuvable": "Melding niet gevonden",
  "notificationId requis": "notificatie-ID vereist",
  "Objectif introuvable ou terminé": "Doel niet gevonden of voltooid",
  "Option de livraison invalide": "Ongeldige bezorgoptie",
  "Option de partage invalide": "Ongeldige deeloptie",
  "Option invalide": "Ongeldige optie",
  "Options de livraison invalides": "Ongeldige bezorgopties",
  "Options de partage invalides": "Ongeldige aandelenopties",
  "Overrides invalides": "Ongeldige overschrijvingen",
  "Paramètre manquant pour ce targetType": "Ontbrekende parameter voor dit targetType",
  "Participant invalide": "Ongeldige deelnemer",
  "Pas assez de membres visibles pour former une paire": "Niet genoeg zichtbare leden om een ​​paar te vormen",
  "Passeport non accessible": "Paspoort is niet toegankelijk",
  "Passeport non trouvé": "Paspoort niet gevonden",
  "Préférences invalides": "Ongeldige voorkeuren",
  "Pseudo réservé ou interdit": "Gebruikersnaam gereserveerd of verboden",
  "pushEnabled invalide": "Ongeldige pushEnabled",
  "Recherche invalide": "Ongeldige zoekopdracht",
  "Recommendation requise": "Aanbeveling vereist",
  "recommendationKey requis": "aanbevelingSleutel vereist",
  "Réglages invalides": "Ongeldige instellingen",
  "Réponse OAuth expirée ou déjà utilisée": "Verlopen of al gebruikte OAuth-reactie",
  "Réponse OAuth invalide": "Ongeldige OAuth-reactie",
  "Requête invalide": "Ongeldig verzoek",
  "Requête trop volumineuse": "De hoofdtekst van het verzoek is te groot",
  "Ressource introuvable": "Bron niet gevonden",
  "Rien à mettre à jour": "Niets te updaten",
  "Session expirée": "Sessie verlopen",
  "Session indisponible": "Sessie niet beschikbaar",
  "Seul le créateur peut modifier l'accès": "Alleen de maker kan de toegang wijzigen",
  "Seul le créateur peut modifier les paramètres": "Alleen de maker kan instellingen wijzigen",
  "Seul le créateur peut régénérer le code": "Alleen de maker kan de code opnieuw genereren",
  "Seul le créateur peut retirer un membre": "Alleen de maker kan een lid verwijderen",
  "Seul le créateur peut supprimer l'escouade": "Alleen de maker kan het team verwijderen",
  "Seuls les amis peuvent être invités dans une escouade": "Alleen vrienden kunnen worden uitgenodigd voor een team",
  "Si un compte existe, un email a été envoyé": "Als er een account bestaat, is er een e-mail verzonden",
  "Sprite introuvable": "Sprite niet gevonden",
  "spriteId invalide": "Ongeldige sprite-ID",
  "spriteId requis": "spriteId vereist",
  "Squad introuvable": "Team niet gevonden",
  "Squad invalide": "Ongeldige ploeg",
  "squadId invalide": "Ongeldige squadId",
  "subscriptionId invalide": "Ongeldige abonnements-ID",
  "Suggestion de comparaison : plus de 15 variantes complémentaires et collections bien renseignées.":
    "Vergelijkingssuggestie: ruim 15 complementaire varianten en goed gevulde collecties.",
  "Surface d’interaction invalide": "Ongeldig interactieoppervlak",
  "targetType invalide": "Ongeldig doeltype",
  "targetUserId invalide": "Ongeldige targetUserId",
  "Titre requis": "Titel vereist",
  "Toi-même ?": "Jezelf?",
  "Token invalide": "Ongeldige token",
  "Token invalide ou expiré": "Ongeldig of verlopen token",
  "Token manquant": "Ontbrekend token",
  "Token ou endpoint invalide": "Ongeldig token of eindpunt",
  "Token ou subscription requis": "Token of abonnement vereist",
  "Trop d'enregistrements d'appareil. Réessaie plus tard.": "Te veel apparaatregistraties. Probeer het later opnieuw.",
  "Trop d'escouades créées. Réessaie plus tard.": "Er zijn te veel squadrons gemaakt. Probeer het later opnieuw.",
  "Trop d'événements analytiques. Réessaie plus tard.": "Te veel analysegebeurtenissen. Probeer het later opnieuw.",
  "Trop de comptes créés depuis cette adresse. Réessaie plus tard.":
    "Er zijn te veel accounts aangemaakt vanaf dit adres. Probeer het later opnieuw.",
  "Trop de créations d'objectifs depuis des recommandations. Réessaie dans quelques minutes.":
    "Te veel doelcreaties op basis van aanbevelingen. Probeer het over een paar minuten opnieuw.",
  "Trop de demandes de réinitialisation. Réessaie plus tard.": "Te veel resetverzoeken. Probeer het later opnieuw.",
  "Trop de liens actifs : révoque un lien avant d'en créer un autre":
    "Te veel actieve links: trek er één in voordat u een nieuwe maakt",
  "Trop de liens créés. Réessaie plus tard.": "Er zijn te veel links gemaakt. Probeer het later opnieuw.",
  "Trop de mises à jour des préférences. Réessaie dans quelques minutes.":
    "Te veel voorkeursupdates. Probeer het over een paar minuten opnieuw.",
  "Trop de mises à jour du consentement. Réessaie dans quelques minutes.":
    "Te veel toestemmingsupdates. Probeer het over een paar minuten opnieuw.",
  "Trop de recherches, ralentis un peu.": "Te veel zoekopdrachten, doe het een beetje langzamer.",
  "Trop de régénérations de code. Réessaie plus tard.": "Te veel coderegeneraties. Probeer het later opnieuw.",
  "Trop de renvois d'email. Réessaie plus tard.":
    "Er worden te veel e-mails opnieuw verzonden. Probeer het later opnieuw.",
  "Trop de simulations. Réessaie dans une minute.": "Te veel simulaties. Probeer het over een minuut opnieuw.",
  "Trop de synchronisations. Ralentis un peu.": "Te veel synchronisaties. Doe een beetje langzamer.",
  "Trop de tentatives de connexion. Réessaie dans 15 minutes.":
    "Te veel inlogpogingen. Probeer het over 15 minuten opnieuw.",
  "Trop de tentatives OAuth. Réessaie dans quelques minutes.":
    "Te veel OAuth-pogingen. Probeer het over een paar minuten opnieuw.",
  "Trop de tentatives pour rejoindre une escouade. Réessaie plus tard.":
    "Te veel pogingen om lid te worden van een team. Probeer het later opnieuw.",
  "Trop de tentatives, réessaie plus tard.": "Te veel pogingen. Probeer het later opnieuw.",
  "Tu as récemment envoyé une demande. Réessaie dans 7 jours.":
    "U heeft onlangs een verzoek verzonden. Probeer het over 7 dagen opnieuw.",
  "Tu as récemment refusé une demande. Réessaie dans 7 jours.":
    "U heeft onlangs een verzoek afgewezen. Probeer het over 7 dagen opnieuw.",
  "Tu dois avoir au moins 15 ans pour créer un compte.":
    "Om een ​​account aan te maken moet je minimaal 15 jaar oud zijn.",
  "Tu ne peux pas t'interagir toi-même": "Je kunt geen interactie met jezelf aangaan",
  "Tu ne peux pas t'inviter toi-même": "Je kunt jezelf niet uitnodigen",
  "Tu ne peux pas te comparer toi-même": "Je kunt jezelf niet vergelijken",
  "Type d’interaction invalide": "Ongeldig interactietype",
  "Type de changement invalide": "Ongeldig wijzigingstype",
  "Un objectif personnel ne peut assigner que son créateur": "Een persoonlijk doel kan alleen de maker ervan toewijzen",
  "Une invitation est déjà en attente": "Er is al een uitnodiging in behandeling",
  "Une ou plusieurs variantes sont inconnues": "Eén of meerdere varianten zijn onbekend",
  "URL d'avatar invalide": "Ongeldige avatar-URL",
  "Utilisateur déjà bloqué": "Gebruiker al geblokkeerd",
  "Utilisateur introuvable": "Gebruiker niet gevonden",
  "Utilisateur invalide": "Ongeldige gebruiker",
  "Utilisateur non trouvé": "Gebruiker niet gevonden",
  "Utilisez la route leave pour vous retirer": "Gebruik de verlofroute om jezelf te verwijderen",
  "Variante non trouvée dans le catalogue actif": "Variant niet gevonden in de actieve catalogus",
  "variantId requis": "variantId vereist",
  "Visibilité invalide": "Ongeldige zichtbaarheidsinstelling",
  "Votre compte est suspendu": "Uw account is opgeschort",
  "Votre rôle ne permet pas d'inviter dans cette escouade": "Jouw rol kan geen uitnodigingen zijn voor dit team",
  "Vous êtes déjà amis": "Jullie zijn al vrienden",
  "Vous n'êtes pas amis": "Jullie zijn geen vrienden",
  "Vous n'êtes pas membre actif de cette escouade": "Je bent geen actief lid van dit team",
  "Vous n'êtes pas membre de cette escouade": "Je bent geen lid van dit team",
  "Vous ne pouvez pas accéder à cette comparaison": "U heeft geen toegang tot deze vergelijking",
  "Vous ne pouvez pas interagir avec cet utilisateur": "U kunt geen interactie aangaan met deze gebruiker"
});

function localizeError(message, locale) {
  const source = String(message || "");
  if ((locale !== "en" && locale !== "nl") || !source) return source;
  const dict = locale === "nl" ? ERROR_NL : ERROR_EN;
  if (dict[source]) return dict[source];
  let match = source.match(/^Provider ([\w-]+) non configuré$/i);
  if (match) {
    return locale === "nl" ? `Provider ${match[1]} is niet geconfigureerd` : `Provider ${match[1]} is not configured`;
  }
  match = source.match(/^Ce pseudo est déjà pris(?: ou temporairement réservé)?$/i);
  if (match) {
    if (locale === "nl") {
      return source.includes("temporairement")
        ? "Deze gebruikersnaam is al bezet of tijdelijk gereserveerd"
        : "Deze gebruikersnaam is al bezet";
    }
    return source.includes("temporairement")
      ? "This username is already taken or temporarily reserved"
      : "This username is already taken";
  }
  match = source.match(/^Trop de variantes \((\d+) max\)$/i);
  if (match) {
    return locale === "nl" ? `Te veel varianten (${match[1]} max)` : `Too many variants (${match[1]} max)`;
  }
  match = source.match(/^Trop de membres assignés \((\d+) max\)$/i);
  if (match) {
    return locale === "nl"
      ? `Te veel toegewezen leden (${match[1]} max)`
      : `Too many assigned members (${match[1]} max)`;
  }
  match = source.match(/^Trop de participants \((\d+) max\)$/i);
  if (match) {
    return locale === "nl" ? `Te veel deelnemers (${match[1]} max)` : `Too many participants (${match[1]} max)`;
  }
  match = source.match(/^Trop de changements \((\d+) max\)$/i);
  if (match) {
    return locale === "nl" ? `Te veel wijzigingen (${match[1]} max)` : `Too many changes (${match[1]} max)`;
  }
  match = source.match(/^(.+) trop long \((\d+) max\)$/i);
  if (match) {
    return locale === "nl" ? `${match[1]} te lang (${match[2]} max)` : `${match[1]} too long (${match[2]} max)`;
  }
  match = source.match(/^(.+) trop volumineux$/i);
  if (match) {
    return locale === "nl" ? `${match[1]} te groot` : `${match[1]} too large`;
  }
  match = source.match(/^(.+) invalides?$/i);
  if (match) {
    return locale === "nl" ? `Ongeldige ${match[1]}` : `Invalid ${match[1]}`;
  }
  match = source.match(/^(.+) requis$/i);
  if (match) {
    return locale === "nl" ? `${match[1]} verplicht` : `${match[1]} required`;
  }
  match = source.match(/^(.+) introuvable$/i);
  if (match) {
    return locale === "nl" ? `${match[1]} niet gevonden` : `${match[1]} not found`;
  }
  return source;
}

function localizeErrorResponse(req, res, next) {
  res.locals.locale = resolveLocale(req.get("accept-language"));
  const sendJson = res.json.bind(res);
  res.json = function localizedJson(payload) {
    if (
      (res.locals.locale === "en" || res.locals.locale === "nl") &&
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload)
    ) {
      const result = { ...payload };
      const loc = res.locals.locale;
      if (typeof result.error === "string") result.error = localizeError(result.error, loc);
      if (typeof result.message === "string") result.message = localizeError(result.message, loc);
      return sendJson(result);
    }
    return sendJson(payload);
  };
  next();
}

/** Persist the client Accept-Language for later notification rendering. */
async function rememberPreferredLanguage(pool, userId, acceptLanguageHeader) {
  if (!pool || userId == null || userId === "") return null;
  const lang = resolveLocale(acceptLanguageHeader);
  try {
    await pool.query(
      `UPDATE users
       SET preferred_language = $2
       WHERE id = $1
         AND deleted_at IS NULL
         AND preferred_language IS DISTINCT FROM $2`,
      [userId, lang]
    );
  } catch {
    // Column may be missing mid-migration; notification path still falls back to fr.
  }
  return lang;
}

/**
 * Resolve the language used when creating a notification.
 * Explicit `lang` wins; otherwise the recipient's preferred_language is used.
 */
function resolveNotificationLanguage(preferredLanguage, explicitLang) {
  if (explicitLang != null && String(explicitLang).trim() !== "") {
    return resolveLocale(explicitLang);
  }
  return resolveLocale(preferredLanguage || "fr");
}

module.exports = {
  localizeError,
  localizeErrorResponse,
  resolveLocale,
  rememberPreferredLanguage,
  resolveNotificationLanguage
};
