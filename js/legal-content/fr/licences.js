"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
    licences: legalDocument({
      id: "licences",
      title: "Licences, crédits et propriété intellectuelle",
      short: "Avertissement Epic Games, créations SPRITE-INDEX et composants tiers.",
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

      <h2>5. Créations propres à SPRITE-INDEX</h2>
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
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
