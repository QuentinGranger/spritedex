# Validation mobile — Swipe

La suite `npm run test:mobile-swipe` exécute le parcours de swipe dans Chrome
mobile émulé, contre une instance locale déjà lancée avec `npm start`.

Elle protège les régressions suivantes :

- swipe droit sur iPhone SE : nouvelle carte et position de lecture inchangée ;
- swipe vertical haut sur Android : nouvelle carte et position de lecture inchangée ;
- les quatre boutons d'action fonctionnent à la suite ;
- la carte suivante apparaît en moins de 900 ms ;
- un swipe ne reconstruit pas les listes cachées ; elles se rafraîchissent à
  l'ouverture de leur onglet ;
- le deck reste utilisable après un passage d'une page à l'arrière-plan puis au premier plan.

Le navigateur est détecté automatiquement sur macOS et Linux. Sinon, définir
`PUPPETEER_EXECUTABLE_PATH` avec le chemin vers Chrome ou Chromium.

Exécution :

```bash
npm start
npm run test:mobile-swipe
```
