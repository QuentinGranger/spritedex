# Sprite Graph — mémoire historique SpriteDex

## Étape 1 — Définition

Le Sprite Graph n’est **pas** un écran unique. C’est un ensemble de données reliant progressivement :

- utilisateurs
- Sprites / variantes
- collections & priorités
- comparaisons
- amis
- squads
- objectifs
- événements Fortnite
- notifications

Exemple de relations :

```text
Quentin
  → possède Water Gold
  → recherche Batman Holofoil
  → appartient à Bravo Six
  → compare sa collection avec Lucy
  → complète un objectif avec Lucy
```

Ces relations sont exploitables sans base orientée graphe.

## Étape 2 — Infrastructure (v1)

PostgreSQL reste la base principale :

```text
PostgreSQL
├── tables métier existantes
├── graph_events          (append-only)
├── tables d’agrégats     (plus tard)
└── vues analytiques      (plus tard)
```

Hors scope v1 : Neo4j, Kafka, moteur de reco complexe, IA, entrepôt séparé.

## Étape 3 — Huit événements stables

| Identifiant technique | Signification |
|-----------------------|---------------|
| `collection.sprite_added` | Une variante passe à `owned` |
| `collection.status_changed` | Changement de statut de collection |
| `collection.priority_added` | Priorité posée / changée (≠ `none`) |
| `comparison.completed` | Comparaison comptabilisée |
| `friend_invitation.sent` | Invitation d’ami envoyée |
| `squad.joined` | Adhésion à une squad |
| `goal.completed` | Objectif marqué complété |
| `notification.opened` | Notification ouverte (premier clic) |

Les libellés UI peuvent changer ; ces IDs restent stables.

## Étape 4 — Variantes dans les événements

Même pour `collection.sprite_added`, l’événement référence la variante précise :

```json
{
  "eventType": "collection.sprite_added",
  "spriteId": "sprite_water",
  "variantId": "sprite_water_gold"
}
```

`spriteId` = famille ; `variantId` = élément réellement ajouté.

## Étape 5 — Table `graph_events`

Append-only. Types adaptés au schéma SpriteDex (INTEGER users/squads, VARCHAR sprites/variants — pas UUID pour ces FKs).

Voir `server/sprite-graph.js` → `ensureGraphEventsTable`.

## Étape 6 — Append-only + corrections

Une ligne de `graph_events` n’est **jamais** modifiée ni supprimée (trigger SQL).

En cas d’erreur :

1. ne pas écraser l’événement ;
2. créer un événement correctif (nouvel insert) ;
3. enregistrer l’annulation dans `graph_event_corrections` ;
4. conserver la traçabilité (ancien + correctif + raison).

Vue `graph_events_effective` = historique sans les événements annulés.

API : `correctGraphEvent({ cancelledEventId, reason, correctiveEvent?, correctedBy? })`.

## Étape 7 — Événement ≠ état actuel

| Couche | Rôle | Exemple |
|--------|------|---------|
| Tables métier (`sprite_entries`, …) | **État actuel** | Water Gold = `owned` |
| `graph_events` | **Historique des changements** | 10/07 unknown→priority ; 12/07 priority→owned |

Le Graph explique *comment* on est arrivé à l’état métier.

## Étape 8 — Structure commune

Champs communs :

`id`, `eventType`, `eventVersion`, `occurredAt`, `recordedAt`, `actorUserId`, `source`, `context`, `deduplicationKey`

Identifiants spécifiques (selon l’événement) :

`targetUserId`, `spriteId`, `variantId`, `squadId`, `comparisonId`, `friendshipId`, `goalId`, `notificationId`

## Étape 9 — Source

Valeurs canoniques : `web` · `ios` · `android` · `api` · `import` · `admin` · `system` · `migration`

L’origine détaillée (ex. `collection.setEntry`) est stockée dans `context.origin`.

## Étape 10 — Version d’événement

```json
{ "eventType": "comparison.completed", "eventVersion": 1 }
```

