"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
    contact: legalDocument({
      id: "contact",
      title: "Contacter SPRITE-INDEX",
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
    })
  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
