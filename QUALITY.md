# Contrat et qualité

`openapi.json` est le contrat API versionné et est servi par `GET /api/openapi.json`.
Toute route publique ajoutée doit être documentée avec ses paramètres, réponses
et exigences d'authentification.

Commandes locales :

```bash
npm run quality
npm run test:a11y
npm run test:visual
```

Les deux derniers tests nécessitent un serveur actif (`BASE_URL`) et Chrome
(`PUPPETEER_EXECUTABLE_PATH`). La CI les fournit. Pour créer volontairement une
nouvelle baseline visuelle :

```bash
VISUAL_UPDATE=1 VISUAL_BASE_URL=http://127.0.0.1:3000 \
PUPPETEER_EXECUTABLE_PATH=/chemin/vers/chrome npm run test:visual
```

Commite ensuite `test/visual-baselines/mobile-login.png`. Définis
`VISUAL_REQUIRE_BASELINE=1` en CI lorsque la baseline est présente pour rendre
la comparaison obligatoire.
