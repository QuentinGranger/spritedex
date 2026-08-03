# Contrat et qualité

`openapi.json` est le contrat API versionné et est servi par `GET /api/openapi.json`.
Toute route publique ajoutée doit être documentée avec ses paramètres, réponses
et exigences d'authentification. Après l’ajout d’une route Express, régénérez le
contrat :

```bash
npm run openapi:generate
npm run test:api-contract
```

Le test de contrat charge le graphe de routes complet (auth, collection, amis,
squads, passeport, notifications, Sprite Graph, admin, …) et échoue si une
opération Express manque dans OpenAPI (ou l’inverse).

## Deux registres immuables

| Couche                | Rôle                                                                                      | Vérification                                              |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Migrations techniques | Schéma SQL versionné (`migrations/` + checksums `schema_migrations`)                      | `npm run test:migrations`                                 |
| Registre catalogue    | Historique append-only sprites/variantes (`catalog_registry_events`, chaîne d’empreintes) | `npm run catalog:verify`, `npm run catalog:backfill`, `npm run test:catalog-registry` |

Les tables `sprites` / `sprite_variants` sont des projections ; l’historique
d’événements est la source de vérité. Détails : [`CATALOG_REGISTRY.md`](CATALOG_REGISTRY.md).

## Gates locaux

```bash
npm run quality
```

`quality` enchaîne :

| Gate                | Portée                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `typecheck`         | `tsc` sur `src/`, `server/`, `scripts/` et les entrées racine ; puis `node --check` sur `server/`, `js/`, `test/`, `scripts/` et les JS déployés à la racine |
| `lint`              | ESLint bug-finding sur `src/`, `server/`, `js/`, `test/`, `scripts/` et les entrées racine (`src/` ajoute aussi `no-unused-vars`)                            |
| `format:check`      | Prettier sur `src/`, `server/`, `js/`, `css/`, `test/`, `scripts/` et les entrées racine                                                                     |
| `test:api-contract` | sync Express ↔ OpenAPI                                                                                                                                       |

Les régressions syntaxiques, de formatage et les symboles manquants hors de `src/`
ne sont donc plus invisibles dans le code déployé.

Autres contrôles :

```bash
npm run test:a11y
npm run test:visual
npm run catalog:verify
```

Les deux premiers tests nécessitent un serveur actif (`BASE_URL`) et Chrome
(`PUPPETEER_EXECUTABLE_PATH`). La CI les fournit. Le test d’accessibilité couvre
l’écran public, puis une session test vérifiée dans la collection, les squads,
le compte, une modale légale et le backoffice. Pour créer volontairement une
nouvelle baseline visuelle :

```bash
VISUAL_UPDATE=1 VISUAL_BASE_URL=http://127.0.0.1:3000 \
PUPPETEER_EXECUTABLE_PATH=/chemin/vers/chrome npm run test:visual
```

Commite ensuite `test/visual-baselines/mobile-login.png`. La baseline est
obligatoire par défaut, y compris dans la CI : une absence ou une différence de
plus de 0,5 % fait échouer le test. `VISUAL_REQUIRE_BASELINE=0` est réservé à
un diagnostic local ponctuel ; il ne doit pas être utilisé dans la CI.
