"use strict";

/**
 * Nederlandse juridische documenten voor SPRITE-INDEX.
 * De placeholders worden ingevuld door js/legal-content.js.
 */

const LEGAL_DOCUMENTS_NL = Object.freeze({
  "mentions-legales": Object.freeze({
    title: "Juridische kennisgeving",
    short: "Uitgever, hosting, intellectuele eigendom en verklaring over Epic Games.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Uitgever van de dienst</h2>
      <p><strong>[APP_NAME]</strong> is een gratis online dienst die op niet-professionele basis door een natuurlijk persoon wordt uitgegeven, onder verantwoordelijkheid van <strong>[EDITOR_NAME]</strong>.</p>
      <p>De uitgever handelt als <strong>[EDITOR_STATUS]</strong>, zonder zakelijke inschrijving of btw-nummer voor deze activiteit. Om het privéadres te beschermen, wordt dat adres niet gepubliceerd; de vereiste identificatiegegevens zijn aan de host verstrekt.</p>
      <h2>2. Verantwoordelijke voor publicatie</h2>
      <p>De verantwoordelijke voor de publicatie is <strong>[EDITOR_NAME]</strong>.</p>
      <h2>3. Contact</h2>
      <p>Voor vragen over de dienst: <a href="mailto:[CONTACT_EMAIL]">[CONTACT_EMAIL]</a>.</p>
      <h2>4. Hosting</h2>
      <address><strong>[HOST_NAME]</strong><br>[HOST_ADDRESS]<br>Telefoon: <a href="tel:+14158815869">[HOST_PHONE]</a><br>Website: <a href="[HOST_WEBSITE]" target="_blank" rel="noopener noreferrer">[HOST_WEBSITE]</a><br>Ondersteuning: <a href="[HOST_SUPPORT]" target="_blank" rel="noopener noreferrer">[HOST_SUPPORT]</a><br>Juridisch contact: <a href="mailto:[HOST_LEGAL_EMAIL]">[HOST_LEGAL_EMAIL]</a></address>
      <p>De applicatieserver en database van [APP_NAME] worden gehost met diensten van Render.</p>
      <h2>5. Aard van de dienst</h2>
      <p>[APP_NAME] is een gratis fanapp waarmee je een met Fortnite verbonden Sprite-collectie kunt catalogiseren, bezeten of gezochte items kunt volgen en, afhankelijk van je instellingen, collecties met andere gebruikers kunt vergelijken. De dienst verkoopt geen Sprites, Fortnite-items, spelaccounts of digitale inhoud en bemiddelt niet bij betalingen of transacties.</p>
      <h2>6. Intellectuele eigendom van SPRITE-INDEX</h2>
      <p>Met uitzondering van onderdelen van derden zijn de structuur, broncode, originele interface, juridische teksten, vormgeving en het eigen logo van de app beschermd door intellectuele-eigendomsrechten. Ongeoorloofde reproductie of exploitatie is verboden, tenzij de wet dit toestaat of de uitgever vooraf schriftelijk toestemming geeft.</p>
      <h2>7. Fortnite en Epic Games</h2>
      <p>Fortnite, Epic Games en hun merken, personages, items, illustraties, geluiden en andere beschermde onderdelen behoren toe aan Epic Games, Inc. of hun respectieve rechthebbenden. [APP_NAME] is een onafhankelijke fancreatie en is niet verbonden aan, gesponsord, goedgekeurd of onderschreven door Epic Games.</p>
      <blockquote class="epic-disclaimer"><p>[EPIC_DISCLAIMER]</p></blockquote>
      <p>Het officiële beleid voor fancontent is te raadplegen op <a href="[EPIC_FAN_POLICY_URL]" target="_blank" rel="noopener noreferrer">de juridische website van Epic Games</a>.</p>
      <h2>8. Aansprakelijkheid</h2>
      <p>De uitgever streeft naar correcte en actuele informatie, maar kan niet garanderen dat er nooit fouten zijn, met name wanneer namen, varianten of beelden na een Fortnite-update wijzigen. Externe links zijn uitsluitend informatief; de uitgever heeft geen controle over hun inhoud of beschikbaarheid.</p>
    `
  }),
  "politique-confidentialite": Object.freeze({
    title: "Privacybeleid",
    short: "Verwerkte gegevens, rechtsgronden, ontvangers, bewaring en AVG-rechten.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Verwerkingsverantwoordelijke</h2>
      <p>De verwerkingsverantwoordelijke voor persoonsgegevens die via [APP_NAME] worden gebruikt is <strong>[EDITOR_NAME]</strong>. Voor privacyvragen: <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>. Er is geen functionaris voor gegevensbescherming aangewezen, omdat dat gezien de huidige aard en schaal van de dienst niet verplicht is.</p>
      <h2>2. Toepassingsgebied</h2>
      <p>Dit beleid beschrijft de verwerking wanneer je de site bezoekt, de app gebruikt, een account maakt, je collectie beheert, een squad betreedt, een profiel deelt, meldingen activeert of contact opneemt met support.</p>
      <h2>3. Mogelijk verwerkte gegevens</h2>
      <ul><li><strong>Account en digitale identiteit:</strong> e-mailadres, gebruikersnaam, avatar, interne identificatie, aanmaakdatum en accountstatus.</li><li><strong>Inloggen via derden:</strong> technische identificatie van Google, Apple of Discord en profielinformatie die je toestaat te delen.</li><li><strong>Collectie en voorkeuren:</strong> bezeten, gezochte, favoriete of prioritaire Sprites, varianten, weergave- en meldingsvoorkeuren.</li><li><strong>Sociale functies:</strong> squads, uitnodigingen, deellinks, zichtbaarheid, geblokkeerde gebruikers en meldingen van misbruik.</li><li><strong>Technische en veiligheidsgegevens:</strong> IP-adres, browser- of apparaattype, besturingssysteem, verbindingsmomenten, sessiegegevens, technische logs, fouten en verdachte toegangsverzoeken.</li><li><strong>Meldingen en support:</strong> een technisch meldingstoken wanneer meldingen zijn geactiveerd, plus de inhoud van vrijwillig verzonden supportverzoeken en bijlagen.</li><li><strong>Toestemmingen:</strong> keuzes voor optionele trackers, meldingen en de geaccepteerde versie van de voorwaarden.</li></ul>
      <p>[APP_NAME] vraagt niet om bijzondere persoonsgegevens. Deel geen gezondheidsgegevens, officiële identiteitsgegevens, bankgegevens of andere gevoelige informatie in vrije velden of supportverzoeken.</p>
      <h2>4. Doeleinden en rechtsgronden</h2>
      <p>Wij verwerken gegevens om een account te maken en beheren, je te authenticeren, de collectie op te slaan en te synchroniseren, squads, uitnodigingen en vergelijkingen mogelijk te maken, noodzakelijke e-mails te sturen, optionele meldingen te leveren, misbruik te voorkomen, support en rapporten te behandelen en te voldoen aan wettelijke verplichtingen. De rechtsgrond is, afhankelijk van het doel, de uitvoering van de voorwaarden, jouw toestemming, een gerechtvaardigd belang bij beveiliging en moderatie, of een wettelijke verplichting.</p>
      <h2>5. Verplicht of optioneel karakter</h2>
      <p>Gegevens die noodzakelijk zijn voor accountbeveiliging en kernfuncties zijn vereist wanneer je die functie wilt gebruiken. Andere gegevens, zoals een avatar, bepaalde profielgegevens of optionele meldingen, zijn facultatief. Het niet verstrekken van vereiste gegevens kan bepaalde functies onmogelijk maken.</p>
      <h2>6. Ontvangers en verwerkers</h2>
      <p>Gegevens zijn alleen toegankelijk voor de uitgever en dienstverleners die nodig zijn voor hosting, database, authenticatie, e-mail, meldingen of beveiliging, binnen de grenzen van hun opdracht. Gegevens kunnen worden verstrekt aan bevoegde autoriteiten wanneer de wet dat vereist.</p>
      <h2>7. Zichtbaarheid en delen van collecties</h2>
      <p>De zichtbaarheid van je profiel en collectie volgt de instellingen die je kiest. Deelbare links en sociale functies kunnen geselecteerde informatie zichtbaar maken voor ontvangers; deel daarom alleen wat je wilt tonen. Privénotities worden niet via zulke functies gedeeld.</p>
      <h2>8. Doorgiften buiten de Europese Economische Ruimte</h2>
      <p>Sommige dienstverleners kunnen gegevens buiten de EER verwerken. In dat geval gebeurt de doorgifte op basis van toepasselijke waarborgen, zoals een adequaatheidsbesluit of passende contractuele bepalingen.</p>
      <h2>9. Bewaartermijnen</h2>
      <p>Accountgegevens worden bewaard zolang het account actief is. Na een bevestigde verwijderingsaanvraag worden gegevens uit actieve systemen verwijderd binnen [ACCOUNT_DELETION_DELAY], behoudens noodzakelijke beperkte bewaring. Veiligheidslogs worden maximaal [SECURITY_LOG_RETENTION] bewaard. Keuzes voor trackers worden in beginsel [CONSENT_CHOICE_RETENTION] bewaard.</p>
      <h2>10. Beveiliging</h2>
      <p>Passende technische en organisatorische maatregelen beschermen gegevens tegen ongeoorloofde toegang, verlies, wijziging en openbaarmaking. Geen enkel systeem is volledig risicovrij; meld een vermoedelijk beveiligingsincident via <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a>.</p>
      <h2>11. Inloggen via een externe aanbieder</h2>
      <p>Wanneer je Google, Apple of Discord gebruikt, gelden ook de privacyvoorwaarden van die aanbieder. [APP_NAME] ontvangt alleen de gegevens die voor de gekozen aanmeldmethode worden verstrekt of toegestaan.</p>
      <h2>12. Jouw rechten</h2>
      <p>Je kunt verzoeken om inzage, correctie, verwijdering, beperking, bezwaar of overdraagbaarheid, en toestemming intrekken. Neem contact op via <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>. Je kunt ook een klacht indienen bij de bevoegde toezichthouder, in Frankrijk de CNIL.</p>
      <h2>13. Minderjarigen</h2>
      <p>Accounts zijn bedoeld voor personen van minimaal [ACCOUNT_MINIMUM_AGE] jaar. Minderjarigen moeten, waar wettelijk vereist, toestemming van een ouder of voogd hebben.</p>
      <h2>14. Geautomatiseerde besluitvorming</h2>
      <p>[APP_NAME] neemt geen besluiten die uitsluitend geautomatiseerd zijn en rechtsgevolgen of vergelijkbare aanzienlijke gevolgen voor je hebben.</p>
      <h2>15. Wijzigingen van dit beleid</h2>
      <p>Dit beleid kan worden aangepast wanneer de dienst of regelgeving verandert. De actuele versie en datum worden in de app gepubliceerd.</p>
    `
  }),
  cgu: Object.freeze({
    title: "Algemene gebruiksvoorwaarden",
    short: "Voorwaarden voor toegang, gebruik, accounts en moderatie.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Doel</h2><p>Deze voorwaarden regelen de toegang tot en het gebruik van [APP_NAME]. Door de dienst te gebruiken of een account te maken, accepteer je deze voorwaarden.</p>
      <h2>2. Onafhankelijke, niet-officiële dienst</h2><p>[APP_NAME] is een gratis, onafhankelijke fanapp en is niet verbonden aan, gesponsord, goedgekeurd of onderschreven door Epic Games.</p>
      <h2>3. Toegang en minimumleeftijd</h2><p>De dienst is bestemd voor personen van minstens [ACCOUNT_MINIMUM_AGE] jaar. Je moet de toepasselijke wet naleven en, indien nodig, toestemming van je wettelijke vertegenwoordiger hebben.</p>
      <h2>4. Account en beveiliging</h2><p>Je verstrekt correcte gegevens, houdt je inloggegevens vertrouwelijk en meldt ongeoorloofd gebruik snel. Je bent verantwoordelijk voor activiteiten via je account, voor zover de wet dat toestaat.</p>
      <h2>5. Acceptatie en bewijs</h2><p>De elektronische acceptatie van deze voorwaarden en relevante technische logs kunnen als bewijs van de overeenkomst dienen.</p>
      <h2>6. Beschikbare functies</h2><p>De dienst kan onder meer collecties, varianten, prioriteiten, geschiedenis, squads, uitnodigingen, vergelijkingen, paspoorten, deellinks en meldingen aanbieden. Functies kunnen worden aangepast of beperkt.</p>
      <h2>7. Gratis gebruik en geen transacties</h2><p>De dienst is gratis en voert geen verkoop, ruil, betaling of bemiddeling uit voor Fortnite-items, Sprites, spelaccounts of digitale inhoud.</p>
      <h2>8. Gebruiksregels</h2><p>Gebruik de dienst rechtmatig en te goeder trouw. Probeer geen beveiliging te omzeilen, de dienst te verstoren, gegevens van anderen te verzamelen, geautomatiseerd misbruik te plegen of onrechtmatige inhoud te verspreiden.</p>
      <h2>9. Gebruikersnamen, avatars en aangeleverde inhoud</h2><p>Je garandeert dat je de benodigde rechten hebt op wat je toevoegt. Beledigende, discriminerende, bedreigende, misleidende of inbreukmakende inhoud is verboden.</p>
      <h2>10. Collectie, squads en deellinks</h2><p>Jij kiest welke collectiegegevens zichtbaar of gedeeld zijn. Een deellink kan worden ingetrokken, maar eerder gemaakte kopieën of screenshots van derden kunnen niet altijd worden gewist.</p>
      <h2>11. Meldingen en moderatie</h2><p>Je kunt onrechtmatige of ongepaste inhoud melden via <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. De uitgever kan een waarschuwing, beperking, verwijdering, opschorting of verwijdering van een account toepassen.</p>
      <h2>12. Opschorting en verwijdering</h2><p>Een account kan tijdelijk of permanent worden beperkt wanneer deze voorwaarden, de wet of de veiligheid van de dienst dat rechtvaardigen. Je kunt zelf verwijdering aanvragen volgens de hiervoor beschikbare procedure.</p>
      <h2>13. Beschikbaarheid, onderhoud en back-ups</h2><p>De dienst kan tijdelijk niet beschikbaar zijn wegens onderhoud, beveiliging, storingen of wijzigingen. Maak zelf een kopie van gegevens die belangrijk voor je zijn.</p>
      <h2>14. Juistheid van informatie</h2><p>Catalogusgegevens zijn indicatief en kunnen veranderen. Controleer officiële bronnen voordat je belangrijke beslissingen neemt.</p>
      <h2>15. Intellectuele eigendom</h2><p>Respecteer de rechten van [APP_NAME], Epic Games en andere rechthebbenden. Niets in deze voorwaarden verleent een eigendomsrecht op inhoud van derden.</p>
      <h2>16. Beperking van aansprakelijkheid</h2><p>Voor zover de wet dit toestaat, is de uitgever niet aansprakelijk voor indirecte schade, verlies van gegevens of gevolgen van beschikbaarheidsproblemen of informatie van derden.</p>
      <h2>17. Persoonsgegevens</h2><p>De verwerking van persoonsgegevens wordt beschreven in het privacybeleid.</p>
      <h2>18. Wijzigingen van de voorwaarden</h2><p>De voorwaarden kunnen wijzigen. Bij wezenlijke wijzigingen kan een nieuwe acceptatie worden gevraagd; voortgezet gebruik na kennisgeving betekent acceptatie voor zover de wet dit toestaat.</p>
      <h2>19. Toepasselijk recht en geschillen</h2><p>Voor zover toegestaan is Frans recht van toepassing. Neem eerst contact op via <a href="mailto:[CONTACT_EMAIL]">[CONTACT_EMAIL]</a> om een geschil minnelijk op te lossen.</p>
    `
  }),
  "regles-communautaires": Object.freeze({
    title: "Communityregels",
    short: "Verwacht gedrag, verboden inhoud, meldingen en moderatie.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Algemeen beginsel</h2><p>Gebruik [APP_NAME] respectvol, veilig en eerlijk. De community is bedoeld voor het delen en volgen van collecties, niet voor handel, intimidatie of misbruik.</p>
      <h2>2. Verwacht gedrag</h2><p>Wees beleefd, respecteer privacy en toestemming, gebruik eerlijke informatie en help anderen zonder druk of misleiding.</p>
      <h2>3. Verboden inhoud en gedrag</h2><p>Het is verboden om onder meer haat, discriminatie, bedreigingen, intimidatie, identiteitsfraude, oplichting, spam, phishing, malware, valsspelen, hacking, seksuele inhoud met minderjarigen, ongeoorloofde persoonsgegevens of inbreukmakende inhoud te verspreiden.</p>
      <h2>4. Bescherming van minderjarigen</h2><p>Deel geen gevoelige persoonsgegevens, vraag er niet om en neem geen contact op met minderjarigen op een ongepaste of manipulerende manier. Meld ieder vermoeden van gevaar direct.</p>
      <h2>5. Uitwisselingen buiten SPRITE-INDEX</h2><p>De uitgever is geen partij bij gesprekken, ruilen of transacties buiten de dienst. Deel geen wachtwoorden, codes, betaalgegevens of accounttoegang en wees alert op fraude.</p>
      <h2>6. Melden</h2><p>Gebruik waar beschikbaar de meldknop of schrijf naar <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. Geef zo mogelijk de gebruiker, inhoud, datum, context en relevante bewijzen door.</p>
      <h2>7. Maatregelen bij moderatie</h2><p>Afhankelijk van ernst, context en bewijs kan de uitgever een waarschuwing, beperking, verwijdering van inhoud, tijdelijke opschorting of permanente accountverwijdering toepassen, en indien nodig bevoegde autoriteiten informeren.</p>
      <h2>8. Bezwaar</h2><p>Je kunt een moderatiebesluit betwisten via <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. Vermeld het betrokken account, besluit en de redenen voor je bezwaar.</p>
    `
  }),
  cookies: Object.freeze({
    title: "Cookies en andere trackers",
    short: "Noodzakelijke trackers, toestemming, bewaartermijnen en keuzes.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Definitie</h2><p>Een cookie of andere tracker leest of bewaart informatie op een browser, apparaat of app. Dit kan bijvoorbeeld een HTTP-cookie, lokale opslag, sessie-identificatie, SDK of meldingstoken zijn.</p>
      <h2>2. Strikt noodzakelijke trackers</h2><p>Noodzakelijke trackers leveren een uitdrukkelijk gevraagde functie of zorgen voor de werking en veiligheid van de dienst. Ze worden niet voor reclame gebruikt.</p>
      <div class="legal-table-wrapper"><table class="legal-table"><thead><tr><th>Categorie</th><th>Doel</th><th>Indicatieve duur</th></tr></thead><tbody><tr><td>Sessie en authenticatie</td><td>Inloggen behouden en het account beveiligen</td><td>Tot verval, uitloggen of intrekking</td></tr><tr><td>Technische bescherming</td><td>Aanvallen en misbruik voorkomen</td><td>Strikt noodzakelijk voor beveiliging</td></tr><tr><td>Essentiële voorkeuren</td><td>Taal- en weergavevoorkeuren onthouden</td><td>Tot wijziging of verwijdering</td></tr><tr><td>Lokale collectie</td><td>Lokale voortgang bewaren wanneer gebruikt</td><td>Tot lokale gegevens worden gewist</td></tr><tr><td>Trackerkeuzes</td><td>Acceptatie of weigering onthouden</td><td>[CONSENT_CHOICE_RETENTION]</td></tr></tbody></table></div>
      <h2>3. Optionele trackers</h2><p>Optionele trackers blijven uitgeschakeld totdat je ze met een duidelijke actieve keuze accepteert. Als ze worden toegevoegd, kunnen ze worden gebruikt voor publieksmeting, prestaties of foutdiagnose. In de huidige versie is geen advertentie- of commercieel profileringsmechanisme voorzien.</p>
      <h2>4. Keuzes van de gebruiker</h2><p>Wanneer toestemming nodig is, kun je optionele trackers net zo eenvoudig weigeren als accepteren, afzonderlijke doelen kiezen wanneer relevant en je toestemming op elk moment wijzigen of intrekken. Sluiten van een banner, inactiviteit of verder browsen is geen toestemming.</p>
      <h2>5. Bewaartermijnen</h2><p>De keuze voor acceptatie of weigering wordt in beginsel [CONSENT_CHOICE_RETENTION] bewaard. Een optionele tracker voor publieksmeting is, wanneer gebruikt, beperkt tot [OPTIONAL_TRACKER_RETENTION] en wordt niet automatisch bij elk bezoek verlengd wanneer die regel geldt.</p>
      <h2>6. Browser- en apparaatinstellingen</h2><p>Via browser of besturingssysteem kun je cookies, lokale opslag, appgegevens en meldingsrechten verwijderen. Het wissen van noodzakelijke trackers kan je uitloggen of lokale voorkeuren verwijderen.</p>
      <h2>7. Actuele lijst</h2><p>De lijst van externe hulpmiddelen moet overeenkomen met de technologieën die daadwerkelijk in de uitgerolde versie worden geladen. Bij toevoeging van analyse-, crashrapportage- of advertentietools worden naam, doel, aanbieder en duur hier vóór activering vermeld.</p>
    `
  }),
  "donnees-personnelles": Object.freeze({
    title: "Mijn gegevens beheren",
    short: "Inzage, export, correctie, privacy en verwijdering.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Mijn gegevens bekijken en corrigeren</h2><p>Bewerkbare gegevens zoals gebruikersnaam, avatar en zichtbaarheid kun je aanpassen in de accountinstellingen wanneer die functie beschikbaar is. Neem voor andere gegevens contact op via <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <h2>2. Mijn gegevens exporteren</h2><p>Je kunt een kopie van de gegevens van je account vragen in een gangbaar gestructureerd formaat, in het bijzonder JSON, via de exportfunctie of per e-mail. De export kan profiel, instellingen, collectie, squads, deellinks en toestemmingen bevatten, met inachtneming van rechten van derden.</p>
      <h2>3. Zichtbaarheid beheren</h2><p>Je kunt een aangeboden zichtbaarheid kiezen, een squad verlaten, een deellink intrekken of je profiel privé maken via de bijbehorende instellingen. Intrekking verhindert nieuwe toegang via de link, maar verwijdert niet altijd al gemaakte kopieën of screenshots.</p>
      <h2>4. Toestemmingen beheren</h2><p>Meldingen kun je uitschakelen in [APP_NAME] en in de apparaatinstellingen. Je keuzes voor optionele trackers kun je wijzigen via de cookie- of trackerinstellingen.</p>
      <h2>5. Bepaalde gegevens verwijderen</h2><p>Afhankelijk van de beschikbare functies kun je een lokale collectie wissen, een avatar verwijderen, een squad verlaten, een deellink verwijderen of voorkeuren resetten zonder je hele account te verwijderen.</p>
      <h2>6. Account verwijderen</h2><p>Je kunt verwijdering aanvragen via <em>Instellingen → Mijn account → Mijn account verwijderen</em> of via <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>. Na controle worden accountgegevens uit actieve systemen verwijderd binnen [ACCOUNT_DELETION_DELAY], tenzij beperkte bewaring nodig is voor een wettelijke verplichting, veiligheid of geschil.</p>
      <h2>7. Een ander AVG-recht uitoefenen</h2><p>Voor inzage, rectificatie, verwijdering, beperking, bezwaar of overdraagbaarheid schrijf je naar <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>. Vermeld het e-mailadres van het account en je verzoek. Stuur niet spontaan een identiteitsbewijs; dat wordt alleen gevraagd bij redelijke twijfel.</p>
    `
  }),
  "suppression-compte": Object.freeze({
    title: "Mijn account verwijderen",
    short: "Procedure, gevolgen en termijnen voor verwijdering.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Verwijdering aanvragen</h2><p>Je kunt permanente verwijdering aanvragen via <em>Instellingen → Mijn account → Mijn account verwijderen</em>, wanneer beschikbaar, of per e-mail naar <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a> vanaf het aan het account gekoppelde adres.</p>
      <h2>2. Controle</h2><p>Om frauduleuze verwijdering te voorkomen, kan bevestiging worden gevraagd, bijvoorbeeld via een e-maillink, nieuwe authenticatie of het typen van het woord “DELETE”.</p>
      <h2>3. Gevolgen</h2><p>Afhankelijk van aanwezige gegevens leidt verwijdering tot het verwijderen van profiel en openbare identificatie, de gesynchroniseerde collectie, meldingsvoorkeuren en toegang tot accountgebonden functies; tevens word je uit squads verwijderd, worden uitnodigingen beëindigd en deellinks ingetrokken.</p>
      <h2>4. Termijn</h2><p>Gegevens worden uit actieve systemen verwijderd binnen [ACCOUNT_DELETION_DELAY] nadat het verzoek is gevalideerd.</p>
      <h2>5. Gegevens die kunnen worden bewaard</h2><p>Beperkte informatie kan langer worden bewaard wanneer dit noodzakelijk is om aan een wettelijke verplichting te voldoen, een rechtsvordering in te stellen of te verdedigen, de dienst te beveiligen, ernstig misbruik te voorkomen of een openstaand rapport of incident te behandelen. Deze gegevens worden beperkt of afzonderlijk bewaard en niet gebruikt voor de gewone dienst.</p>
      <h2>6. Accounts van externe aanbieders</h2><p>Het verwijderen van een [APP_NAME]-account verwijdert niet je Google-, Apple-, Discord- of Epic Games-account. Die beheer je rechtstreeks bij de betreffende aanbieder.</p>
    `
  }),
  contact: Object.freeze({
    title: "Contact met SPRITE-INDEX",
    short: "Support, persoonsgegevens, meldingen en beveiliging.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Algemene ondersteuning</h2><p>Voor vragen over het gebruik van [APP_NAME], een accountprobleem of een storing: <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a>.</p>
      <h2>2. Persoonsgegevens</h2><p>Voor een AVG-recht of een vraag over je gegevens: <a href="mailto:[PRIVACY_EMAIL]">[PRIVACY_EMAIL]</a>.</p>
      <h2>3. Melden</h2><p>Voor het melden van inhoud, een gebruikersnaam, avatar of gedrag: <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>.</p>
      <h2>4. Beveiligingsincident</h2><p>Meld een kwetsbaarheid of vermoedelijk compromis via <a href="mailto:[SUPPORT_EMAIL]">[SUPPORT_EMAIL]</a> met “Security” in het onderwerp. Maak een kwetsbaarheid niet openbaar voordat een redelijke oplossing kan worden overwogen en probeer geen toegang tot gegevens van andere gebruikers te krijgen.</p>
      <h2>5. Nuttige informatie</h2><p>Vermeld indien mogelijk het e-mailadres of de gebruikersnaam van het betrokken account, de functie of pagina, de geschatte datum en tijd, een nauwkeurige beschrijving en een screenshot waaruit gevoelige gegevens zijn verwijderd.</p>
      <h2>6. Indicatieve termijnen</h2><p>Verzoeken worden binnen een redelijke termijn behandeld, afhankelijk van urgentie en complexiteit. Verzoeken over AVG-rechten krijgen doorgaans binnen één maand antwoord.</p>
    `
  }),
  signalement: Object.freeze({
    title: "Inhoud of een gebruiker melden",
    short: "Te verstrekken informatie, behandeling en bezwaar.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Wat je kunt melden</h2><p>Je kunt onder meer een onwettige of beledigende gebruikersnaam of avatar, intimidatie, bedreiging, discriminatie, identiteitsfraude, oplichting, poging tot accountdiefstal, ongeoorloofde openbaarmaking van persoonsgegevens, auteursrecht- of merkinbreuk, promotie van cheats, hacking of malware en andere duidelijk onwettige inhoud melden.</p>
      <h2>2. Hoe je meldt</h2><p>Gebruik de meldknop wanneer die beschikbaar is of schrijf naar <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. Vermeld zo mogelijk je contactgegevens, de gebruiker of identificatie, de precieze locatie van de inhoud, feiten en datum, waarom de inhoud volgens jou onrechtmatig is en relevante screenshots of bewijzen. Stuur geen identiteitsdocument, wachtwoord, inlogcode of bankgegevens.</p>
      <h2>3. Beoordeling van de melding</h2><p>Een melding wordt beoordeeld op ernst, context en beschikbare bewijzen. Aanvullende informatie kan worden gevraagd. Meldingsmateriaal kan zolang als nodig worden bewaard voor behandeling, beveiliging en verdediging van rechten.</p>
      <h2>4. Mogelijke maatregelen</h2><p>Na beoordeling kan worden besloten geen actie te nemen, te waarschuwen, inhoud te verwijderen, functies te beperken, een account op te schorten of te verwijderen, en indien vereist of gerechtvaardigd bevoegde autoriteiten te informeren.</p>
      <h2>5. Informatie aan partijen</h2><p>Waar mogelijk en passend ontvangt de melder een ontvangstbevestiging. De gemelde gebruiker kan worden geïnformeerd over de maatregel en reden, behalve wanneer dat een onderzoek, veiligheid of wettelijke verplichting in gevaar zou brengen.</p>
      <h2>6. Bezwaar</h2><p>Een moderatiebesluit kan worden betwist via <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>. Benoem het besluit en nieuwe feiten of redenen voor heroverweging.</p>
      <h2>7. Misbruik van meldingen</h2><p>Herhaalde meldingen die duidelijk ongegrond, misleidend of bedoeld zijn om iemand lastig te vallen kunnen leiden tot beperking van de meldfunctie of een maatregel tegen het betrokken account.</p>
    `
  }),
  licences: Object.freeze({
    title: "Licenties, credits en intellectuele eigendom",
    short: "Verklaring over Epic Games, creaties van SPRITE-INDEX en onderdelen van derden.",
    content: `
      <p class="legal-meta"><strong>Laatst bijgewerkt:</strong> [LEGAL_LAST_UPDATED] — versie [LEGAL_VERSION]</p>
      <h2>1. Onofficiële fanapp</h2><p>[APP_NAME] is een persoonlijke, gratis, niet-commerciële en openbaar toegankelijke fanapp. De app is niet verbonden aan, gesponsord, goedgekeurd of onderschreven door Epic Games.</p><blockquote class="epic-disclaimer"><p>[EPIC_DISCLAIMER]</p></blockquote>
      <h2>2. Onderdelen van Epic Games</h2><p>Fortnite, Epic Games, hun namen, merken, logo’s, personages, items, illustraties, geluiden en andere beschermde onderdelen behoren toe aan Epic Games, Inc. of hun respectieve rechthebbenden. Hun aanwezigheid dient uitsluitend voor identificatie, commentaar of verwijzing binnen een onofficiële fanservice.</p>
      <h2>3. Naleving van het beleid voor fancontent</h2><p>[APP_NAME] is bedoeld om aan het fancontentbeleid van Epic Games te voldoen, onder meer door gratis en niet-commercieel te blijven, geen officiële goedkeuring te claimen en de vereiste verklaring te tonen. Epic Games kan dit beleid wijzigen of toestemming intrekken; inhoud kan daarom worden aangepast of verwijderd. Raadpleeg <a href="[EPIC_FAN_POLICY_URL]" target="_blank" rel="noopener noreferrer">het Epic Games Fan Content Policy</a>.</p>
      <h2>4. Standaard geen inkomstenmodel</h2><p>Op basis van dit document mogen geen advertenties, verkoop, abonnementen, betaalde inhoud of andere inkomstenmodellen worden toegevoegd zonder voorafgaande controle en, waar nodig, passende toestemming.</p>
      <h2>5. Creaties van SPRITE-INDEX</h2><p>Originele onderdelen die specifiek voor [APP_NAME] zijn gemaakt, zoals code, architectuur, teksten, lay-out, interfacecomponenten en een eigen logo dat losstaat van Epic Games-merken, blijven beschermd door de rechten van de maker. Die bescherming strekt zich niet uit tot onderdelen of merken van Epic Games of andere derden.</p>
      <h2>6. Onderdelen en licenties van derden</h2><p>Afhankelijk van de werkelijk uitgerolde versie kan [APP_NAME] onder meer Inter en Rajdhani (SIL Open Font License), Lucide (ISC), Node.js, Express, PostgreSQL, WebSocket en Capacitor gebruiken, elk onder hun eigen licentie. De lijst met credits moet worden bijgewerkt als gebruikte onderdelen wijzigen.</p>
      <h2>7. Door gebruikers aangeleverde inhoud</h2><p>Iedere gebruiker blijft verantwoordelijk voor rechten op zijn gebruikersnaam, avatar en andere aangeleverde inhoud. Inhoud van derden mag niet zonder toestemming of rechtsgrond worden gebruikt.</p>
      <h2>8. Verzoek van een rechthebbende</h2><p>Een rechthebbende kan mogelijk inbreukmakende inhoud melden via <a href="mailto:[REPORT_EMAIL]">[REPORT_EMAIL]</a>, met vermelding van de inhoud, locatie en gegevens die zijn rechten onderbouwen.</p>
    `
  })
});

if (typeof window !== "undefined") window.LEGAL_DOCUMENTS_NL = LEGAL_DOCUMENTS_NL;
if (typeof module !== "undefined" && module.exports) module.exports = { LEGAL_DOCUMENTS_NL };
