# Checklist de validation — Comparaison SpriteDex

Cette liste définit quand la fonctionnalité de comparaison est considérée comme prête.

| # | Critère | Preuve / test | Statut |
|---|---------|---------------|--------|
| 1 | Deux collections peuvent être comparées | Endpoint `GET /api/comparisons/users/:a/:b` retourne un résultat JSON structuré | ✅ |
| 2 | Les 5 catégories sont calculées correctement | `test/compare.test.js` — `bothOwned`, `onlyUserA`, `onlyUserB`, `bothMissing`, `unknown` | ✅ |
| 3 | Le taux individuel est exact | Vérifié dans `test/compare.test.js` (ex. 2/4 = 50%) | ✅ |
| 4 | Le taux collectif est exact | Vérifié dans `test/compare.test.js` (ex. 3/4 = 75%) | ✅ |
| 5 | La complémentarité est exacte | Vérifié dans `test/compare.test.js` (ex. 2/3 = 66.67%) | ✅ |
| 6 | Les inconnus sont distingués des manquants | `test/compare.test.js` — `new`/`unknown`/`unsure` vont dans `unknown`, pas `bothMissing` | ✅ |
| 7 | Les filtres fonctionnent ensemble | `applyServerCompareFilters` combine filtres `status` + `seasonId`/`eventId`/`rarity`/`variantType`/`availability` | ✅ |
| 8 | Les règles de confidentialité sont respectées | `test/compare.test.js` : utilisateur `private`/`friends_only` retourne 403 ; `test/security.test.js` IDOR | ✅ |
| 9 | La comparaison se met à jour après une modification | WebSocket `compare_subscribe` + `broadcastCompareUpdate` sur `PUT`/`sync`/`import`/`DELETE` | ✅ |
| 10 | Un lien partageable peut être généré et révoqué | `POST /api/compare/share` puis `DELETE /api/compare/share/:token` ; test couvert | ✅ |
| 11 | L’écran fonctionne sur mobile | CSS `compare.css` responsive + build Capacitor `www/` | ✅ |
| 12 | Une carte sociale peut être partagée | Route `/compare/share/:token` injecte les métas Open Graph/Twitter (titre, description, image) | ✅ |
| 13 | Aucun contenu non sorti n’entre dans les statistiques | `isVariantReleasedAndActive` et `isVariantReleasedAndActiveServer` filtrent `archived`/`unreleased`/`upcoming` | ✅ |

## Commandes de validation

```bash
# Syntaxe
node --check server.js
node --check js/compare.js
node --check analytics.js

# Build mobile
npm run build:www
npx cap copy ios

# Tests (serveur en cours d’exécution requis)
node test/compare.test.js
node test/security.test.js
```

## Notes

- Les événements analytics (`comparison_viewed`, `comparison_shared`, `comparison_filter_used`, `missing_match_opened`, `priority_added_from_comparison`) permettent de confirmer l’usage réel.
- Le cache serveur est invalidé à chaque modification de collection pour garantir des données fraîches.
