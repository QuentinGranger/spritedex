/* ── Legal & compliance content for SpriteDex (FR/EU) ─────────────────────────
 * This module centralises all legal texts displayed in the app and on the
 * public site. Texts are drafted for a non-commercial, free-to-use fan app
 * published by an individual without a SIREN/SIRET number.
 *
 * IMPORTANT: these documents are technical and editorial placeholders.
 * A lawyer specialised in digital law should review them before publication
 * or any monetisation. They do not constitute legal advice.
 */

const LEGAL_VERSION = "2026.07.17-1";

function loremReplacement(text) {
  return text
    .replace(/\[NOM_EDITEUR\]/g, "Quentin SAVIGNY")
    .replace(/\[ADRESSE\]/g, "38 rue Caulaincourt, 75018 Paris, France")
    .replace(/\[EMAIL\]/g, "quentin@tuatha-app.com")
    .replace(/\[APP_NAME\]/g, "SpriteDex")
    .replace(/\[HEBERGEUR\]/g, "Render Services, Inc., 525 Brannan Street, San Francisco, CA 94107, États-Unis — https://render.com")
    .replace(/\[BASE_JURIDIQUE\]/g, "non-professionnelle, application gratuite de fan");
}

const LEGAL_DOCUMENTS = {
  "mentions-legales": {
    id: "mentions-legales",
    title: "Mentions légales",
    short: "Édition, hébergement et responsable de la publication.",
    content: loremReplacement(`
      <p><strong>Édition</strong></p>
      <p>[APP_NAME] est un service en ligne gratuit, édité à titre [BASE_JURIDIQUE] par [NOM_EDITEUR], domicilié à [ADRESSE].</p>
      <p>En l'absence d'immatriculation au registre du commerce et des sociétés (SIREN/SIRET) et de numéro de TVA intracommunautaire, [NOM_EDITEUR] agit en qualité d'éditeur individuel non professionnel.</p>

      <p><strong>Responsable de la publication</strong></p>
      <p>[NOM_EDITEUR].</p>

      <p><strong>Contact</strong></p>
      <p>Par courriel : <a href="mailto:[EMAIL]">[EMAIL]</a></p>

      <p><strong>Hébergement</strong></p>
      <p>Le site et l'application sont hébergés par [HEBERGEUR].<br>
      La base de données est fournie par Render PostgreSQL (même hébergeur).</p>

      <p><strong>Propriété intellectuelle</strong></p>
      <p>Le nom, le logo et le code source de [APP_NAME], hors éléments visuels appartenant à Epic Games, sont la propriété de [NOM_EDITEUR].<br>
      Les illustrations, noms et marques liés à Fortnite restent la propriété exclusive d'Epic Games, Inc. [APP_NAME] est une application non officielle et n'est pas affiliée, approuvée ou sponsorisée par Epic Games.</p>
    `)
  },

  "politique-confidentialite": {
    id: "politique-confidentialite",
    title: "Politique de confidentialité",
    short: "RGPD — Données collectées, finalités et vos droits.",
    content: loremReplacement(`
      <p><strong>1. Responsable du traitement</strong></p>
      <p>Le responsable du traitement des données à caractère personnel est [NOM_EDITEUR]. Vous pouvez le contacter à l'adresse <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>

      <p><strong>2. Données collectées</strong></p>
      <p>Lors de l'utilisation de [APP_NAME], nous collectons et traitons les catégories de données suivantes :</p>
      <ul>
        <li><strong>Données d'identification et de contact :</strong> adresse e-mail, pseudonyme, identifiant unique transmis par Google ou Discord, avatar.</li>
        <li><strong>Données de jeu :</strong> liste des Sprites possédés, recherchés ou marqués prioritaires, escouades, paramètres de confidentialité.</li>
        <li><strong>Données techniques :</strong> adresse IP, journaux de connexion, jetons de session, jeton d'appareil pour les notifications, informations de base sur l'appareil et le navigateur.</li>
        <li><strong>Données d'analyse d'audience :</strong> interactions anonymisées avec l'application (pages consultées, actions principales) si vous y consentez via le gestionnaire de cookies/traceurs.</li>
        <li><strong>Données de sécurité :</strong> tentatives de connexion, tokens de vérification d'e-mail, tokens de réinitialisation de mot de passe.</li>
      </ul>

      <p><strong>3. Finalités et bases légales</strong></p>
      <table class="legal-table">
        <tr><th>Finalité</th><th>Base légale</th></tr>
        <tr><td>Création et gestion du compte utilisateur</td><td>Exécution du contrat (CGU) / consentement lors de l'inscription</td></tr>
        <tr><td>Sauvegarde et synchronisation de la collection</td><td>Exécution du contrat</td></tr>
        <tr><td>Authentification via Google ou Discord</td><td>Consentement (article 6.1.a RGPD) et intérêt légitime</td></tr>
        <tr><td>Notifications sur les nouveaux sprites et l'activité</td><td>Consentement, si activé</td></tr>
        <tr><td>Sécurité et prévention des fraudes</td><td>Intérêt légitime</td></tr>
        <tr><td>Mesures d'audience anonymisées</td><td>Consentement</td></tr>
      </table>

      <p><strong>4. Destinataires et partage</strong></p>
      <p>Vos données ne sont pas revendues. Elles peuvent être transmises à :</p>
      <ul>
        <li><strong>Render</strong> (hébergeur du serveur et de la base de données) en qualité de sous-traitant.</li>
        <li><strong>Google / Discord</strong> uniquement lors de l'authentification OAuth et dans la stricte mesure nécessaire.</li>
        <li><strong>Resend</strong> pour l'envoi d'e-mails transactionnels (vérification d'e-mail, réinitialisation).</li>
        <li>Les autres membres d'une escouade uniquement si vous avez choisi une visibilité autre que « privée ».</li>
      </ul>

      <p><strong>5. Hébergement et transferts</strong></p>
      <p>Les données sont hébergées par Render sur des infrastructures situées aux États-Unis. Render offre des garanties contractuelles conformes aux clauses contractuelles types de la Commission européenne pour les transferts internationaux de données.</p>

      <p><strong>6. Durées de conservation</strong></p>
      <table class="legal-table">
        <tr><th>Catégorie</th><th>Durée</th></tr>
        <tr><td>Données de compte actif</td><td>Tant que le compte existe</td></tr>
        <tr><td>Jetons de session</td><td>6 mois ou déconnexion</td></tr>
        <tr><td>Journaux de connexion</td><td>12 mois maximum</td></tr>
        <tr><td>E-mails de transaction</td><td>6 mois</td></tr>
        <tr><td>Comptes supprimés</td><td>30 jours maximum, sauf obligation légale</td></tr>
      </table>

      <p><strong>7. Vos droits (RGPD)</strong></p>
      <p>Conformément au Règlement général sur la protection des données, vous disposez des droits suivants :</p>
      <ul>
        <li><strong>Droit d'accès :</strong> obtenir une copie de vos données.</li>
        <li><strong>Droit de rectification :</strong> corriger vos informations.</li>
        <li><strong>Droit à l'effacement (« droit à l'oubli ») :</strong> demander la suppression de votre compte.</li>
        <li><strong>Droit à la portabilité :</strong> exporter vos données dans un format structuré (JSON).</li>
        <li><strong>Droit d'opposition :</strong> refuser certains traitements, notamment les traceurs.</li>
        <li><strong>Droit de limitation :</strong> restreindre temporairement le traitement.</li>
      </ul>
      <p>Pour exercer vos droits, contactez <a href="mailto:[EMAIL]">[EMAIL]</a>. Nous répondons dans un délai d'un mois maximum.</p>
      <p>Vous pouvez aussi déposer une réclamation auprès de la CNIL : <a href="https://www.cnil.fr" target="_blank" rel="noopener">www.cnil.fr</a>.</p>

      <p><strong>8. Mots de passe des fournisseurs tiers</strong></p>
      <p>[APP_NAME] ne stocke <strong>jamais</strong> les mots de passe Google, Apple ou Discord. Seuls les identifiants et jetons techniques nécessaires à l'authentification sont conservés.</p>
    `)
  },

  "cgu": {
    id: "cgu",
    title: "Conditions générales d'utilisation",
    short: "Règles d'accès et d'utilisation de SpriteDex.",
    content: loremReplacement(`
      <p><strong>1. Objet</strong></p>
      <p>Les présentes Conditions générales d'utilisation (CGU) définissent les règles d'accès et d'utilisation du service [APP_NAME], application web et mobile gratuite de suivi de collection de sprites Fortnite.</p>

      <p><strong>2. Création de compte et âge minimal</strong></p>
      <p>L'utilisation de certaines fonctions nécessite la création d'un compte. L'utilisateur déclare être âgé d'au moins 15 ans au moment de l'inscription. En dessous de 15 ans, l'inscription nécessite le consentement du titulaire de l'autorité parentale.</p>
      <p>Chaque compte est strictement personnel. L'utilisateur s'engage à fournir des informations exactes et à maintenir la confidentialité de ses identifiants.</p>

      <p><strong>3. Acceptation des CGU</strong></p>
      <p>Lors de l'inscription, l'utilisateur doit cocher une case indiquant : « J'accepte les Conditions générales d'utilisation ». La date, l'heure et la version acceptée sont conservées.</p>

      <p><strong>4. Utilisations interdites</strong></p>
      <p>Il est interdit de :</p>
      <ul>
        <li>usurper l'identité d'un tiers ;</li>
        <li>publier des contenus illicites, diffamatoires, haineux ou pornographiques ;</li>
        <li>harceler, menacer ou spamer d'autres utilisateurs ;</li>
        <li>tenter de perturber le fonctionnement technique du service ;</li>
        <li>extraire automatiquement des données sans autorisation ;</li>
        <li>utiliser [APP_NAME] à des fins commerciales sans autorisation.</li>
      </ul>

      <p><strong>5. Partage et comparaison de collections</strong></p>
      <p>Le partage de profil s'effectue via un lien opaque généré par l'utilisateur. Le propriétaire du compte peut révoquer ce lien à tout moment. Les profils respectent le réglage de confidentialité choisi : privé, visible par l'escouade, ou public.</p>

      <p><strong>6. Pseudonymes, avatars et contenus</strong></p>
      <p>Les pseudonymes et avatars ne doivent pas porter atteinte aux droits de tiers, ni contenir de propos injurieux, racistes ou discriminatoires. [APP_NAME] se réserve le droit de demander la modification ou de suspendre un compte en cas de non-respect.</p>

      <p><strong>7. Suspension et suppression de compte</strong></p>
      <p>[APP_NAME] peut suspendre ou supprimer un compte en cas de violation grave des CGU, sur notification ou après signalement. L'utilisateur peut supprimer son compte à tout moment depuis les paramètres.</p>

      <p><strong>8. Disponibilité du service</strong></p>
      <p>[APP_NAME] est fourni « en l'état » et « sous réserve de disponibilité ». L'éditeur s'efforce d'assurer la continuité du service mais ne garantit pas une disponibilité sans interruption.</p>

      <p><strong>9. Propriété intellectuelle</strong></p>
      <p>L'interface, le code et le logo de [APP_NAME] sont protégés. Les droits sur Fortnite et ses éléments graphiques appartiennent à Epic Games, Inc. [APP_NAME] est une application non officielle.</p>

      <p><strong>10. Signalement</strong></p>
      <p>Tout utilisateur peut signaler un contenu ou un comportement inapproprié à <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>

      <p><strong>11. Droit applicable et litiges</strong></p>
      <p>Les présentes CGU sont soumises au droit français. En cas de litige, les parties s'efforceront de trouver une solution amiable avant toute action judiciaire.</p>
    `)
  },

  "regles-communautaires": {
    id: "regles-communautaires",
    title: "Règles communautaires",
    short: "Comportements attendus et procédure de signalement.",
    content: loremReplacement(`
      <p><strong>1. Respect et bienveillance</strong></p>
      <p>[APP_NAME] encourage un environnement bienveillant. Les propos insultants, harcelants, discriminatoires ou menaçants sont strictement interdits.</p>

      <p><strong>2. Contenus autorisés</strong></p>
      <p>Vous pouvez partager votre progression, vos collections et interagir avec vos escouades. Les contenus publiés doivent respecter la législation française et européenne.</p>

      <p><strong>3. Contenus interdits</strong></p>
      <ul>
        <li>Contenus illicites, violents ou pornographiques.</li>
        <li>Messages de spam, publicité non sollicitée ou escroqueries.</li>
        <li>Informations personnelles d'autrui partagées sans consentement (doxing).</li>
        <li>Contenus portant atteinte à des marques ou droits d'auteur.</li>
      </ul>

      <p><strong>4. Signalement et modération</strong></p>
      <p>Les utilisateurs disposent d'un bouton de signalement. Chaque signalement est examiné manuellement. En cas de non-respect des règles, l'éditeur peut supprimer le contenu, avertir l'utilisateur ou suspendre son compte.</p>

      <p><strong>5. Contestation</strong></p>
      <p>Toute décision de modération peut être contestée par courriel à <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>
    `)
  },

  "cookies": {
    id: "cookies",
    title: "Confidentialité et traceurs",
    short: "Gérez les cookies et traceurs non indispensables.",
    content: loremReplacement(`
      <p><strong>1. Qu'est-ce qu'un traceur ?</strong></p>
      <p>Les traceurs (cookies, pixels, balises, SDK) sont des technologies permettant de stocker ou de lire des informations sur un appareil. Ils peuvent être nécessaires au fonctionnement du service ou facultatifs (mesure d'audience, personnalisation).</p>

      <p><strong>2. Traceurs strictement nécessaires</strong></p>
      <p>Ces traceurs sont indispensables au bon fonctionnement de [APP_NAME]. Ils ne nécessitent pas de consentement mais sont mentionnés ici :</p>
      <ul>
        <li>Jetons de session et d'authentification.</li>
        <li>Stockage local de la collection et des préférences.</li>
        <li>Jeton technique pour les notifications.</li>
      </ul>

      <p><strong>3. Traceurs facultatifs</strong></p>
      <p>Ces traceurs sont désactivés par défaut. Ils ne sont activés qu'avec votre consentement :</p>
      <ul>
        <li>Mesure d'audience anonymisée (pages visitées, actions principales).</li>
        <li>Statistiques de performance et de crashs (si un outil tiers est intégré ultérieurement).</li>
      </ul>

      <p><strong>4. Vos choix</strong></p>
      <p>Vous pouvez à tout moment :</p>
      <ul>
        <li>accepter tous les traceurs ;</li>
        <li>refuser les traceurs facultatifs ;</li>
        <li>personnaliser vos choix ;</li>
        <li>modifier vos choix depuis les paramètres.</li>
      </ul>
      <p>Refuser les traceurs facultatifs n'affecte pas les fonctions principales de [APP_NAME].</p>

      <p><strong>5. Durée de conservation</strong></p>
      <p>Les traceurs strictement nécessaires sont conservés pendant la durée de la session ou jusqu'à déconnexion. Les traceurs facultatifs sont conservés au maximum 13 mois.</p>
    `)
  },

  "donnees-personnelles": {
    id: "donnees-personnelles",
    title: "Gérer mes données",
    short: "Export, rectification et suppression de vos données.",
    content: loremReplacement(`
      <p><strong>1. Télécharger une copie de mes données</strong></p>
      <p>Vous pouvez exporter l'intégralité de vos données (profil, collection, préférences, historique) au format JSON depuis les paramètres de votre compte.</p>

      <p><strong>2. Corriger mon profil</strong></p>
      <p>Votre pseudonyme, avatar et paramètres de confidentialité peuvent être modifiés dans l'écran <em>Mon compte</em>.</p>

      <p><strong>3. Gérer les consentements</strong></p>
      <p>Le gestionnaire de cookies/traceurs permet de modifier à tout moment vos choix relatifs aux traceurs facultatifs.</p>

      <p><strong>4. Supprimer certaines données</strong></p>
      <p>Vous pouvez supprimer votre collection locale, désactiver les notifications ou révoquer un lien de partage sans supprimer votre compte.</p>

      <p><strong>5. Supprimer mon compte</strong></p>
      <p>La suppression définitive de votre compte est accessible dans les paramètres. Elle entraîne l'effacement de votre profil, de votre collection cloud, de vos escouades et de vos préférences, dans un délai de 30 jours maximum, sauf obligation légale de conservation.</p>

      <p><strong>6. Contact RGPD</strong></p>
      <p>Pour toute question relative à vos données, contactez <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>
    `)
  },

  "suppression-compte": {
    id: "suppression-compte",
    title: "Supprimer mon compte",
    short: "Droit à l'effacement de vos données personnelles.",
    content: loremReplacement(`
      <p>Vous disposez du droit de demander la suppression de votre compte et de vos données personnelles à tout moment.</p>

      <p><strong>Conséquences :</strong></p>
      <ul>
        <li>Suppression de votre profil utilisateur.</li>
        <li>Suppression de votre collection sauvegardée sur le cloud.</li>
        <li>Suppression de vos escouades et liens de partage.</li>
        <li>Suppression de vos préférences de notification.</li>
      </ul>

      <p><strong>Exceptions légales :</strong></p>
      <p>Certaines données peuvent être conservées de manière anonymisée ou pour répondre à une obligation légale (par exemple, journaux de sécurité) pendant une durée maximale de 12 mois après la suppression.</p>

      <p><strong>Comment supprimer mon compte ?</strong></p>
      <p>Rendez-vous dans <em>Paramètres → Mon compte → Supprimer mon compte</em>, ou contactez <a href="mailto:[EMAIL]">[EMAIL]</a> pour une suppression sur demande. Une confirmation par e-mail ou par saisie du mot « SUPPRIMER » est requise.</p>
    `)
  },

  "contact": {
    id: "contact",
    title: "Contacter le support",
    short: "Support utilisateur et questions RGPD.",
    content: loremReplacement(`
      <p><strong>Support général</strong></p>
      <p>Pour toute question sur l'utilisation de [APP_NAME] : <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>

      <p><strong>Questions sur les données personnelles (RGPD)</strong></p>
      <p>Pour exercer vos droits ou poser une question sur la protection des données : <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>

      <p><strong>Délai de réponse</strong></p>
      <p>Nous nous efforçons de répondre sous 48 heures pour le support technique et sous un mois maximum pour les demandes RGPD.</p>
    `)
  },

  "signalement": {
    id: "signalement",
    title: "Signaler un contenu ou un utilisateur",
    short: "Procédure de signalement de contenus illicites.",
    content: loremReplacement(`
      <p><strong>1. Signaler un contenu ou un comportement</strong></p>
      <p>Si vous constatez un contenu ou un comportement contraire aux règles communautaires (propos haineux, harcèlement, spam, contenu illicite, etc.), vous pouvez nous le signaler à <a href="mailto:[EMAIL]">[EMAIL]</a> en précisant :</p>
      <ul>
        <li>votre pseudonyme (facultatif) ;</li>
        <li>la description du fait signalé ;</li>
        <li>les liens, captures d'écran ou tout élément permettant l'identification.</li>
      </ul>

      <p><strong>2. Traitement</strong></p>
      <p>Chaque signalement est examiné dans les meilleurs délais. En cas de confirmation, l'éditeur peut supprimer le contenu, avertir l'utilisateur ou suspendre son compte.</p>

      <p><strong>3. Notification et contestation</strong></p>
      <p>L'utilisateur concerné est informé de la décision de modération et peut la contester à <a href="mailto:[EMAIL]">[EMAIL]</a>.</p>
    `)
  },

  "licences": {
    id: "licences",
    title: "Licences, crédits et propriété intellectuelle",
    short: "Crédits tiers et disclaimer Epic Games.",
    content: loremReplacement(`
      <p><strong>1. Application non officielle</strong></p>
      <p>[APP_NAME] est une application de fan, gratuite et non commerciale. Elle n'est pas affiliée, sponsorisée, approuvée ou endossée par Epic Games, Inc.</p>

      <p><strong>2. Propriété intellectuelle d'Epic Games</strong></p>
      <p>Les noms, logos, personnages, images, sons et autres éléments liés à Fortnite sont des marques et des œuvres protégées appartenant à Epic Games, Inc. Tous les droits sont réservés.</p>

      <p><strong>3. Utilisation conforme à la politique Fan Content d'Epic</strong></p>
      <p>[APP_NAME] respecte la politique Fan Content d'Epic Games : elle est accessible gratuitement, ne prétend pas être officielle, n'utilise pas les logos Fortnite ou Epic comme logos principaux et affiche le présent avertissement. Toute monétisation future nécessiterait une autorisation ou une licence appropriée.</p>

      <p><strong>4. Crédits tiers</strong></p>
      <ul>
        <li>Polices : Rajdhani et Inter (Google Fonts), sous licences Open Font License.</li>
        <li>Icones : Lucide (sous licence ISC, via sources SVG).</li>
        <li>Framework web : application développée en HTML, CSS et JavaScript vanilla.</li>
        <li>Backend : Node.js, Express, PostgreSQL, WebSocket.</li>
        <li>Shell natif : Capacitor.</li>
      </ul>

      <p><strong>5. Distinction des créations</strong></p>
      <p>Les créations originales de [APP_NAME] (interface, code source, logo SpriteDex) sont distinctes des illustrations et marques appartenant à Epic Games.</p>
    `)
  }
};

const LEGAL_MENU = [
  { docId: "mentions-legales" },
  { docId: "politique-confidentialite" },
  { docId: "cgu" },
  { docId: "regles-communautaires" },
  { docId: "cookies" },
  { docId: "donnees-personnelles" },
  { docId: "suppression-compte" },
  { docId: "contact" },
  { docId: "signalement" },
  { docId: "licences" }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LEGAL_DOCUMENTS, LEGAL_MENU, LEGAL_VERSION };
}