Si la structure évolue, on incrémente `eventVersion` ; les anciennes lignes restent interprétables avec leur version d’origine (`GRAPH_EVENT_VERSIONS` dans le module).

## Étape 11 — Clé de déduplication

Format : `{eventType}:{userId}:{variantId}:{changeId}`

Exemple : `collection.sprite_added:42:sprite_water_gold:entry_123`

La contrainte `UNIQUE(deduplication_key)` bloque les doublons (double clic, retry réseau, async, webhook, client).

Helper : `buildDeduplicationKey(...)`.

## Étape 12–13 — `collection.sprite_added`

Déclenché **uniquement** à la première création d’une ligne de collection (`isNewEntry`) :

- absence → owned / missing / priority / …

**Pas** déclenché sur les modifications ultérieures (ex. priority → owned).

## Étape 14 — `collection.status_changed`

Déclenché quand un statut change sur une ligne **déjà existante** :

```json
{
  "eventType": "collection.status_changed",
  "context": {
    "previousStatus": "priority",
    "newStatus": "owned",
    "catalogueVersion": "2026.07.18-1"
  }
}
```

## Étape 15 — Pas d’événement sans changement

`owned → owned` (et priorité inchangée) → aucun événement graph.

## Étape 16 — `collection.priority_added`

Déclenché lorsque le **statut** devient `priority` (intention métier).

Peut coexister avec `collection.status_changed`.

```json
{
  "eventType": "collection.priority_added",
  "context": {
    "previousStatus": "missing",
    "priorityLevel": "urgent",
    "eventId": "event_hot_bat_summer"
  }
}
```

## Étape 17 — Priorités actuelles vs historiques

| Mesure | Source |
|--------|--------|
| Priorités actuelles | `sprite_entries` où `status = 'priority'` |
| Ajouts historiques | events `collection.priority_added` (vue effective) |
| Utilisateurs uniques ayant priorisé | `COUNT(DISTINCT actor_user_id)` sur ces events |

Helper : `getPriorityInterestMetrics(pool, { days })`.

## Étape 18–19 — `comparison.completed`

Émis seulement quand une session de comparaison est **comptée** (pas à chaque reload).

Fenêtre : 1 comparaison comptée par paire sociale / 30 minutes (`comparison_sessions`).

Contexte enrichi : taux collectif, complémentarité, counts orientés acteur.

## Étape 20 — Paire normalisée

```text
pairUserLowId = min(actor, target)
pairUserHighId = max(actor, target)
pairKey = comparison_pair:{low}:{high}
```

`actorUserId` reste l’initiateur. Quentin×Lucy === Lucy×Quentin.

## Étape 21 — `friend_invitation.sent`

Déclenché après création réussie d’une invitation (`applyFriendAction` / invite links).

Méthodes (`context.invitationMethod`) :

| Méthode | Usage |
|---------|--------|
| `username` | recherche / demande classique |
| `invite_link` | lien d’invitation |
| `qr_code` | QR (`?via=qr`) |
| `squad_member` | membres d’une même squad |
| `passport` | depuis le passeport |

Le `source` enveloppe reste canonique (`api` / `web` / …). Le canal social est dans `context.invitationSource` (ex. `username_search`).

## Étape 22 — Pas d’historique social public

`friend_invitation.sent` sert aux agrégats :

- volume d’invitations
- répartition par méthode
- taux d’acceptation

Via `getFriendInvitationPublicMetrics()` uniquement. Ne jamais exposer publiquement qui a invité qui, les refus, les pending, ni l’historique individuel.

## Étape 23–24 — `squad.joined` + impact

Émis quand un utilisateur devient membre actif (code ou invitation).

Contexte :

- `inviterId`, `memberRole`, `memberCountAfterJoin`
- `collectiveCompletionBefore` / `collectiveCompletionAfter`
- `newVariantsAddedToSquad` — variantes que le membre apporte en exclusivité
- `sharedVariantsAdded` — variantes déjà couvertes (doublons / chevauchement)

## Étape 25 — `goal.completed`

