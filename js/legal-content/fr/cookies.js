"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
    cookies: legalDocument({
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
    })
  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
