"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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
    })
  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