Émis quand un objectif passe à `completed`.

Contexte : `goalType`, `participantCount`, `targetVariantCount`, `completedVariantCount`, `durationDays`.

## Étape 26 — `goalScope`

| Valeur | Signification |
|--------|----------------|
| `personal` | Objectif personnel |
| `friends` | Objectif entre amis (explicite) |
| `squad` | Objectif d’escouade (`squad_id`) |

Permet de comparer la réussite par type d’objectif.

## Étape 27 — `notification.opened`

Émis **côté serveur** au premier clic réel (`clicked_at`), pas depuis le navigateur seul.

Contexte : `notificationType`, `category`, `channel`, `destination`, `delaySinceDeliverySeconds`.

## Étape 28 — Ouverture ≠ action

- `notification.opened` = consultation
- Plus tard (réservés, non émis) : `notification.action_clicked`, `notification.converted`

## Étape 29 — Émission serveur

Les événements importants sont créés après confirmation serveur :

- changement réellement enregistré
- utilisateur autorisé
- pas de doublon (`deduplication_key`)
- état précédent connu
- transaction réussie

## Étape 30 — Même transaction

Pour les écritures critiques de collection (`setEntry`, `sync`, `import`) et l’ouverture de notification :

```text
BEGIN;
  UPDATE métier…;
  INSERT INTO graph_events…;
COMMIT;
```

Évite un changement sans événement, ou un événement sans changement réel.

## Étape 31 — Outbox

Table `event_outbox` : traitement différé des agrégats.

```text
transaction métier
  → graph_events
  → event_outbox (même TX)
  → worker asynchrone
  → graph_aggregates
```

## Étape 32 — Worker simple

Intervalle par défaut : 10 s (`GRAPH_OUTBOX_POLL_MS`). Pas de Kafka en v1.

## Étape 33 — Données personnelles

Le Graph ne stocke pas : e-mails, IP permanentes, jetons OAuth, messages privés, notes personnelles, raisons de blocage, contenu sensible de profil. Principalement des IDs internes. Voir `sanitizeGraphContext`.

## Étape 34 — Niveaux

| Niveau | Usage |
|--------|--------|
| `raw_private` | Événements individuels |
| `aggregated_internal` | Stats produit |
| `aggregated_public` | Stats anonymisées affichables |

Les événements bruts ne deviennent pas automatiquement publics.

## Étape 35 — Seuil d’anonymisation

Minimum **20** utilisateurs uniques (`GRAPH_PUBLIC_MIN_USERS`). En dessous : « Données communautaires insuffisantes ».

## Étape 36 — `graph_daily_metrics`

Table générique optionnelle. Dimensions nulles → sentinelles (`''` / `0`) pour une PK stable. En pratique, préférer les tables spécialisées (Étape 37).

IDs adaptés au schéma SpriteDex : `variant_id` / `sprite_id` en VARCHAR, `squad_id` en INTEGER.

## Étape 37 — Agrégats spécialisés

- `community_variant_stats`
- `community_sprite_stats`
- `comparison_daily_stats`
- `squad_daily_stats`
- `notification_daily_stats`

## Étape 38–40 — Possession communautaire

`community_variant_stats` calcule par jour / variante :

```text
ownership_rate = owners ÷ sampleSize × 100
```

Exemple : 18 / 320 → **5,63 %** → « 5,6 % des collectionneurs renseignés possèdent cette variante. »

### Éligibilité (Étape 39)

- compte actif, non suspendu, non test (`is_test_account`)
- collection renseignée ≥ 60 % du catalogue (`GRAPH_COMMUNITY_MIN_FILL`)
- activité ≤ 90 jours (`GRAPH_COMMUNITY_ACTIVE_DAYS`)
- consentement analytics / `community_stats_opt_in` si requis

Ne jamais diviser par tous les comptes inscrits.

## Étape 41 — Non possédé ≠ non renseigné

Statuts suivis : `owned` | `missing` | `priority` | `spotted` | `unknown`.

