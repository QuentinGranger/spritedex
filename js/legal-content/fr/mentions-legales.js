"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

      <h2>6. Propriété intellectuelle propre à SPRITE-INDEX</h2>
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
    })
  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
