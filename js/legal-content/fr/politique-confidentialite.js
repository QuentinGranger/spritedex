"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