Le dénominateur du taux de possession **exclut** `unknown` (sample = owned+missing+priority+spotted).

## Étape 42 — Taille d’échantillon

Chaque stat publique expose `sampleSize` et un libellé du type « échantillon de 320 collections renseignées ».

## Étape 43 — Variantes les plus recherchées

v1 : utilisateurs uniques ayant **actuellement** le statut `priority` (`getMostSoughtVariants`).

## Étape 44 — Taux de priorité

```text
priority_rate = priority ÷ (missing + priority + spotted) × 100
```

Exemple : 90 / 200 → **45 %** → « 45 % des collectionneurs auxquels elle manque l'ont placée en priorité. »

## Étape 45 — Ajouts de priorité récents

Fenêtres `priority_added_7d` / `_30d` / `_90d` depuis `collection.priority_added`.

Exemple : « +84 ajouts en priorité sur 7 jours ».

## Étape 46–47 — Sprites les plus comparés

Deux niveaux :

1. **Comparaisons sociales** — nombre de `comparison.completed`
2. **Sprites dans les différences** — `topDifferenceSpriteIds` (onlyA ∪ onlyB), stockés comme *difference appearances* (jamais « vues »)

Événements futurs (non émis) : `comparison.sprite_viewed`, `comparison.filter_applied`, `comparison.variant_opened`, `comparison.sprite_opened`.

## Étape 48 — Complémentarité moyenne

```text
avg = Σ complementarityRate (1 valeur récente / pairKey / catalogueVersion)
      ÷ nombre de paires×versions valides
```

## Étape 49 — Par taille de collection

Bandes : `0_25` | `25_50` | `50_75` | `75_100` (moyenne des taux de possession de la paire).

## Étape 50–52 — Indice d’intérêt (Tendance SpriteDex)

Pas une « popularité officielle » Fortnite — uniquement les utilisateurs SpriteDex.

```text
priorityScore / collectionScore / comparisonScore / notificationScore
  = percentile 0–100 parmi les Sprites du jour

interestScore =
  priorityScore × 0,40
  + collectionScore × 0,30
  + comparisonScore × 0,20
  + notificationScore × 0,10
```

Libellés : **Tendance SpriteDex** / **Indice d’intérêt communautaire**.
Poids : `GRAPH_POPULARITY_WEIGHTS`.

## Étape 53 — Évolution journalière (variante)

Table `variant_interest_daily` : priorités, possession %, score, `change_7d`, `change_30d`, `peak_interest_score`.

## Étape 54 — Tendance

`strongly_rising` (≥ +25 %) · `rising` (+10…+24,99) · `stable` (−9,99…+9,99) · `falling` (−10…−24,99) · `strongly_falling` (≤ −25 %).
Volume mini : `GRAPH_TREND_MIN_VOLUME` (défaut 20).

## Étape 55 — Progression des squads

`squad_daily_snapshots` : variantes couvertes, taux collectif, membres, uniques + `progress_1d` / `_7d` / `_30d`.

## Étape 56 — `squad_daily_stats`

Table canonique (ids `squad_id` INTEGER) : membres actifs, variantes couvertes, taille catalogue, taux collectif, uniques, partagées + `catalogue_version`.

## Étape 57 — Progression communautaire moyenne

```text
avg = Σ progressions (squads éligibles) ÷ nombre de squads éligibles
```

Éligibilité squad : ≥ 2 membres actifs non suspendus, collections suffisamment renseignées, activité récente, consentement agrégation.

## Étape 58 — Biais catalogue vs acquisition

Quand le catalogue grossit, le taux peut baisser sans perte de collection :

```json
{
  "completionRateBeforeCatalogueUpdate": 85,
  "completionRateAfterCatalogueUpdate": 83.9,
  "catalogueExpansionImpact": -1.1,
  "acquisitionProgress": 0
}
```

Les `progress_*` préfèrent `acquisitionProgress` lorsque la taille du catalogue change.

## Étape 59 — `catalogueVersion` sur les agrégats

