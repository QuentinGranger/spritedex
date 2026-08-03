# Registre catalogue immuable

SpriteDex maintient **deux couches distinctes** :

1. **Migrations techniques** (`migrations/`, `schema_migrations`) — schéma SQL versionné, fichiers immuables + checksum.
2. **Registre métier catalogue** (`catalog_registry_events`) — historique append-only des sprites et variantes, source de vérité.

Les tables `sprites` et `sprite_variants` restent des **projections** pour les lectures rapides. Toute modification métier doit passer par un événement registre ; aucun UPDATE opaque ni DELETE physique de l’identité catalogue.

## Identité

- Chaque sprite a un `entity_id` stable (PK `sprites.id`).
- Chaque variante a son propre `entity_id` et un `parent_sprite_id` immuable.
- Deux objets ne partagent jamais la même identité ; une création refuse un id déjà présent dans le registre.

## Chaîne d’empreintes

Chaque événement porte :

- `seq` monotone par entité
- `content_hash` = SHA-256 du contenu canonique
- `prev_content_hash` = hash de la version précédente (`NULL` uniquement pour `seq = 1`)

Contenu hashé :

```text
{ entityType, entityId, parentSpriteId, seq, eventType, occurredAt, source, payload, prevContentHash }
```

Toute altération d’une ancienne version invalide les hashes suivants ; `npm run catalog:verify` la détecte.

## Types d’événements

| Type                                                         | Rôle                                            |
| ------------------------------------------------------------ | ----------------------------------------------- |
| `sprite.created` / `variant.created`                         | Genèse (nouvel objet)                           |
| `sprite.bootstrap` / `variant.bootstrap`                     | Genèse rétroactive depuis l’état courant        |
| `sprite.updated` / `variant.updated`                         | Patch de champs (name, rarity, availability, …) |
| `sprite.archived` / `variant.archived` / `variant.withdrawn` | Désactivation sans effacement                   |

Chaque événement enregistre `occurred_at`, `source`, et si possible `actor_user_id` / `actor_label`.

## API applicative

Module [`server/catalog-registry/`](server/catalog-registry/) :

- `appendCatalogEvent` / `createCatalogEntity` / `updateCatalogEntity` / `archiveCatalogEntity`
- `syncSpriteSnapshot` / `syncVariantSnapshot` / `patchEntity`
- `reconstructEntity` — rejoue l’historique
- `verifyEntityChain` / `verifyAllCatalogRegistry`

Écritures branchées : admin catalogue, import catalogue, extraction news, seed (bootstrap).

## Commandes

```bash
npm run migrate                 # applique 003_catalog_registry si besoin
npm run catalog:verify          # vérifie toutes les chaînes + sync projections
npm run test:catalog-registry   # tests unitaires hash / reduce
```

Lecture admin (capability `catalog.read`) :

`GET /api/admin/catalog/:entityType/:entityId/registry`

## Bootstrap et continuité antérieure

La migration `003_catalog_registry` crée le schéma et une genèse minimale.

La migration `004_catalog_registry_history_backfill` **reconstruit** les chaînes pour
étendre la continuité **avant** ce tip :

1. si `catalog_change_history` contient des diffs → genèse = état initial reconstruit à rebours, puis événements `*.updated` chronologiques ;
2. sinon, snapshot daté `catalog/YYYY-MM-DD/` → `*.created` à la date du catalogue, puis patch de réconciliation vers la projection courante ;
3. sinon → `*.created` depuis la projection courante (seed).

Les variantes présentes dans le catalogue daté mais absentes de la projection sont
matérialisées avec une identité registre.

```bash
npm run migrate
npm run catalog:backfill   # rejouable manuellement si besoin
npm run catalog:verify
```
