/* ── SPRITNEX — contenus juridiques et conformité (France / Union européenne) ──
 * Version prête à intégrer dans le site et l'application.
 *
 * Hypothèses retenues :
 * - application de fan gratuite, accessible sans finalité commerciale ;
 * - éditeur individuel non professionnel, sans SIREN/SIRET ;
 * - comptes réservés aux personnes âgées d'au moins 15 ans ;
 * - hébergement du serveur et de la base de données chez Render ;
 * - authentification possible par Google, Apple et Discord ;
 * - envoi éventuel d'e-mails transactionnels par Resend ;
 * - aucun traceur facultatif activé avant le consentement de l'utilisateur.
 *
 * IMPORTANT : le contenu juridique doit toujours correspondre au fonctionnement
 * réel du service. Supprimez de la liste des prestataires ou des données tout
 * élément qui n'est pas effectivement utilisé par SPRITNEX.
 *
 * Sources principales vérifiées le 18 juillet 2026 :
 * - LCEN, article 1-1 : https://www.legifrance.gouv.fr/
 * - RGPD et recommandations cookies : https://www.cnil.fr/
 * - Politique de contenu de fan Epic Games :
 *   https://legal.epicgames.com/epicgames/fan-art-policy?lang=fr
 * - Render DPA : https://render.com/dpa
 * - Render Terms : https://render.com/terms
 *
 * Ce module constitue une base éditoriale et technique. Il ne remplace pas
 * l'examen personnalisé d'un juriste, en particulier avant toute monétisation.
 */

"use strict";

const LEGAL_VERSION = "2026.07.18-1";
const LEGAL_LAST_UPDATED_ISO = "2026-07-18";
const LEGAL_LAST_UPDATED_FR = "18 juillet 2026";

const LEGAL_CONFIG = Object.freeze({
  APP_NAME: "SPRITNEX",
  EDITOR_NAME: "Quentin SAVIGNY",
  EDITOR_STATUS: "éditeur individuel non professionnel",
  CONTACT_EMAIL: "quentinsavigny@protonmail.com",
  SUPPORT_EMAIL: "quentinsavigny@protonmail.com",
  PRIVACY_EMAIL: "quentinsavigny@protonmail.com",
  REPORT_EMAIL: "quentinsavigny@protonmail.com",

  HOST_NAME: "Render Services, Inc.",
  HOST_ADDRESS:
    "525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis",
  HOST_PHONE: "+1 415 881 5869",
  HOST_WEBSITE: "https://render.com",
  HOST_SUPPORT: "https://render.com/support",
  HOST_LEGAL_EMAIL: "legal@render.com",

  CNIL_URL: "https://www.cnil.fr",
  EPIC_FAN_POLICY_URL:
    "https://legal.epicgames.com/epicgames/fan-art-policy?lang=fr",

  ACCOUNT_MINIMUM_AGE: "15",
  ACCOUNT_DELETION_DELAY: "30 jours maximum",
  SECURITY_LOG_RETENTION: "12 mois maximum",
  CONSENT_CHOICE_RETENTION: "6 mois",
  OPTIONAL_TRACKER_RETENTION: "13 mois maximum"
});

const EPIC_DISCLAIMER =
  "Des parties des supports utilisés sont des marques déposées et/ou des travaux soumis aux droits d’auteur d’Epic Games, Inc. Tous droits réservés par Epic. Ce produit n’est pas officiel et n’a pas l’approbation d’Epic.";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderLegalTemplate(template) {
  const replacements = {
    APP_NAME: LEGAL_CONFIG.APP_NAME,
    EDITOR_NAME: LEGAL_CONFIG.EDITOR_NAME,
    EDITOR_STATUS: LEGAL_CONFIG.EDITOR_STATUS,
    CONTACT_EMAIL: LEGAL_CONFIG.CONTACT_EMAIL,
    SUPPORT_EMAIL: LEGAL_CONFIG.SUPPORT_EMAIL,
    PRIVACY_EMAIL: LEGAL_CONFIG.PRIVACY_EMAIL,
    REPORT_EMAIL: LEGAL_CONFIG.REPORT_EMAIL,
    HOST_NAME: LEGAL_CONFIG.HOST_NAME,
    HOST_ADDRESS: LEGAL_CONFIG.HOST_ADDRESS,
    HOST_PHONE: LEGAL_CONFIG.HOST_PHONE,
    HOST_WEBSITE: LEGAL_CONFIG.HOST_WEBSITE,
    HOST_SUPPORT: LEGAL_CONFIG.HOST_SUPPORT,
    HOST_LEGAL_EMAIL: LEGAL_CONFIG.HOST_LEGAL_EMAIL,
    CNIL_URL: LEGAL_CONFIG.CNIL_URL,
    EPIC_FAN_POLICY_URL: LEGAL_CONFIG.EPIC_FAN_POLICY_URL,
    ACCOUNT_MINIMUM_AGE: LEGAL_CONFIG.ACCOUNT_MINIMUM_AGE,
    ACCOUNT_DELETION_DELAY: LEGAL_CONFIG.ACCOUNT_DELETION_DELAY,
    SECURITY_LOG_RETENTION: LEGAL_CONFIG.SECURITY_LOG_RETENTION,
    CONSENT_CHOICE_RETENTION: LEGAL_CONFIG.CONSENT_CHOICE_RETENTION,
    OPTIONAL_TRACKER_RETENTION: LEGAL_CONFIG.OPTIONAL_TRACKER_RETENTION,
    EPIC_DISCLAIMER,
    LEGAL_VERSION,
    LEGAL_LAST_UPDATED_FR
  };

  let result = String(template);

  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(
      new RegExp(`\\[${key}\\]`, "g"),
      escapeHtml(value)
    );
  }

  const unresolvedPlaceholders = result.match(/\[[A-Z0-9_]+\]/g);
  if (unresolvedPlaceholders) {
    throw new Error(
      `Placeholders juridiques non remplacés : ${[
        ...new Set(unresolvedPlaceholders)
      ].join(", ")}`
    );
  }

  return result.trim();
}

function legalDocument({ id, title, short, content }) {
  return Object.freeze({
    id,
    title,
    short,
    version: LEGAL_VERSION,
    lastUpdated: LEGAL_LAST_UPDATED_ISO,
    lastUpdatedLabel: LEGAL_LAST_UPDATED_FR,
    content: renderLegalTemplate(content)
  });
}