Chaque métrique importante est tamponnée avec `catalogue_version` pour comparer correctement deux périodes (ne pas croiser 70/82 avec 72/90 sans version).

## Étape 60 — Traitement journalier

`runSpriteGraphDailyPipeline` une fois par jour :

1. utilisateurs éligibles
2–3. taux de possession + priorités
5. statistiques de comparaison + scores d’intérêt
4. tendances
6. instantanés squads + progression communautaire
7–8. seuils d’anonymisation + publication (`graph_daily_publish`)

## Étape 61–62 — Temps réel minimal

Incrémenter immédiatement (via outbox) : ajouts, priorités, comparaisons, invitations, objectifs terminés, notifications ouvertes.
**Ne pas** recalculer les % communautaires après chaque action.

```text
événement → compteur incrémental → consolidation nocturne → agrégat officiel du jour
```

## Étape 63 — `graph_metric_counters`

```text
(metric_date, metric_type, entity_id) → count_value
```

Types : `priority_added`, `collection_added`, `comparison_completed`, `comparison_difference`, `invitation_sent`, `goal_completed`, `notification_opened`.
`entity_id` est `VARCHAR` (ids SpriteDex), pas UUID.

## Étape 64 — Rebuild

`rebuildGraphMetrics(startDate, endDate)` rejoue les événements bruts → compteurs + pipeline journalier (formules, éligibilité, catalogue).

## Étape 65 — Rétention des événements bruts

Les lignes `graph_events` restent l’avantage historique (conservées). Minimum : id, type, relations, date, version, contexte utile.
Purge possible : outbox traité, compteurs anciens, clés techniques de contexte (`GRAPH_TECHNICAL_CONTEXT_RETENTION_DAYS`).

## Étape 66 — Politique de conservation

| Données | Conservation |
|---|---|
| Événements métier | Longue durée (anonymisés à la suppression de compte) |
| Journaux techniques | 30–90 jours |
| Données de livraison (outbox) | 90 jours |
| Agrégats journaliers | Permanente |

## Étape 67 — Suppression de compte

`anonymizeUserGraphData` : `actorUserId` / `targetUserId` → `NULL`, contexte personnel retiré, opt-out stats, agrégats anonymes conservés. Pas de reconstruction d’historique personnel.

## Étape 68 — Consentement

Couches : nécessaire (fonctionnement) · analytique interne · stats communautaires publiques.
Réglage : « Participer aux statistiques communautaires anonymisées » (`community_stats_opt_in`). Les fonctions essentielles ne dépendent pas de ce consentement.

## Étape 69 — Anti-manipulation

Exclusion test / suspendus ; rate-limit ; détection de changements massifs ; comptes récents signalés ; préférence pour les utilisateurs uniques. Les événements exclus portent `graphEligibility: "excluded"`.

## Étape 70 — Imports légitimes

`context.updateMethod` : `initial_import` | `bulk_import` | `manual_update` | `sync_batch` | `automated_suspect`.
Un import initial de dizaines de variantes n’est pas traité comme abus.

## Pipeline

```text
actions utilisateurs
  → événements structurés (graph_events) + gouvernance
  → outbox
  → compteurs incrémentaux (si éligible)
  → consolidation nocturne (pipeline journalier)
  → community_variant_stats / comparison_* / interest / squad_daily_stats
  → graph_daily_publish
  → recommandations futures
```

## Étape 76 — Réponse communautaire standardisée

`GET /api/sprite-graph/variants/:variantId/community` → payload `{ variantId, asOf, catalogueVersion, community, dataQuality, publicDisplay, raritySeparation, disclaimer }`.

## Étape 77 — Fiches Sprite

Affichage public minimal : possession, priorité parmi manquants, tendance, échantillon. Pas de surcharge de chiffres.

## Étape 78 — Page Tendances

`GET /api/sprite-graph/trends` — sections : plus possédés, plus rares SpriteDex, plus recherchés, priorités, progressions, plus comparés. Toujours : « Données issues de la communauté SpriteDex ».

