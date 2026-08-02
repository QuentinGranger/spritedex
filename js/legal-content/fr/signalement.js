"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
