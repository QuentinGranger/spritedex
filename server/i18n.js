"use strict";

// API localisation is intentionally independent from account data: the client
// sends Accept-Language for every call, and API errors follow that language.
// This keeps unauthenticated flows (login, registration and OAuth) localized.
const FRANCOPHONE_REGIONS = new Set([
  "BE", "BF", "BI", "BJ", "CA", "CD", "CF", "CG", "CH", "CI", "CM", "DJ", "FR",
  "GA", "GF", "GN", "GP", "GQ", "HT", "KM", "LU", "MA", "MC", "MF", "MG", "ML",
  "MQ", "NC", "NE", "PF", "PM", "RE", "RW", "SC", "SN", "TD", "TG", "VU", "WF", "YT"
]);

function resolveLocale(acceptLanguage) {
  const candidates = String(acceptLanguage || "").split(",").map((value) => value.trim().split(";")[0]);
  for (const candidate of candidates) {
    const [language, region] = candidate.replace(/_/g, "-").split("-");
    if (String(language).toLowerCase() === "fr") return "fr";
    if (FRANCOPHONE_REGIONS.has(String(region || "").toUpperCase())) return "fr";
  }
  return "en";
}

const ERROR_EN = Object.freeze({
  "Authentification requise": "Authentication required",
  "Accès refusé": "Access denied",
  "Accès interdit : vous ne pouvez modifier que votre propre collection": "Forbidden: you can only modify your own collection",
  "Compte suspendu": "Account suspended",
  "Utilisateur non trouvé": "User not found",
  "Passeport non trouvé": "Passport not found",
  "Passeport non accessible": "Passport is not accessible",
  "Carte non disponible": "Card unavailable",
  "Session expirée": "Session expired",
  "Session indisponible": "Session unavailable",
  "Token manquant": "Missing token",
  "Token invalide": "Invalid token",
  "Token invalide ou expiré": "Invalid or expired token",
  "Réponse OAuth invalide": "Invalid OAuth response",
  "Réponse OAuth expirée ou déjà utilisée": "Expired or already used OAuth response",
  "Client OAuth obsolète : recharge l'application avant de réessayer.": "Outdated OAuth client: reload the application and try again.",
  "Email ou mot de passe incorrect": "Incorrect email or password",
  "Consentement invalide": "Invalid consent",
  "Réglages invalides": "Invalid settings",
  "Visibilité invalide": "Invalid visibility setting",
  "Option invalide": "Invalid option",
  "Identifiant invalide": "Invalid identifier",
  "Identifiant de variante invalide": "Invalid variant identifier",
  "Type de changement invalide": "Invalid change type",
  "Changement de simulation invalide": "Invalid simulation change",
  "changes doit être un tableau": "changes must be an array",
  "Escouade introuvable": "Squad not found",
  "Code d'escouade introuvable": "Squad code not found",
  "Cette escouade n'accepte plus de nouveaux membres": "This squad is no longer accepting new members",
  "Escouade pleine (max 10)": "Squad is full (max 10)",
  "Code déjà pris, réessayez": "Code already taken, try again",
  "Collision de code, réessayez": "Code collision, try again",
  "Collision de token, réessayez": "Token collision, try again",
  "Seul le créateur peut retirer un membre": "Only the creator can remove a member",
  "Seul le créateur peut régénérer le code": "Only the creator can regenerate the code",
  "Seul le créateur peut modifier l'accès": "Only the creator can change access",
  "Seul le créateur peut modifier les paramètres": "Only the creator can change settings",
  "Le créateur ne peut pas être retiré": "The creator cannot be removed",
  "Utilisez la route leave pour vous retirer": "Use the leave route to remove yourself",
  "Tu ne peux pas t'inviter toi-même": "You cannot invite yourself",
  "Vous n'êtes pas membre de cette escouade": "You are not a member of this squad",
  "Vous n'êtes pas membre actif de cette escouade": "You are not an active member of this squad",
  "Vous ne pouvez pas interagir avec cet utilisateur": "You cannot interact with this user",
  "Cet utilisateur ne peut pas être invité": "This user cannot be invited",
  "Seuls les amis peuvent être invités dans une escouade": "Only friends can be invited to a squad",
  "Cet utilisateur n'accepte pas les invitations d'escouade": "This user does not accept squad invitations",
  "Cet utilisateur n'accepte les invitations que des membres d'une escouade commune": "This user only accepts invitations from members of a shared squad",
  "Cet utilisateur est déjà membre de l'escouade": "This user is already a squad member",
  "Aucune invitation en attente pour cette escouade": "No pending invitation for this squad",
  "Lien de partage invalide": "Invalid share link",
  "Lien de partage invalide ou révoqué": "Invalid or revoked share link",
  "Ressource introuvable": "Resource not found",
  "Requête trop volumineuse": "Request body is too large",
  "JSON invalide": "Invalid JSON",
  "Erreur serveur": "Server error",
  "Erreur serveur OAuth": "OAuth server error",
  "Impossible de créer le compte": "Unable to create account",
  "Impossible de calculer le passeport": "Unable to calculate passport",
  "Impossible de charger le passeport": "Unable to load passport",
  "Impossible de préparer la carte": "Unable to prepare card",
  "Impossible de charger les réglages du passeport": "Unable to load passport settings",
  "Impossible d'enregistrer les réglages du passeport": "Unable to save passport settings",
  "Rien à mettre à jour": "Nothing to update",
  "maxActiveGoalsPerMember requis": "maxActiveGoalsPerMember is required",
  "maxActiveGoalsPerMember doit être entre 1 et 20": "maxActiveGoalsPerMember must be between 1 and 20"
});

function localizeError(message, locale) {
  const source = String(message || "");
  if (locale !== "en" || !source) return source;
  if (ERROR_EN[source]) return ERROR_EN[source];
  let match = source.match(/^Provider ([\w-]+) non configuré$/i);
  if (match) return `Provider ${match[1]} is not configured`;
  match = source.match(/^Ce pseudo est déjà pris(?: ou temporairement réservé)?$/i);
  if (match) return source.includes("temporairement") ? "This username is already taken or temporarily reserved" : "This username is already taken";
  return source;
}

function localizeErrorResponse(req, res, next) {
  res.locals.locale = resolveLocale(req.get("accept-language"));
  const sendJson = res.json.bind(res);
  res.json = function localizedJson(payload) {
    if (res.locals.locale === "en" && res.statusCode >= 400 && payload && typeof payload === "object" && !Array.isArray(payload)) {
      const result = { ...payload };
      if (typeof result.error === "string") result.error = localizeError(result.error, "en");
      if (typeof result.message === "string") result.message = localizeError(result.message, "en");
      return sendJson(result);
    }
    return sendJson(payload);
  };
  next();
}

module.exports = { localizeError, localizeErrorResponse, resolveLocale };
