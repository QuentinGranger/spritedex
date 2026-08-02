"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
