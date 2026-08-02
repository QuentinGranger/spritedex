# SPRITE-INDEX

SPRITE-INDEX est le passeport de collection Fortnite : suivi des Sprites et de
leurs variantes, recommandations de farm, passeport partageable, amis, squads
et comparaison de collections. Ce dépôt contient le client web/PWA, l’API
Express, le temps réel WebSocket et les cibles iOS, Android et desktop.

> L’application ne s’exécute plus en ouvrant `index.html` directement : elle a
> besoin de l’API Node.js et de PostgreSQL.

## Fonctionnalités principales

- Collection en swipe, checklist, manquants, priorités et sessions de tri.
- Accueil guidé, événements, plan de farm, historique et statistiques
  cohérentes avec la collection.
- Comptes, OAuth Google/Discord, passeport public, badges et partage avec
  invitation.
- Amis, QR code et liens d’invitation, squads, listes de souhaits et
  comparaison actionnable.
- Notifications, synchronisation locale/hors-ligne et mises à jour en temps
  réel via WebSocket.
- PWA installable, application iOS/Android via Capacitor et application desktop
  Electron.

## Architecture

| Emplacement | Rôle |
| --- | --- |
| `index.html`, `css/`, `js/` | Client web mono-page, interface et cache local. |
| `server.js`, `server/` | Serveur Express, API, authentification, WebSocket, tâches de maintenance et accès PostgreSQL. |
| `sprite-data.js`, `seed.js` | Catalogue de référence et alimentation des données. |
| `scripts/client-cache.js` | Génération déterministe du cache du service worker. |
| `scripts/build-www.js`, `www/` | Bundle web généré pour Capacitor/Electron. Ne pas modifier `www/` à la main. |
| `desktop/` | Shell Electron et configuration de publication desktop. |
| `test/` | Tests API, client et parcours critiques mobile. |
| `render.yaml` | Déploiement Render reproductible (web service + PostgreSQL). |

Les routes applicatives sont regroupées sous `/api`. Le client récupère le
catalogue et les données utilisateur via cette API ; les données de collection
ne sont donc plus définies dans un ancien `app.js`.

## Démarrer en local

Prérequis : Node.js 18 ou plus récent, npm et une instance PostgreSQL locale ou
distante.

```bash
npm install
cp .env.example .env
```

Créez une base PostgreSQL nommée `sprite-index`, ou renseignez `DATABASE_URL`
dans `.env`. Sans cette variable, le serveur tente une connexion locale à
PostgreSQL sur le port `5432`.

```bash
npm start
```

