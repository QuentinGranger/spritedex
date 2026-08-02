"use strict";

(function registerFrenchLegalDocument(global) {
  if (!global.__SPRITE_INDEX_LEGAL_CORE__ && typeof module !== "undefined" && module.exports) {
    require("../core");
  }
  const { legalDocument } = global.__SPRITE_INDEX_LEGAL_CORE__;
  const chunk = Object.freeze({
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

  });
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ = global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__ || [];
  global.__SPRITE_INDEX_LEGAL_FR_CHUNKS__.push(chunk);
  if (typeof module !== "undefined" && module.exports) module.exports = chunk;
})(typeof window !== "undefined" ? window : globalThis);