## Étape 79 — Rareté officielle ≠ rareté communautaire

Afficher séparément : `Rareté officielle` et `Taux de possession SpriteDex`.

## Étape 80 — Évolution historique

`GET /api/sprite-graph/variants/:variantId/history` — possession et priorités dans le temps. Pas de série si historique trop court (`GRAPH_MIN_HISTORY_POINTS`, défaut 2).

## Étape 81 — Période minimale avant tendance

Avant d’afficher une tendance : ≥ 7 jours de données, ≥ 20 utilisateurs éligibles, ≥ 5 événements pertinents (env : `GRAPH_TREND_MIN_DAYS` / `GRAPH_TREND_MIN_USERS` / `GRAPH_TREND_MIN_EVENTS`). Sinon : « Pas encore assez de données pour calculer une tendance. »

## Étape 82 — Stats dans les comparaisons

`POST /api/sprite-graph/compare/community-context` — lignes secondaires (possession / priorité) sous la comparaison personnelle. Ne jamais primer le résultat perso.

## Étape 83 — Stats dans les squads

`GET /api/sprite-graph/squads/:squadId/community` (id ou code) — couverture catalogue + progression moyenne des pairs. Ton encourageant, pas de classement.

## Étape 84 — Groupes de comparaison anonymes

Pairs par bande de taille (ex. 4–6 membres), éventuellement niveau de complétion. Ne pas comparer une squad de 2 avec une de 20. Identités et rangs exclus.

## Étape 85 — Futures recommandations (hooks only)

Surfaces réservées : priorités, amis complémentaires, membres de squad, objectifs d’événement, variantes d’intérêt, notifications. `GET /api/sprite-graph/recommendations/readiness` — `autoGenerate: false`. Pas de génération automatique complexe en v1.

## Étape 86 — Règles simples

Moteur booléen (`server/sprite-graph-rules.js`) :
- priorité + faible possession + événement bientôt terminé → alerte forte ;
- ≥ 15 variantes complémentaires + collections ≥ 80 % renseignées → suggestion de comparaison.

`POST /api/sprite-graph/rules/evaluate` et `POST /api/sprite-graph/recommendations` avec `{ facts }`.

## Étape 87 — Pas de score social caché

Interdit : score de valeur du collectionneur, qualité sociale, prestige. `GET /api/sprite-graph/scoring-policy` — le Graph mesure comportements et relations, pas la valeur des personnes.

## Étape 88 — Tests des événements

Couvrir : succès → événement ; échec → aucun ; dédup ; version ; ids obligatoires ; dates ; contexte ; source ; même transaction métier.

## Étape 89 — Tests `collection.sprite_added`

Première création, import initial, ajout manuel, pas de doublon, variante existante, utilisateur autorisé, version catalogue.

## Étape 90 — Tests `collection.status_changed`

`missing→priority`, `priority→owned`, `owned→missing`, pas d’event `owned→owned`, `previousStatus` correct, historique append-only conservé.

## Étape 91 — Tests événements sociaux

Invitation envoyée / doublon refusé ; entrée squad ; comparaison comptée une fois ; blocage respecté ; agrégats publics sans identités.

## Étape 92 — Tests agrégats communautaires

Éligibles, exclusion `unknown`, taux possession/priorité, échantillon, seuil d’anonymisation, `catalogue_version`, comptes suspendus exclus.

## Étape 93 — Tests tendances

Hausse / baisse / stabilité ; volume insuffisant ; historique trop court ; nouvelle variante ; événement temporaire ; correction catalogue.

## Étape 94 — Tests progression squads

Variante unique vs doublon sans gain ; join / leave ; nouvelle version catalogue ; collection privée exclue ; squad inactive non éligible.

## Étape 95 — Tests de reconstruction

Supprimer les agrégats d’une période, rejouer via `rebuildGraphMetrics`, vérifier l’égalité avec les agrégats initiaux. Fiabilité = reconstructibilité.

## Étape 96 — Tests de confidentialité