Ouvrez ensuite [http://localhost:3000](http://localhost:3000). Au démarrage, le
serveur initialise le schéma et les données de référence nécessaires.

Pour le développement avec redémarrage automatique :

```bash
npm run dev
```

Pour réalimenter explicitement le catalogue de référence de la base ciblée :

```bash
npm run seed
```

## Configuration

Copiez toujours `.env.example` : il contient la liste complète et commentée des
variables. Ne versionnez jamais `.env`, les clés OAuth, les mots de passe de la
base ou les clés de push.

| Variable | Usage |
| --- | --- |
| `NODE_ENV`, `PORT` | Environnement et port HTTP (`3000` par défaut). |
| `DATABASE_URL` | Connexion PostgreSQL ; prioritaire sur la connexion locale par défaut. |
| `APP_URL` | URL publique employée pour les liens de partage et l’origine de l’application. |
| `OAUTH_REDIRECT_BASE` | Base des retours OAuth, sans `/` final et en HTTPS en production. |
| `CORS_ORIGIN` | Origines autorisées, séparées par des virgules si nécessaire. |
| `TRUST_PROXY` | À définir uniquement derrière un proxy connu (déjà configuré dans le Blueprint Render). |
| `GOOGLE_CLIENT_*`, `DISCORD_CLIENT_*` | Connexion OAuth, optionnelle si le fournisseur concerné n’est pas activé. |
| `RESEND_API_KEY`, `FROM_EMAIL` | Vérification et réinitialisation par e-mail. |
| `VAPID_*`, `FCM_*`, `APNS_*` | Notifications web, Android et iOS. Les clés VAPID peuvent être générées au premier démarrage. |
| `CHROME_PATH` | Facultatif ; active le scraper d’actualités lorsque Chrome/Chromium est disponible. |
| `ADMIN_ACCESS_PASSWORD_HASH` | Secret global de transition uniquement ; à retirer après création d’un compte nominatif. |
| `ADMIN_OPERATOR_USERNAME` | Identifiant nominatif utilisé par `npm run admin` (le compte est stocké en base). |
| `ADMIN_OPERATOR_LABEL` | Facultatif ; libellé d’opérateur écrit dans le journal d’audit (`label:sessionId`). |
| `ADMIN_MAX_CONCURRENT_SESSIONS` | Facultatif ; plafond de sessions admin simultanées (défaut `3`). |
| `ADMIN_CONSOLE_URL` | Facultatif ; URL publique ciblée par la commande terminal, sinon `APP_URL`. |

En production, utilisez une URL publique HTTPS, une base PostgreSQL accessible
et des secrets distincts de ceux du développement. `PGSSL=disable` est réservé
au développement local : le serveur le refuse en production.

## Backoffice administrateur

Le backoffice est isolé de l’interface de jeu et ne dépend pas d’un compte
joueur. Le secret global permet seulement d’amorcer la migration : utilisez-le
une première fois pour créer un compte administrateur nominatif dans
**Confidentialité & audit**, puis utilisez ce compte et faites tourner son
secret. Le secret global peut alors être retiré.

```bash
npm run admin:password
```

Copiez la ligne `ADMIN_ACCESS_PASSWORD_HASH=…` affichée dans `.env` et dans les
variables d’environnement du déploiement, puis redémarrez le serveur. Pour
ouvrir le backoffice, utilisez :

```bash
npm run admin
```

La commande demande le mot de passe sans l’afficher, crée un lien unique valable
5 minutes puis ouvre `/admin`. Le lien ne contient pas le mot de passe, son
jeton est consommé une seule fois et la session obtenue est un cookie `HttpOnly`
valable 4 heures d’inactivité (plafond absolu 12 heures). Les tickets et sessions
sont stockés dans PostgreSQL : elles restent valides entre instances et pendant
un rolling deploy. Chaque action administrative est attribuée à un acteur
`ADMIN_OPERATOR_LABEL:<sessionId>` (par défaut `terminal:<id>`) en mode de transition. Avec un compte nominatif, l’action est attribuée à ce compte et à sa session. Les sessions
concurrentes sont plafonnées (`ADMIN_MAX_CONCURRENT_SESSIONS`, défaut 3) et
peuvent être révoquées depuis Confidentialité & audit. Ajoutez `-- --no-open`
à la commande pour afficher le lien sans ouvrir de navigateur.

Depuis la console développeur d’un navigateur déjà ouvert sur SPRITE-INDEX,
vous pouvez aussi lancer :

```js
openSpriteIndexBackoffice()
```

L’identifiant puis le mot de passe sont alors demandés dans des fenêtres natives ; ne mettez pas le mot de passe
dans la commande, afin qu’il ne soit pas conservé dans l’historique de la
console.

## Tests

Les tests d’intégration nécessitent le serveur et la base configurés. Les tests
plus ciblés sont utiles pendant le développement d’une zone précise :

```bash
npm test
npm run test:mobile-swipe
npm run test:client-cache
npm run test:client-metrics
npm run test:admin
npm run test:passport
npm run test:friends
npm run test:compare
```

`npm test` couvre les domaines serveur et client principaux. Le test mobile du
swipe est volontairement séparé afin de pouvoir valider rapidement le parcours
tactile, la conservation du scroll et les interactions de cartes.

## Web, PWA et cache

Le service worker est généré à partir des assets réellement embarqués : il ne
faut plus incrémenter de version de cache à la main.

- Sur le web, le serveur expose un `/sw.js` généré dynamiquement et non mis en
  cache par le navigateur.
- Pour les conteneurs natifs et desktop, générez le bundle concret :

```bash
npm run build:www
```

Le dossier `www/` est une sortie de build. Toute modification doit être faite
dans les sources (`index.html`, `css/`, `js/`, `scripts/`) puis régénérée.

## Déployer l’API et le web

Le dépôt fournit un Blueprint Render dans `render.yaml`. Il crée une base
PostgreSQL et un service Node, démarre avec `npm start` et vérifie la santé via
`/api/sprites`.

1. Poussez le dépôt sur GitHub et créez un **Blueprint** Render depuis ce dépôt.
2. Renseignez dans Render les secrets marqués `sync: false` (OAuth, e-mail et,
   si besoin, push).
3. Pour un domaine personnalisé, définissez `APP_URL`,
   `OAUTH_REDIRECT_BASE` et `CORS_ORIGIN` avec l’URL HTTPS finale.
4. Enregistrez les URL de callback correspondantes dans les consoles Google et
   Discord.

Le Blueprint convient aussi comme référence pour un hébergement différent :
servez l’application Node derrière HTTPS, conservez la même URL publique pour
le WebSocket et configurez une base PostgreSQL persistante.

## Mobile et desktop

Les applications natives réutilisent le bundle `www/` et gardent l’API de
production comme source de données.

```bash
npm run cap:sync
npm run cap:ios
npm run cap:android
```

La mise en place des deep links OAuth, la signature et la publication sont
documentées dans [MOBILE.md](MOBILE.md).

Pour Electron :

```bash
npm run desktop:dev
npm run desktop:mac
npm run desktop:win
npm run desktop:linux
```

Chaque commande desktop régénère d’abord `www/`. Les installateurs sont produits
dans `release/`.

## Documentation de validation

- [Mobile swipe](MOBILE_SWIPE_VALIDATION.md)
- [Passeport](PASSPORT_VALIDATION.md)
- [Amis et invitations](FRIENDS_VALIDATION.md)
- [Comparaison](COMPARE_VALIDATION.md)
- [Notifications](NOTIFICATIONS_VALIDATION.md)
- [Squads](SQUAD_ENGINE_VALIDATION.md)
- [Graphe des Sprites](SPRITE_GRAPH.md)

## Repères de maintenance

- Toute évolution de donnée doit garder une source de vérité commune entre API,
  cache local, compte, passeport et statistiques.
- Testez les modifications d’interface sur mobile et desktop ; le swipe et la
  navigation basse sont des parcours prioritaires.
- Après un changement du client destiné à Capacitor ou Electron, exécutez
  `npm run build:www` avant de synchroniser ou de distribuer une application.
- Après un changement d’API ou de schéma, vérifiez les tests concernés et le
  démarrage sur une base PostgreSQL vide.
