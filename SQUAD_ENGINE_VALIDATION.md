# Critères de validation — Squad Completion Engine

Ce document formalise **quand le moteur d’analyse collective est prêt**.
Chaque critère a une condition d’acceptation et une preuve (API / UI / tests).

## Objectif

Répondre de façon déterministe, compréhensible et testable aux questions :

1. Que possède la squad collectivement ?
2. Quels Sprites / variantes lui manquent entièrement ?
3. Quels membres apportent des variantes uniques ?
4. Quelles recherches doivent être prioritaires ?
5. Comment répartir les recherches entre les membres ?
6. Quelle combinaison de joueurs couvre le mieux le catalogue ?
7. Quel serait l’impact d’une prochaine acquisition ?

Sans intelligence artificielle générative.

## Surface canonique

| Surface | Rôle |
|---------|------|
| **Moteur** (`/squad/:code/engine`) | Source de vérité pour complétion, manquants, priorités, assignations, combos, simulation |
| Vue squad « Recommandations » | Complémentarité **sociale** (amis / invites) + CTA vers le Moteur |

## Comment valider

```bash
# Serveur requis
npm start

# Contrat moteur + parcours squad
npm run test:squads
```

## Critères et traceabilité

| # | Critère | Condition d’acceptation | Preuve |
|---|---------|-------------------------|--------|
| 1 | **Rapport versionné** | `GET …/completion/report` expose `engineVersion`, `catalogueVersion`, `summary`, `analysis`, `recommendations`, `optimization`, `warnings`. | `test/squads.test.js` — « Squad Completion Engine report + simulate » |
| 2 | **Possession collective** | `summary.collectiveCompletionRate` + `coveredVariantCount` cohérents avec le catalogue actif et les collections visibles. | Report summary ; onglet Vue d’ensemble |
| 3 | **Manquants totaux** | Variantes `confirmed_missing` / filtres Manquants ; collections privées exclues et signalées. | `analysis.missing` ; onglet Manquants |
| 4 | **Contributions uniques** | `mostComplementaryMember.uniqueVariantCount` + `uniqueOwners.byMember` (classement). | Report ; Vue d’ensemble |
| 5 | **Priorités lisibles** | Chaque priorité a un `display` et un `collectiveCoverageDelta` numérique. | `recommendations.priorities` |
| 6 | **Répartition des recherches** | Plan membre-centré (`recommendations.plan.members`) avec variantes assignées. | Report `plan` ; onglet Recommandations |
| 7 | **Meilleures combinaisons** | Meilleure paire + meilleur groupe exposés dans `analysis.bestPair` / `optimization.bestTeam`. | Onglet Optimisation |
| 8 | **Impact d’acquisition (what-if)** | `POST …/completion/simulate` avec `type: acquire` renvoie `before` / `after` / `difference` ; UI Optimisation appelle cette API. | Test simulate ; formulaire « Impact d’une acquisition » |
| 9 | **Pas de mutation** | La simulation ne modifie aucune collection. | Contrat simulate (lecture seule) |
| 10 | **Confidentialité** | Collections privées hors calculs ; warning `excludedPrivateCollections`. | Summary + warnings |

## Exigences transversales

- Règles déterministes dans `server/compare.js` (scores d’acquisition, assignations, unique owners).
- Cache d’analyse (`server/squad-analysis-cache.js`) invalidé par versions catalogue / collections.
- Deep-link notifications `squad_completion_increased` → `/squad/{code}/engine`.
- Champs UI alignés sur l’API (`uniqueVariantCount`, `display`, `plan.members`).

## Résultat attendu

Lorsque le test « Squad Completion Engine report + simulate » est vert et que les 4 onglets du Moteur affichent des données cohérentes (dont une simulation Δ taux), le Squad Completion Engine est **prêt pour validation produit**.
