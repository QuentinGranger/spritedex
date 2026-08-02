# Architecture source

Le runtime reste Express/CommonJS et le client reste HTML/CSS/JavaScript
statique. `src/app` contient donc les adaptateurs HTTP et les workers, pas
des pages Next.js.

- `features/<nom>` : présentation et assemblage propres à une capacité métier.
- `domain/<nom>` : règles pures, entités, objets-valeur et erreurs.
- `application/<nom>` : cas d'usage et ports.
- `infrastructure` : PostgreSQL, Redis, Web Push, e-mail et observabilité.
- `shared` : validation, configuration et utilitaires réellement transversaux.

Les fichiers à la racine et sous `server/` sont des façades de compatibilité
pendant la migration. Les nouvelles dépendances serveur utilisent `@/` après
l'enregistrement de l'alias dans `server.js`.

## État de migration

- `app/http` : composition Express, service worker et document SPA.
- `app/api/collections`, `app/api/goals` : registres des routes métier.
- `features/auth`, `features/sprites` : session et dépôt catalogue.
- `features/collections`, `features/goals` : handlers HTTP par fonctionnalité.
- `features/notifications` : livraison Push et VAPID.
- `infrastructure` : PostgreSQL, migrations, Redis/rate limit et observabilité.

Les autres fonctionnalités déjà découpées sous `server/` (amis, squads,
comparaisons, passeports, actualités, Sprite Graph et administration) restent
derrière leurs chemins legacy à ce stade. Elles doivent être migrées avec le
même modèle, une capacité à la fois, pour préserver leurs routes publiques et
leurs workers.

Le client n'utilise pas encore de bundler ou de modules ESM : ses scripts
globaux restent sous `js/` afin de ne pas modifier leur ordre d'exécution ni le
bundle Capacitor. L'alias `@/` est donc actuellement réservé au serveur
CommonJS.