const LEGAL_DOCUMENTS = Object.freeze({
  "mentions-legales": legalDocument({
    id: "mentions-legales",
    title: "Mentions légales",
    short: "Édition, hébergement, propriété intellectuelle et avertissement Epic Games.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Édition du service</h2>
      <p><strong>[APP_NAME]</strong> est un service en ligne gratuit édité à titre non professionnel par une personne physique, sous la responsabilité de <strong>[EDITOR_NAME]</strong>.</p>
      <p>L'éditeur agit en qualité d'<strong>[EDITOR_STATUS]</strong>, sans immatriculation professionnelle ni numéro de TVA intracommunautaire pour cette activité.</p>
      <p>Afin de protéger son domicile privé, l'adresse personnelle de l'éditeur n'est pas publiée. Les éléments permettant son identification ont été communiqués à l'hébergeur conformément aux dispositions applicables aux éditeurs non professionnels de services de communication au public en ligne.</p>

      <h2>2. Directeur de la publication</h2>
      <p>Le directeur de la publication est <strong>[EDITOR_NAME]</strong>.</p>

      <h2>3. Contact</h2>
      <p>Pour toute question concernant le service : <a href="mailto:[CONTACT_EMAIL]">[CONTACT_EMAIL]</a>.</p>

      <h2>4. Hébergement</h2>
      <address>
        <strong>[HOST_NAME]</strong><br>
        [HOST_ADDRESS]<br>
        Téléphone : <a href="tel:+14158815869">[HOST_PHONE]</a><br>
        Site : <a href="[HOST_WEBSITE]" target="_blank" rel="noopener noreferrer">[HOST_WEBSITE]</a><br>
        Assistance : <a href="[HOST_SUPPORT]" target="_blank" rel="noopener noreferrer">[HOST_SUPPORT]</a><br>
        Contact juridique : <a href="mailto:[HOST_LEGAL_EMAIL]">[HOST_LEGAL_EMAIL]</a>
      </address>
      <p>Le serveur applicatif et la base de données de [APP_NAME] sont hébergés au moyen des services Render.</p>

      <h2>5. Nature du service</h2>
      <p>[APP_NAME] est une application de fan gratuite permettant notamment de répertorier une collection de Sprites liés à Fortnite, de suivre les éléments possédés ou recherchés et, selon les réglages choisis, de comparer une collection avec celle d'autres utilisateurs.</p>
      <p>[APP_NAME] ne vend aucun Sprite, objet Fortnite, compte de jeu ou contenu numérique, et n'agit pas comme intermédiaire de paiement ou de transaction.</p>

      <h2>6. Propriété intellectuelle propre à SPRITNEX</h2>
      <p>Sous réserve des éléments appartenant à des tiers, la structure de l'application, son code source, son interface originale, ses textes juridiques, sa charte graphique et son logo propre sont protégés par le droit de la propriété intellectuelle.</p>
      <p>Toute reproduction ou exploitation non autorisée de ces créations est interdite, sauf disposition légale contraire ou autorisation écrite préalable de l'éditeur.</p>

      <h2>7. Fortnite et Epic Games</h2>
      <p>Fortnite, Epic Games, leurs marques, personnages, objets, illustrations, sons et autres éléments protégés appartiennent à Epic Games, Inc. ou à leurs titulaires respectifs.</p>
      <p>[APP_NAME] est une création de fan indépendante. Le service n'est ni affilié à Epic Games, ni sponsorisé, ni approuvé, ni endossé par Epic Games.</p>
      <blockquote class="epic-disclaimer"><p>[EPIC_DISCLAIMER]</p></blockquote>
      <p>La politique officielle relative au contenu de fan peut être consultée sur <a href="[EPIC_FAN_POLICY_URL]" target="_blank" rel="noopener noreferrer">le site juridique d'Epic Games</a>.</p>

      <h2>8. Responsabilité</h2>
      <p>L'éditeur s'efforce de présenter des informations exactes et à jour, sans pouvoir garantir l'absence totale d'erreur, notamment lorsque des noms, variantes ou visuels évoluent à la suite d'une mise à jour de Fortnite.</p>
      <p>Les liens externes sont fournis à titre informatif. L'éditeur n'exerce aucun contrôle sur leur contenu ou leur disponibilité.</p>
    `
  }),

  "politique-confidentialite": legalDocument({
    id: "politique-confidentialite",
    title: "Politique de confidentialité",
    short: "Données collectées, bases légales, destinataires, conservation et droits RGPD.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Responsable du traitement</h2>
      <p>Le responsable du traitement des données personnelles utilisées par [APP_NAME] est <strong>[EDITOR_NAME]</strong>.</p>
      <p>Contact relatif à la protection des données : <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <p>Aucun délégué à la protection des données n'a été désigné, cette désignation n'étant pas obligatoire au regard de la nature et de l'échelle actuelles du service.</p>

      <h2>2. Champ d'application</h2>
      <p>La présente politique explique comment les données personnelles sont traitées lorsque vous consultez le site, utilisez l'application, créez un compte, gérez votre collection, rejoignez une escouade, partagez un profil, activez des notifications ou contactez le support.</p>

      <h2>3. Données susceptibles d'être traitées</h2>
      <ul>
        <li><strong>Compte et identité numérique :</strong> adresse e-mail, pseudonyme, avatar, identifiant interne, date de création du compte et statut du compte.</li>
        <li><strong>Authentification tierce :</strong> identifiant technique transmis par Google, Apple ou Discord, ainsi que les informations de profil que vous autorisez le fournisseur à transmettre, généralement l'adresse e-mail, le nom d'affichage et l'avatar.</li>
        <li><strong>Collection et préférences :</strong> Sprites possédés, recherchés, favoris ou prioritaires, variantes, paramètres d'affichage et préférences de notification.</li>
        <li><strong>Fonctions sociales :</strong> escouades rejointes ou créées, invitations, liens de partage, niveau de visibilité du profil, utilisateurs bloqués et signalements.</li>
        <li><strong>Données techniques et de sécurité :</strong> adresse IP, type de navigateur ou d'appareil, système d'exploitation, date et heure des connexions, journaux techniques, identifiants de session, erreurs et tentatives d'accès suspectes.</li>
        <li><strong>Notifications :</strong> jeton technique de notification fourni par le système d'exploitation ou le service de notification, uniquement lorsque les notifications sont activées.</li>
        <li><strong>Support :</strong> contenu des demandes envoyées à l'éditeur et pièces jointes communiquées volontairement.</li>
        <li><strong>Consentements :</strong> choix relatifs aux traceurs facultatifs, aux notifications et version des CGU acceptée.</li>
      </ul>
      <p>[APP_NAME] ne demande pas de données dites sensibles au sens du RGPD. Il est demandé aux utilisateurs de ne pas communiquer de données de santé, d'identifiants officiels, de données bancaires ou d'autres informations sensibles dans les champs libres ou les demandes de support.</p>

      <h2>4. Finalités et bases légales</h2>
      <div class="legal-table-wrapper">
        <table class="legal-table">
          <thead>
            <tr><th>Finalité</th><th>Données principales</th><th>Base légale</th></tr>
          </thead>
          <tbody>
            <tr><td>Créer et gérer le compte</td><td>E-mail, pseudonyme, identifiant, avatar</td><td>Exécution des CGU</td></tr>
            <tr><td>Authentifier l'utilisateur, y compris par Google, Apple ou Discord</td><td>Identifiants de compte et jetons techniques</td><td>Exécution des CGU et demande de l'utilisateur</td></tr>
            <tr><td>Sauvegarder, synchroniser et afficher la collection</td><td>Collection, variantes et préférences</td><td>Exécution des CGU</td></tr>
            <tr><td>Gérer les escouades, invitations et comparaisons de collections</td><td>Identifiant, collection partagée et paramètres de visibilité</td><td>Exécution des CGU</td></tr>
            <tr><td>Envoyer les e-mails nécessaires au compte</td><td>E-mail et événements de compte</td><td>Exécution des CGU</td></tr>
            <tr><td>Envoyer des notifications facultatives</td><td>Jeton de notification et préférences</td><td>Consentement</td></tr>
            <tr><td>Prévenir les abus, protéger les comptes et assurer la sécurité</td><td>Adresse IP, journaux et événements de sécurité</td><td>Intérêt légitime de sécurisation du service</td></tr>
            <tr><td>Traiter les signalements et appliquer les règles communautaires</td><td>Compte, contenu signalé, preuves et échanges</td><td>Intérêt légitime et, le cas échéant, obligation légale</td></tr>
            <tr><td>Répondre aux demandes du support et aux demandes RGPD</td><td>Coordonnées et contenu de la demande</td><td>Exécution des CGU, obligation légale ou intérêt légitime selon la demande</td></tr>
            <tr><td>Mesurer facultativement l'audience ou les performances</td><td>Interactions techniques et statistiques</td><td>Consentement préalable, sauf exemption légale strictement applicable</td></tr>
            <tr><td>Répondre à une autorité compétente</td><td>Données strictement demandées</td><td>Obligation légale</td></tr>
          </tbody>
        </table>
      </div>

      <h2>5. Caractère obligatoire ou facultatif</h2>
      <p>Les données signalées comme obligatoires lors de l'inscription sont nécessaires à la création et à la gestion du compte. Sans elles, les fonctions nécessitant un compte ne peuvent pas être fournies.</p>
      <p>L'activation des notifications, des traceurs facultatifs, d'un avatar personnalisé, d'une escouade ou d'un profil public reste facultative. Le refus n'empêche pas l'utilisation des fonctions principales qui n'en dépendent pas.</p>

      <h2>6. Destinataires et sous-traitants</h2>
      <p>Les données sont accessibles uniquement dans la mesure nécessaire par :</p>
      <ul>
        <li><strong>l'éditeur de [APP_NAME]</strong>, pour administrer, sécuriser et assister le service ;</li>
        <li><strong>[HOST_NAME]</strong>, pour l'hébergement du serveur, de la base de données et des journaux techniques ;</li>
        <li><strong>Google, Apple ou Discord</strong>, uniquement lorsque vous choisissez leur service d'authentification ;</li>
        <li><strong>Resend</strong>, si ce prestataire est utilisé pour envoyer les e-mails transactionnels ;</li>
        <li><strong>le fournisseur de notifications de l'appareil</strong>, notamment Apple ou Google, lorsque vous activez les notifications ;</li>
        <li><strong>les autres utilisateurs autorisés</strong>, uniquement pour les informations rendues visibles selon vos réglages de confidentialité ;</li>
        <li><strong>les autorités compétentes</strong>, lorsqu'une transmission est imposée ou autorisée par la loi.</li>
      </ul>
      <p>Les données personnelles ne sont ni vendues ni louées à des annonceurs.</p>

      <h2>7. Visibilité et partage de la collection</h2>
      <p>Vous choisissez le niveau de visibilité proposé par le service : privé, limité à une escouade ou accessible au moyen d'un lien de partage. Un lien de partage peut être révoqué depuis les paramètres prévus à cet effet.</p>
      <p>Avant de rendre un profil ou une collection visible, vérifiez que votre pseudonyme et votre avatar ne révèlent pas d'informations que vous souhaitez garder privées.</p>

      <h2>8. Transferts hors de l'Espace économique européen</h2>
      <p>Render est une société établie aux États-Unis et indique que ses principales opérations de traitement ont lieu aux États-Unis. Son addendum relatif au traitement des données prévoit le recours au cadre de protection des données UE–États-Unis lorsqu'il s'applique et, à défaut, aux clauses contractuelles types de la Commission européenne ainsi qu'à des mesures complémentaires.</p>
      <p>Les fournisseurs d'authentification, d'e-mails ou de notifications peuvent également traiter certaines données hors de l'Espace économique européen conformément à leurs propres garanties et politiques de confidentialité.</p>

      <h2>9. Durées de conservation</h2>
      <div class="legal-table-wrapper">
        <table class="legal-table">
          <thead><tr><th>Catégorie</th><th>Durée ou critère</th></tr></thead>
          <tbody>
            <tr><td>Compte, profil et collection synchronisée</td><td>Pendant l'existence du compte, puis suppression dans un délai de [ACCOUNT_DELETION_DELAY], sauf obligation légale ou incident de sécurité en cours</td></tr>
            <tr><td>Identifiants techniques des fournisseurs OAuth</td><td>Pendant l'existence du compte ou jusqu'à la dissociation du fournisseur lorsqu'elle est proposée</td></tr>
            <tr><td>Jetons de session</td><td>Jusqu'à expiration, déconnexion, révocation ou suppression du compte</td></tr>
            <tr><td>Jeton de notification</td><td>Jusqu'à la désactivation des notifications, l'invalidation du jeton ou la suppression du compte</td></tr>
            <tr><td>Journaux techniques et de sécurité</td><td>[SECURITY_LOG_RETENTION], sauf nécessité de conservation plus longue liée à un incident ou à une obligation légale</td></tr>
            <tr><td>Demandes de support</td><td>Jusqu'à 24 mois après la clôture de la demande, sauf nécessité particulière</td></tr>
            <tr><td>Signalements et décisions de modération</td><td>Jusqu'à 24 mois après la clôture, ou plus longtemps lorsqu'un contentieux ou une obligation légale le justifie</td></tr>
            <tr><td>Choix d'acceptation ou de refus des traceurs</td><td>[CONSENT_CHOICE_RETENTION] avant une nouvelle sollicitation, sauf modification importante des finalités ou prestataires</td></tr>
            <tr><td>Traceurs facultatifs de mesure d'audience</td><td>[OPTIONAL_TRACKER_RETENTION], sans prorogation automatique lorsque cette règle est applicable</td></tr>
          </tbody>
        </table>
      </div>

      <h2>10. Sécurité</h2>
      <p>[APP_NAME] met en œuvre des mesures techniques et organisationnelles adaptées au risque, notamment le chiffrement des communications, la limitation des accès administratifs, la gestion de sessions, la journalisation des événements de sécurité et la mise à jour des dépendances.</p>
      <p>Aucun service en ligne ne peut toutefois garantir une sécurité absolue. En cas de suspicion de compromission, modifiez vos accès auprès du fournisseur concerné et contactez immédiatement <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a>.</p>

      <h2>11. Authentification par un fournisseur tiers</h2>
      <p>[APP_NAME] ne reçoit et ne stocke jamais votre mot de passe Google, Apple ou Discord. L'authentification repose sur des identifiants et jetons techniques fournis par le prestataire choisi.</p>
      <p>Votre relation avec ce prestataire demeure également soumise à ses propres conditions d'utilisation et à sa politique de confidentialité.</p>

      <h2>12. Vos droits</h2>
      <p>Selon les conditions prévues par le RGPD, vous pouvez exercer les droits suivants :</p>
      <ul>
        <li>droit d'accès à vos données ;</li>
        <li>droit de rectification des données inexactes ;</li>
        <li>droit à l'effacement ;</li>
        <li>droit à la limitation du traitement ;</li>
        <li>droit d'opposition aux traitements fondés sur l'intérêt légitime ;</li>
        <li>droit de retirer votre consentement à tout moment, sans effet rétroactif ;</li>
        <li>droit à la portabilité des données fournies, lorsque les conditions légales sont réunies ;</li>
        <li>droit de définir des directives relatives au sort de vos données après votre décès, dans les conditions prévues par le droit français.</li>
      </ul>
      <p>Pour exercer un droit, écrivez à <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a> en précisant l'adresse e-mail associée au compte et la nature de la demande. Une preuve d'identité ne sera demandée qu'en cas de doute raisonnable sur l'identité du demandeur.</p>
      <p>Une réponse est apportée en principe dans un délai d'un mois, pouvant être prolongé dans les conditions prévues par le RGPD.</p>
      <p>Vous pouvez déposer une réclamation auprès de la CNIL : <a href="[CNIL_URL]" target="_blank" rel="noopener noreferrer">[CNIL_URL]</a>.</p>

      <h2>13. Mineurs</h2>
      <p>La création d'un compte est réservée aux personnes âgées d'au moins [ACCOUNT_MINIMUM_AGE] ans. Les personnes plus jeunes ne doivent pas créer de compte ni communiquer de données personnelles au service.</p>
      <p>Lorsqu'un compte appartenant à une personne de moins de [ACCOUNT_MINIMUM_AGE] ans est identifié, il peut être suspendu puis supprimé, sous réserve des vérifications nécessaires.</p>

      <h2>14. Décision automatisée</h2>
      <p>[APP_NAME] ne prend aucune décision produisant des effets juridiques ou affectant significativement un utilisateur sur le seul fondement d'un traitement automatisé.</p>

      <h2>15. Modification de la politique</h2>
      <p>Cette politique peut évoluer afin de refléter une modification du service, des prestataires ou des exigences légales. La date et la version du document sont affichées en tête de page. En cas de changement important, une information appropriée est présentée dans le service.</p>
    `
  }),

  "cgu": legalDocument({
    id: "cgu",
    title: "Conditions générales d'utilisation",
    short: "Conditions d'accès, règles d'utilisation, comptes et responsabilités.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Objet</h2>
      <p>Les présentes Conditions générales d'utilisation, ci-après les « CGU », encadrent l'accès et l'utilisation de [APP_NAME], une application de fan gratuite consacrée au suivi et à la comparaison de collections de Sprites liés à Fortnite.</p>
      <p>En utilisant le service ou en créant un compte, vous acceptez les présentes CGU dans leur version applicable.</p>

      <h2>2. Service indépendant et non officiel</h2>
      <p>[APP_NAME] est un projet indépendant, non officiel et non commercial. Il n'est ni affilié à Epic Games, ni approuvé, sponsorisé ou endossé par Epic Games.</p>
      <blockquote class="epic-disclaimer"><p>[EPIC_DISCLAIMER]</p></blockquote>

      <h2>3. Accès et âge minimal</h2>
      <p>La consultation de certaines parties du service peut être possible sans compte. Les fonctions de synchronisation, d'escouade, de partage ou de comparaison peuvent nécessiter un compte.</p>
      <p>La création d'un compte est réservée aux personnes âgées d'au moins [ACCOUNT_MINIMUM_AGE] ans. En créant un compte, l'utilisateur déclare satisfaire à cette condition.</p>

      <h2>4. Création et sécurité du compte</h2>
      <p>L'utilisateur doit fournir des informations exactes et conserver la maîtrise de son compte ainsi que des accès au fournisseur d'authentification choisi.</p>
      <p>Un compte est personnel. Il ne doit pas être vendu, cédé, loué ou partagé de manière à permettre l'usurpation de l'identité de son titulaire.</p>
      <p>L'utilisateur doit signaler rapidement toute utilisation non autorisée ou suspicion de compromission à <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a>.</p>

      <h2>5. Acceptation et preuve</h2>
      <p>Lorsque l'inscription le prévoit, l'utilisateur accepte les CGU au moyen d'une case non précochée. La date, l'heure, l'identifiant du compte et la version acceptée peuvent être conservés afin de prouver l'acceptation.</p>

      <h2>6. Fonctions proposées</h2>
      <p>Selon la version du service, [APP_NAME] peut notamment permettre :</p>
      <ul>
        <li>de consulter une liste de Sprites et de variantes ;</li>
        <li>d'indiquer les éléments possédés, recherchés, favoris ou prioritaires ;</li>
        <li>de synchroniser une collection entre plusieurs appareils ;</li>
        <li>de rejoindre une escouade ou d'inviter d'autres utilisateurs ;</li>
        <li>de comparer des collections selon les réglages de visibilité ;</li>
        <li>de créer et révoquer des liens de partage ;</li>
        <li>de recevoir des notifications facultatives.</li>
      </ul>
      <p>Les fonctions peuvent évoluer, être limitées, suspendues ou supprimées, notamment pour des raisons techniques, juridiques, de sécurité ou liées aux droits de tiers.</p>

      <h2>7. Gratuité et absence de transaction</h2>
      <p>L'accès à [APP_NAME] est gratuit. Le service ne vend pas de biens virtuels, n'organise pas de transaction, ne garantit aucun échange entre utilisateurs et ne fournit aucun accès à un compte Epic Games.</p>
      <p>Toute éventuelle monétisation future ferait l'objet d'une vérification préalable des autorisations nécessaires, d'une mise à jour des documents contractuels et, le cas échéant, d'un changement de statut de l'éditeur.</p>

      <h2>8. Règles d'utilisation</h2>
      <p>Il est notamment interdit :</p>
      <ul>
        <li>d'usurper l'identité d'une autre personne ou de créer un compte trompeur ;</li>
        <li>de harceler, menacer, humilier ou discriminer un utilisateur ;</li>
        <li>de publier ou transmettre un contenu illicite, haineux, pornographique, frauduleux ou portant atteinte aux droits d'un tiers ;</li>
        <li>de divulguer les données personnelles d'une autre personne sans autorisation ;</li>
        <li>d'utiliser le service pour organiser une escroquerie, vendre un compte, promouvoir de la triche, du piratage ou le contournement des règles d'Epic Games ;</li>
        <li>d'accéder ou tenter d'accéder sans autorisation à un compte, une base de données, une interface d'administration ou une fonction technique ;</li>
        <li>de diffuser un logiciel malveillant, de saturer le service ou de perturber son fonctionnement ;</li>
        <li>d'extraire massivement ou automatiquement les données du service sans autorisation écrite ;</li>
        <li>de copier ou exploiter commercialement [APP_NAME] ou ses créations propres sans autorisation ;</li>
        <li>de laisser croire que [APP_NAME] ou un compte utilisateur est un service officiel d'Epic Games.</li>
      </ul>

      <h2>9. Pseudonymes, avatars et contenus transmis</h2>
      <p>L'utilisateur demeure responsable des pseudonymes, avatars, messages, captures d'écran ou autres éléments qu'il transmet au service. Il garantit disposer des droits nécessaires pour les utiliser.</p>
      <p>Pour permettre le fonctionnement technique du service, l'utilisateur accorde à l'éditeur une autorisation non exclusive, gratuite, mondiale et limitée à la durée d'hébergement du contenu, uniquement afin de stocker, reproduire techniquement, afficher et transmettre ce contenu conformément à ses choix de visibilité.</p>
      <p>Cette autorisation prend fin lorsque le contenu est supprimé des systèmes actifs, sous réserve des délais techniques de suppression et des obligations légales.</p>

      <h2>10. Collection, escouades et liens de partage</h2>
      <p>Les informations enregistrées dans une collection reposent principalement sur les déclarations de l'utilisateur. [APP_NAME] ne certifie pas la possession réelle des éléments indiqués.</p>
      <p>L'utilisateur est responsable du niveau de visibilité choisi. Un lien de partage doit être traité comme un lien potentiellement accessible à toute personne qui le reçoit. Il peut être révoqué depuis les fonctions prévues à cet effet.</p>

      <h2>11. Signalement et modération</h2>
      <p>Un contenu ou un comportement contraire aux présentes CGU peut être signalé au moyen de la fonction prévue dans le service ou à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>.</p>
      <p>Selon la gravité et les éléments disponibles, l'éditeur peut retirer un contenu, limiter une fonction, révoquer un lien, avertir l'utilisateur, suspendre temporairement le compte ou supprimer le compte.</p>
      <p>Lorsque cela est raisonnablement possible et légalement approprié, l'utilisateur concerné reçoit une information sur la mesure prise et peut la contester.</p>

      <h2>12. Suspension et suppression du compte</h2>
      <p>L'utilisateur peut demander la suppression de son compte à tout moment depuis les paramètres prévus à cet effet ou en écrivant à <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <p>L'éditeur peut suspendre ou supprimer un compte en cas de violation des CGU, de risque pour la sécurité, d'obligation légale, d'inactivité prolongée annoncée à l'utilisateur ou d'arrêt du service.</p>
      <p>Une mesure immédiate peut être prise lorsque la sécurité des utilisateurs, l'intégrité du service ou le respect de la loi l'exige.</p>

      <h2>13. Disponibilité, maintenance et sauvegarde</h2>
      <p>[APP_NAME] est fourni en l'état et selon les disponibilités techniques. L'éditeur ne garantit pas un accès continu, exempt d'erreur ou compatible avec tous les appareils.</p>
      <p>Des interruptions peuvent survenir pour maintenance, correction, mise à jour, incident de sécurité, panne d'un prestataire ou cas de force majeure.</p>
      <p>L'utilisateur est invité à conserver toute copie personnelle utile de sa collection. L'éditeur ne garantit pas la récupération de données supprimées ou perdues au-delà des mécanismes effectivement disponibles dans le service.</p>

      <h2>14. Exactitude des informations</h2>
      <p>Les contenus relatifs à Fortnite et aux Sprites sont proposés à titre informatif. Des erreurs, retards de mise à jour ou différences de dénomination peuvent exister.</p>
      <p>Les informations publiées par Epic Games ou directement visibles dans Fortnite prévalent en cas de divergence.</p>

      <h2>15. Propriété intellectuelle</h2>
      <p>Les droits relatifs à Fortnite et aux éléments d'Epic Games restent la propriété de leurs titulaires. Les créations originales propres à [APP_NAME], notamment son code, son interface, sa structure et son identité visuelle distincte, sont protégées.</p>
      <p>Aucune disposition des CGU ne transfère à l'utilisateur un droit de propriété sur [APP_NAME] ou sur les contenus de tiers.</p>

      <h2>16. Limitation de responsabilité</h2>
      <p>Dans les limites permises par la loi, l'éditeur ne peut être tenu responsable d'un dommage indirect, d'une perte de chance, d'une décision prise sur la seule base d'une information non vérifiée, d'un échange organisé hors du service ou d'un acte commis par un autre utilisateur.</p>
      <p>La présente clause ne limite pas une responsabilité qui ne pourrait légalement être exclue ou limitée.</p>

      <h2>17. Données personnelles</h2>
      <p>Les traitements de données personnelles sont décrits dans la Politique de confidentialité de [APP_NAME], qui fait partie de l'information contractuelle fournie à l'utilisateur.</p>

      <h2>18. Modification des CGU</h2>
      <p>Les CGU peuvent être modifiées pour tenir compte d'une évolution du service, de la loi, de la sécurité ou des règles de tiers. La date et la version applicables sont affichées en tête du document.</p>
      <p>Lorsqu'une modification affecte de manière importante les droits ou obligations des utilisateurs disposant d'un compte, une information est fournie avant ou lors de son entrée en vigueur. Une nouvelle acceptation peut être demandée.</p>

      <h2>19. Droit applicable et différends</h2>
      <p>Les présentes CGU sont soumises au droit français, sous réserve des dispositions impératives plus protectrices éventuellement applicables au lieu de résidence de l'utilisateur.</p>
      <p>En cas de difficulté, l'utilisateur est invité à contacter d'abord <a href="mailto:[CONTACT_EMAIL]">[CONTACT_EMAIL]</a> afin de rechercher une solution amiable.</p>
    `
  }),

  "regles-communautaires": legalDocument({
    id: "regles-communautaires",
    title: "Règles communautaires",
    short: "Comportements attendus, sécurité, signalement et sanctions.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Principe général</h2>
      <p>[APP_NAME] doit rester un espace utile, sûr et accueillant. Chaque utilisateur doit respecter les autres, la loi, les CGU et les droits des titulaires de propriété intellectuelle.</p>

      <h2>2. Comportements attendus</h2>
      <ul>
        <li>utiliser un pseudonyme et un avatar appropriés ;</li>
        <li>respecter les choix de confidentialité des autres utilisateurs ;</li>
        <li>décrire honnêtement sa collection ;</li>
        <li>signaler un problème de bonne foi, avec des éléments utiles ;</li>
        <li>protéger ses accès et ne pas partager d'informations sensibles.</li>
      </ul>

      <h2>3. Contenus et comportements interdits</h2>
      <ul>
        <li>harcèlement, intimidation, menaces ou incitation à la violence ;</li>
        <li>propos haineux ou discriminatoires fondés notamment sur l'origine, la nationalité, la religion, le sexe, l'orientation sexuelle, l'identité de genre, le handicap ou l'âge ;</li>
        <li>contenu pornographique, sexuellement explicite ou présentant un danger pour les mineurs ;</li>
        <li>escroquerie, hameçonnage, fausse offre, demande de paiement ou vente de compte ;</li>
        <li>publication d'une adresse, d'un numéro de téléphone, d'un document d'identité ou d'une autre donnée personnelle appartenant à un tiers sans autorisation ;</li>
        <li>usurpation d'identité ou imitation trompeuse d'Epic Games, de Fortnite, de [APP_NAME] ou d'un membre de leur personnel ;</li>
        <li>promotion de logiciels de triche, de piratage, de contournement de sécurité ou de vol de compte ;</li>
        <li>spam, publicité répétitive ou extraction automatisée non autorisée ;</li>
        <li>contenu violant un droit d'auteur, une marque ou un autre droit de tiers ;</li>
        <li>signalement volontairement mensonger ou détournement des outils de modération.</li>
      </ul>

      <h2>4. Protection des mineurs</h2>
      <p>Les comptes sont réservés aux personnes âgées d'au moins [ACCOUNT_MINIMUM_AGE] ans. Aucun utilisateur ne doit solliciter d'un mineur une adresse, un numéro de téléphone, une photographie privée, une information financière ou une rencontre hors ligne.</p>

      <h2>5. Échanges hors de SPRITNEX</h2>
      <p>[APP_NAME] permet de suivre ou comparer des collections, mais ne sécurise, ne supervise et ne garantit aucun échange organisé entre utilisateurs en dehors du service.</p>
      <p>Ne transmettez jamais de mot de passe, de code d'authentification, de donnée bancaire ou d'accès à un compte Epic Games.</p>

      <h2>6. Signalement</h2>
      <p>Vous pouvez signaler un utilisateur ou un contenu par la fonction disponible dans l'application ou par e-mail à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>.</p>
      <p>Un signalement utile comporte, lorsque cela est possible, l'identifiant ou le pseudonyme concerné, une description précise, la date approximative, le lien ou l'écran concerné et des captures pertinentes.</p>

      <h2>7. Mesures de modération</h2>
      <p>Selon la gravité, la répétition, le contexte et les preuves disponibles, les mesures suivantes peuvent être appliquées :</p>
      <ul>
        <li>aucune mesure lorsque le signalement n'est pas fondé ;</li>
        <li>rappel des règles ou avertissement ;</li>
        <li>retrait d'un contenu ou d'un avatar ;</li>
        <li>révocation d'un lien de partage ou limitation d'une fonction ;</li>
        <li>suspension temporaire ;</li>
        <li>suppression définitive du compte ;</li>
        <li>signalement aux autorités compétentes lorsque la loi ou la sécurité l'exige.</li>
      </ul>

      <h2>8. Contestation</h2>
      <p>Une décision de modération peut être contestée à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. La demande doit indiquer le compte concerné, la décision contestée et les raisons de la contestation.</p>
      <p>La contestation est examinée dans un délai raisonnable, sans garantie de rétablissement lorsque la mesure est justifiée par la loi, la sécurité ou une violation des règles.</p>
    `
  }),

  "cookies": legalDocument({
    id: "cookies",
    title: "Cookies et autres traceurs",
    short: "Traceurs nécessaires, consentement, durées et gestion des choix.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Définition</h2>
      <p>Un cookie ou autre traceur est une technologie permettant de lire ou d'enregistrer des informations sur un navigateur, un appareil ou une application. Il peut s'agir notamment d'un cookie HTTP, d'un stockage local, d'un identifiant de session, d'un SDK ou d'un jeton de notification.</p>

      <h2>2. Traceurs strictement nécessaires</h2>
      <p>Les traceurs strictement nécessaires permettent de fournir une fonction expressément demandée ou d'assurer le fonctionnement et la sécurité du service. Ils ne sont pas utilisés à des fins publicitaires.</p>
      <div class="legal-table-wrapper">
        <table class="legal-table">
          <thead><tr><th>Catégorie</th><th>Finalité</th><th>Durée indicative</th></tr></thead>
          <tbody>
            <tr><td>Session et authentification</td><td>Maintenir la connexion, sécuriser le compte et prévenir les accès non autorisés</td><td>Jusqu'à expiration, déconnexion ou révocation</td></tr>
            <tr><td>Protection technique</td><td>Prévenir les attaques, limiter les abus et garantir l'intégrité des requêtes</td><td>Durée strictement nécessaire à la sécurité</td></tr>
            <tr><td>Préférences essentielles</td><td>Mémoriser la langue, l'affichage ou une préférence demandée</td><td>Jusqu'à modification ou suppression par l'utilisateur</td></tr>
            <tr><td>Collection locale</td><td>Conserver localement une progression lorsque cette fonction est utilisée</td><td>Jusqu'à suppression des données locales ou du stockage de l'application</td></tr>
            <tr><td>Choix relatifs aux traceurs</td><td>Mémoriser l'acceptation ou le refus afin de ne pas redemander le choix à chaque visite</td><td>[CONSENT_CHOICE_RETENTION]</td></tr>
          </tbody>
        </table>
      </div>

      <h2>3. Traceurs facultatifs</h2>
      <p>Les traceurs facultatifs sont désactivés tant que l'utilisateur ne les a pas acceptés par un acte positif clair. Ils peuvent, s'ils sont effectivement intégrés, servir à mesurer l'audience, diagnostiquer les performances ou analyser les erreurs.</p>
      <p>Aucun traceur publicitaire ou de profilage commercial n'est prévu dans la présente version de [APP_NAME]. Si un nouvel outil ou une nouvelle finalité est ajouté, la présente page et l'interface de consentement sont mises à jour avant son activation.</p>

      <h2>4. Choix de l'utilisateur</h2>
      <p>Lorsqu'un consentement est requis, l'interface doit permettre :</p>
      <ul>
        <li>d'accepter tous les traceurs facultatifs ;</li>
        <li>de les refuser aussi facilement que de les accepter ;</li>
        <li>de choisir les finalités séparément lorsque cela est pertinent ;</li>
        <li>de poursuivre l'utilisation des fonctions principales après un refus ;</li>
        <li>de modifier ou retirer son consentement à tout moment depuis un accès clairement identifiable.</li>
      </ul>
      <p>La fermeture de la bannière, l'inaction ou la simple poursuite de la navigation ne valent pas consentement.</p>

      <h2>5. Durées</h2>
      <p>Le choix d'acceptation ou de refus est en principe mémorisé pendant [CONSENT_CHOICE_RETENTION]. Un nouveau choix peut être demandé plus tôt si les finalités ou les prestataires changent de manière importante.</p>
      <p>Lorsqu'un traceur facultatif de mesure d'audience est utilisé, sa durée de vie est limitée à [OPTIONAL_TRACKER_RETENTION] et ne doit pas être automatiquement prolongée à chaque nouvelle visite lorsque cette règle est applicable.</p>

      <h2>6. Paramètres du navigateur et de l'appareil</h2>
      <p>Le navigateur ou le système d'exploitation permet généralement d'effacer les cookies, le stockage local, les données de l'application et les autorisations de notification. La suppression des traceurs nécessaires peut entraîner une déconnexion ou la perte de préférences conservées uniquement sur l'appareil.</p>

      <h2>7. Mise à jour de la liste</h2>
      <p>La liste exacte des outils tiers doit correspondre aux technologies réellement chargées par la version déployée de [APP_NAME]. En cas d'ajout d'un outil d'analyse, de crash reporting ou de publicité, son nom, sa finalité, son fournisseur et sa durée sont indiqués ici avant son activation.</p>
    `
  }),

  "donnees-personnelles": legalDocument({
    id: "donnees-personnelles",
    title: "Gérer mes données",
    short: "Accès, export, correction, confidentialité et suppression.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Consulter et corriger mes informations</h2>
      <p>Les informations modifiables, telles que le pseudonyme, l'avatar et les paramètres de visibilité, peuvent être corrigées depuis les paramètres du compte lorsqu'une fonction correspondante est disponible.</p>
      <p>Pour une information qui ne peut pas être modifiée directement, contactez <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>

      <h2>2. Exporter mes données</h2>
      <p>Vous pouvez demander une copie des données associées à votre compte dans un format structuré couramment utilisé, notamment JSON, depuis la fonction d'export lorsqu'elle est disponible ou par e-mail à <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <p>L'export peut inclure le profil, les réglages, la collection, les escouades, les liens de partage et les consentements enregistrés, sous réserve des droits et données appartenant à des tiers.</p>

      <h2>3. Gérer la visibilité</h2>
      <p>Vous pouvez choisir le niveau de visibilité proposé par [APP_NAME], quitter une escouade, révoquer un lien de partage ou rendre votre profil privé depuis les paramètres correspondants.</p>
      <p>La révocation d'un lien empêche les nouveaux accès par ce lien, mais ne permet pas d'effacer les copies ou captures déjà réalisées par un tiers.</p>

      <h2>4. Gérer les consentements</h2>
      <p>Les notifications peuvent être désactivées dans [APP_NAME] et dans les réglages de l'appareil. Les choix relatifs aux traceurs facultatifs peuvent être modifiés depuis l'outil de gestion des cookies ou traceurs.</p>

      <h2>5. Supprimer certaines données</h2>
      <p>Selon les fonctions disponibles, vous pouvez effacer une collection locale, retirer un avatar, quitter une escouade, supprimer un lien de partage ou réinitialiser certaines préférences sans supprimer le compte entier.</p>

      <h2>6. Supprimer le compte</h2>
      <p>La suppression du compte peut être demandée depuis <em>Paramètres → Mon compte → Supprimer mon compte</em> ou par e-mail à <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <p>Après vérification de la demande, les données du compte sont supprimées des systèmes actifs dans un délai de [ACCOUNT_DELETION_DELAY], sauf lorsqu'une conservation limitée est nécessaire pour respecter une obligation légale, protéger le service ou traiter un litige.</p>

      <h2>7. Exercer un autre droit RGPD</h2>
      <p>Pour exercer un droit d'accès, de rectification, d'effacement, de limitation, d'opposition ou de portabilité, contactez <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <p>Indiquez l'adresse e-mail du compte et la demande concernée. Ne joignez pas spontanément une copie de pièce d'identité ; elle ne sera demandée qu'en cas de doute raisonnable.</p>
    `
  }),

  "suppression-compte": legalDocument({
    id: "suppression-compte",
    title: "Supprimer mon compte",
    short: "Procédure, conséquences et délais de suppression.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Demander la suppression</h2>
      <p>Vous pouvez demander la suppression définitive de votre compte :</p>
      <ul>
        <li>depuis <em>Paramètres → Mon compte → Supprimer mon compte</em>, lorsque cette fonction est disponible ;</li>
        <li>ou par e-mail à <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>, depuis l'adresse associée au compte.</li>
      </ul>

      <h2>2. Vérification</h2>
      <p>Afin d'éviter une suppression frauduleuse, une confirmation peut être demandée, par exemple au moyen d'un lien envoyé par e-mail, d'une nouvelle authentification ou de la saisie du mot « SUPPRIMER ».</p>

      <h2>3. Conséquences</h2>
      <p>La suppression entraîne notamment, selon les données existantes :</p>
      <ul>
        <li>la suppression du profil et de l'identifiant public ;</li>
        <li>la suppression de la collection synchronisée ;</li>
        <li>le retrait des escouades et invitations ;</li>
        <li>la révocation des liens de partage ;</li>
        <li>la suppression des préférences de notification ;</li>
        <li>la fin de l'accès aux fonctions liées au compte.</li>
      </ul>
      <p>Cette opération est irréversible après son exécution. Exportez vos données avant de confirmer la suppression si vous souhaitez en conserver une copie.</p>

      <h2>4. Délai</h2>
      <p>Les données sont supprimées des systèmes actifs dans un délai de [ACCOUNT_DELETION_DELAY] après validation de la demande.</p>

      <h2>5. Données pouvant être conservées</h2>
      <p>Des informations limitées peuvent être conservées plus longtemps lorsqu'elles sont nécessaires :</p>
      <ul>
        <li>au respect d'une obligation légale ;</li>
        <li>à la constatation, l'exercice ou la défense d'un droit en justice ;</li>
        <li>à la sécurité du service et à la prévention d'abus graves ;</li>
        <li>au traitement d'un signalement ou d'un incident encore ouvert.</li>
      </ul>
      <p>Les données conservées à ces seules fins sont isolées ou limitées et ne sont pas utilisées pour fournir le service courant.</p>

      <h2>6. Comptes de fournisseurs tiers</h2>
      <p>La suppression du compte [APP_NAME] ne supprime pas votre compte Google, Apple, Discord ou Epic Games. Vous devez gérer ces comptes directement auprès de leur fournisseur.</p>
    `
  }),

  "contact": legalDocument({
    id: "contact",
    title: "Contacter SPRITNEX",
    short: "Support, données personnelles, signalements et sécurité.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Support général</h2>
      <p>Pour une question relative à l'utilisation de [APP_NAME], un problème de compte ou un dysfonctionnement : <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a>.</p>

      <h2>2. Données personnelles</h2>
      <p>Pour exercer un droit RGPD ou poser une question sur vos données : <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>

      <h2>3. Signalement</h2>
      <p>Pour signaler un contenu, un pseudonyme, un avatar ou un comportement : <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>.</p>

      <h2>4. Incident de sécurité</h2>
      <p>Pour signaler une vulnérabilité ou une compromission présumée, écrivez à <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a> en indiquant « Sécurité » dans l'objet.</p>
      <p>Ne publiez pas publiquement une vulnérabilité avant qu'une correction raisonnable ait pu être étudiée. N'accédez pas aux données d'autres utilisateurs et ne perturbez pas le service lors de vos vérifications.</p>

      <h2>5. Informations utiles</h2>
      <p>Pour faciliter le traitement, indiquez si possible :</p>
      <ul>
        <li>l'adresse e-mail ou le pseudonyme du compte concerné ;</li>
        <li>la fonction ou l'écran concerné ;</li>
        <li>la date et l'heure approximatives ;</li>
        <li>une description précise du problème ;</li>
        <li>une capture d'écran expurgée de toute donnée sensible.</li>
      </ul>

      <h2>6. Délais indicatifs</h2>
      <p>Les demandes sont traitées dans un délai raisonnable selon leur urgence et leur complexité. Les demandes relatives aux droits RGPD reçoivent une réponse dans les délais prévus par la réglementation, en principe un mois.</p>
    `
  }),

  "signalement": legalDocument({
    id: "signalement",
    title: "Signaler un contenu ou un utilisateur",
    short: "Informations à fournir, traitement et contestation.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Ce qui peut être signalé</h2>
      <p>Vous pouvez notamment signaler :</p>
      <ul>
        <li>un pseudonyme ou un avatar illicite ou offensant ;</li>
        <li>du harcèlement, une menace ou un comportement discriminatoire ;</li>
        <li>une usurpation d'identité ;</li>
        <li>une tentative d'escroquerie ou de vol de compte ;</li>
        <li>la divulgation non autorisée de données personnelles ;</li>
        <li>un contenu portant atteinte à un droit d'auteur ou à une marque ;</li>
        <li>une promotion de triche, de piratage ou de logiciel malveillant ;</li>
        <li>tout contenu manifestement illicite.</li>
      </ul>

      <h2>2. Comment signaler</h2>
      <p>Utilisez le bouton de signalement lorsqu'il est disponible ou écrivez à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>.</p>
      <p>Le signalement doit comporter, dans la mesure du possible :</p>
      <ul>
        <li>vos coordonnées de contact, sauf si vous souhaitez rester anonyme ;</li>
        <li>le pseudonyme ou l'identifiant du compte concerné ;</li>
        <li>l'emplacement précis du contenu, notamment un lien ou un écran ;</li>
        <li>une description des faits et leur date approximative ;</li>
        <li>les raisons pour lesquelles le contenu paraît contraire à la loi ou aux règles ;</li>
        <li>des captures ou éléments de preuve pertinents.</li>
      </ul>
      <p>N'envoyez pas de document d'identité, de mot de passe, de code de connexion ou de donnée bancaire.</p>

      <h2>3. Examen du signalement</h2>
      <p>Le signalement est examiné selon sa gravité, son contexte et les éléments disponibles. Des informations supplémentaires peuvent être demandées lorsque cela est nécessaire.</p>
      <p>L'éditeur peut conserver les éléments du signalement pendant la durée nécessaire à son traitement, à la sécurité et à la défense de ses droits.</p>

      <h2>4. Mesures possibles</h2>
      <p>Selon le résultat de l'examen, aucune mesure, un avertissement, un retrait, une restriction, une suspension ou une suppression de compte peut être décidé. Une transmission aux autorités compétentes peut intervenir lorsqu'elle est requise ou justifiée.</p>

      <h2>5. Information des parties</h2>
      <p>Lorsque cela est possible et approprié, l'auteur du signalement reçoit une confirmation de prise en compte. L'utilisateur visé peut être informé de la mesure et de son motif, sauf lorsque cette information compromettrait une enquête, la sécurité d'une personne ou une obligation légale.</p>

      <h2>6. Contestation</h2>
      <p>Une décision de modération peut être contestée par e-mail à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. La contestation doit identifier la décision et exposer les éléments nouveaux ou les raisons de sa remise en cause.</p>

      <h2>7. Signalements abusifs</h2>
      <p>L'envoi répété de signalements manifestement infondés, trompeurs ou destinés à harceler une personne peut entraîner une limitation de la fonction de signalement ou une mesure sur le compte concerné.</p>
    `
  }),

  "licences": legalDocument({
    id: "licences",
    title: "Licences, crédits et propriété intellectuelle",
    short: "Avertissement Epic Games, créations SPRITNEX et composants tiers.",
    content: `
      <p class="legal-meta"><strong>Dernière mise à jour :</strong> [LEGAL_LAST_UPDATED_FR] — version [LEGAL_VERSION]</p>

      <h2>1. Application de fan non officielle</h2>
      <p>[APP_NAME] est une application personnelle de fan, gratuite, non commerciale et accessible au public. Elle n'est ni affiliée à Epic Games, ni sponsorisée, approuvée ou endossée par Epic Games.</p>
      <blockquote class="epic-disclaimer"><p>[EPIC_DISCLAIMER]</p></blockquote>

      <h2>2. Éléments appartenant à Epic Games</h2>
      <p>Fortnite, Epic Games, leurs noms, marques, logos, personnages, objets, illustrations, sons et autres éléments protégés appartiennent à Epic Games, Inc. ou à leurs titulaires respectifs.</p>
      <p>Leur présence dans [APP_NAME] a uniquement pour objet d'identifier, commenter ou référencer le contenu concerné dans le cadre d'un service de fan non officiel.</p>

      <h2>3. Respect de la politique de contenu de fan</h2>
      <p>[APP_NAME] est conçu pour respecter la politique de contenu de fan d'Epic Games, notamment en restant gratuit et non commercial, en n'indiquant aucune approbation officielle et en affichant l'avertissement demandé sur les pages concernées.</p>
      <p>Epic Games peut modifier sa politique ou retirer l'autorisation relative au contenu de fan. [APP_NAME] peut donc modifier ou retirer des contenus afin de rester conforme.</p>
      <p>La politique peut être consultée ici : <a href="[EPIC_FAN_POLICY_URL]" target="_blank" rel="noopener noreferrer">Politique relative au contenu de fan d'Epic Games</a>.</p>

      <h2>4. Absence de monétisation autorisée par défaut</h2>
      <p>La politique de contenu de fan d'Epic Games encadre les sites et applications de fan comme des créations personnelles, gratuites et non commerciales. Aucune publicité, vente, abonnement, contenu payant ou autre monétisation ne doit être ajouté sur la base de ce seul document sans vérification préalable et autorisation appropriée lorsque celle-ci est nécessaire.</p>

      <h2>5. Créations propres à SPRITNEX</h2>
      <p>Les éléments originaux créés spécifiquement pour [APP_NAME], notamment son code, son architecture, ses textes, sa mise en page, ses composants d'interface et son logo distinct des marques d'Epic Games, restent protégés par les droits de leur auteur.</p>
      <p>Cette protection ne s'étend pas aux éléments, noms, illustrations ou marques appartenant à Epic Games ou à d'autres tiers.</p>

      <h2>6. Composants et licences tierces</h2>
      <p>Selon la version effectivement déployée, [APP_NAME] peut utiliser notamment :</p>
      <ul>
        <li><strong>Inter</strong> et <strong>Rajdhani</strong>, distribuées sous licence SIL Open Font License lorsque ces polices sont utilisées ;</li>
        <li><strong>Lucide</strong>, bibliothèque d'icônes distribuée sous licence ISC lorsque celle-ci est utilisée ;</li>
        <li><strong>Node.js</strong>, <strong>Express</strong>, <strong>PostgreSQL</strong>, <strong>WebSocket</strong> et <strong>Capacitor</strong>, selon les licences propres à chaque projet ;</li>
        <li>d'autres bibliothèques open source listées dans le fichier de dépendances et les avis de licence inclus dans le projet.</li>
      </ul>
      <p>La liste des crédits doit être mise à jour lorsque les composants réellement utilisés changent.</p>

      <h2>7. Contenus fournis par les utilisateurs</h2>
      <p>Chaque utilisateur reste responsable des droits relatifs à son pseudonyme, son avatar et tout contenu qu'il transmet. Aucun contenu appartenant à un tiers ne doit être utilisé sans autorisation ou fondement légal.</p>

      <h2>8. Demande d'un titulaire de droits</h2>
      <p>Un titulaire de droits peut signaler un contenu potentiellement contrefaisant à <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a> en précisant le contenu concerné, son emplacement et les éléments permettant d'établir ses droits.</p>
    `
  })
});

const LEGAL_MENU = Object.freeze([
  Object.freeze({ docId: "mentions-legales" }),
  Object.freeze({ docId: "politique-confidentialite" }),
  Object.freeze({ docId: "cgu" }),
  Object.freeze({ docId: "regles-communautaires" }),
  Object.freeze({ docId: "cookies" }),
  Object.freeze({ docId: "donnees-personnelles" }),
  Object.freeze({ docId: "suppression-compte" }),
  Object.freeze({ docId: "contact" }),
  Object.freeze({ docId: "signalement" }),
  Object.freeze({ docId: "licences" })
]);

const LEGAL_FOOTER = Object.freeze({
  version: LEGAL_VERSION,
  lastUpdated: LEGAL_LAST_UPDATED_ISO,
  epicDisclaimer: EPIC_DISCLAIMER,
  epicPolicyUrl: LEGAL_CONFIG.EPIC_FAN_POLICY_URL,
  links: LEGAL_MENU
});

function getLegalDocument(docId) {
  return LEGAL_DOCUMENTS[docId] || null;
}

function validateLegalDocuments() {
  const errors = [];
  const menuIds = new Set();

  for (const item of LEGAL_MENU) {
    if (menuIds.has(item.docId)) {
      errors.push(`Document dupliqué dans LEGAL_MENU : ${item.docId}`);
    }
    menuIds.add(item.docId);

    if (!LEGAL_DOCUMENTS[item.docId]) {
      errors.push(`Document absent de LEGAL_DOCUMENTS : ${item.docId}`);
    }
  }

  for (const [key, document] of Object.entries(LEGAL_DOCUMENTS)) {
    if (key !== document.id) {
      errors.push(`Identifiant incohérent : clé ${key}, id ${document.id}`);
    }

    if (!document.title || !document.content) {
      errors.push(`Document incomplet : ${key}`);
    }

    if (/\[[A-Z0-9_]+\]/.test(document.content)) {
      errors.push(`Placeholder non remplacé dans : ${key}`);
    }
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors)
  });
}

const LEGAL_VALIDATION = validateLegalDocuments();

if (!LEGAL_VALIDATION.valid && typeof console !== "undefined") {
  console.error("Erreur de validation des documents juridiques SPRITNEX", {
    errors: LEGAL_VALIDATION.errors
  });
}

const SPRITEDEX_LEGAL = Object.freeze({
  LEGAL_CONFIG,
  LEGAL_VERSION,
  LEGAL_LAST_UPDATED_ISO,
  LEGAL_LAST_UPDATED_FR,
  EPIC_DISCLAIMER,
  LEGAL_DOCUMENTS,
  LEGAL_MENU,
  LEGAL_FOOTER,
  LEGAL_VALIDATION,
  getLegalDocument,
  validateLegalDocuments
});

if (typeof window !== "undefined") {
  window.SPRITNEXLegal = SPRITEDEX_LEGAL;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SPRITEDEX_LEGAL;
}