Suppression / anonymisation ; retrait du consentement ; seuil minimal ; petites squads ; bloqués ; événements privés (sanitize) ; export admin **agrégats uniquement** (pas de raw events).

## Étape 97 — Métriques techniques (internes)

`server/sprite-graph-metrics.js` : events/min, retard worker, temps d’agrégats, erreurs, doublons, taille table, durée reconstruction. `publicProduct: false` — jamais dans le produit public. Admin : `GET /api/admin/sprite-graph/technical-metrics`.

## Étape 98 — Tableau de contrôle interne

`GET /api/admin/sprite-graph/control-board` — 24h, par type, rejetés, lag, dernière consolidation, échantillons, métriques publiques suspendues. `PATCH /api/admin/sprite-graph/flags` pour désactiver temporairement une métrique incorrecte. Accès : `SPRITE_GRAPH_ADMIN_USER_IDS` ou `ANALYTICS_ADMIN_USER_IDS`.

## Étape 99 — Formules versionnées

Ids : `ownership_rate_v1`, `priority_rate_v1`, `interest_score_v1`, `squad_progress_v1` (colonne `formula_version` sur les agrégats). Un changement de formule → `…_v2` ; l’historique conserve l’ancienne id. `GET /api/admin/sprite-graph/formulas`.

## Étape 100 — Documenter chaque métrique

Catalogue canonique : `server/sprite-graph-metric-catalog.js` / `GET /api/admin/sprite-graph/metrics-catalog`.

Pour chaque statistique : **nom**, **description**, **formule**, **population éligible**, **fenêtre temporelle**, **seuil minimal**, **version**, **limites**, **date de dernière modification**.

### Taux de possession communautaire (`ownership_rate_v1`)

| Champ | Valeur |
| --- | --- |
| Nom | Taux de possession communautaire |
| Description | Part des collectionneurs éligibles ayant renseigné la variante et la possédant |
| Formule | Nombre d’utilisateurs éligibles possédant la variante **divisé par** nombre d’utilisateurs éligibles ayant renseigné la variante |
| Population | Opt-in communauté, actifs, non test / non suspendus, collection suffisamment renseignée ; dénominateur = owned+missing+priority+spotted |
| Fenêtre | Snapshot journalier |
| Seuil minimal | 20 utilisateurs (affichage public) |
| Version | `ownership_rate_v1` |
| Limites | `unknown` exclu du dénominateur ; ≠ rareté officielle |
| Dernière modification | 2026-07-26 |

Autres métriques documentées dans le catalogue : `priority_rate`, `interest_score`, `interest_trend`, `squad_progress`, `sample_size`, `priority_adds_7d`, et métriques ops internes.

## Étape 101 — Critères de validation de la première version

La v1 est prête lorsque (`evaluateGraphV1Readiness` / `GET /api/admin/sprite-graph/v1-readiness`) :

1. les huit événements sont enregistrés ;
2. chaque événement est dédupliqué ;
3. les événements sont créés côté serveur ;
4. les versions sont conservées ;
5. les changements de collection sont historisés ;
6. les comparaisons ne sont pas surcomptées ;
7. les invitations et squads sont reliées ;
8. les objectifs terminés sont enregistrés ;
9. les ouvertures de notifications sont mesurées ;
10. les événements peuvent être rejoués ;
11. les statistiques excluent les données inconnues ;
12. les seuils d’anonymisation sont respectés ;
13. la version du catalogue est conservée.

## Module

- Code : `server/sprite-graph.js`, `…-outbox`, `…-privacy`, `…-community`, `…-comparison-stats`, `…-trends`, `…-squad-stats`, `…-catalogue`, `…-daily`, `…-counters`, `…-governance`, `…-public`, `…-recommendations`, `…-rules`, `…-formula`, `…-metrics`, `…-metric-catalog`, `…-v1-validation`, `routes-sprite-graph.js`, `routes-sprite-graph-admin.js` ; UI `js/sprite-graph-ui.js`, `js/compare.js`, `js/squad-engine.js`
- Tests : `npm run test:sprite-graph`
