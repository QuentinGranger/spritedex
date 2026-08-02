"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

      <h2>5. Échanges hors de SPRITE-INDEX</h2>
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

  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
