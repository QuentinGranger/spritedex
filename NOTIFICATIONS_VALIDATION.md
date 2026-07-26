# Critères de validation — Notifications contextuelles SPRITNEX

Ce document formalise **quand le système de notifications est prêt** (Étape 72).
Chaque critère a une condition d’acceptation et une preuve automatisée.

## Comment valider

```bash
# Unitaire (pas de serveur)
npm run test:notifications
npm run test:notification-load

# Intégration (serveur requis : node server.js)
npm run test:friends
npm run test:squads
npm run test:priority-availability
npm run test:event-ending
npm run test:security

# Suite complète
npm test
```

Le système est **prêt** lorsque `npm test` se termine avec **0 échec** et que
tous les critères ci‑dessous sont couverts.

## Les cinq notifications

| Type technique | Déclencheur domaine | Destination |
|----------------|---------------------|-------------|
| `friend_request_accepted` | `friendship.accepted` | `/compare/{friendId}` |
| `friend_acquired_missing_variant` | `collection.variant_acquired` | `/compare/{friendId}?variantId=…` |
| `squad_completion_increased` | `squad.completion_changed` | `/squad/{code}/engine` |
| `priority_variant_available` | `catalogue.variant_available` | `/sprites/{spriteId}?variant=…` |
| `wanted_event_ending_soon` | `catalogue.event_ending_soon` | `/events/{eventId}?filter=priority` |

## Critères et traceabilité

| # | Critère | Condition d’acceptation | Preuve / tests |
|---|---------|-------------------------|----------------|
| 1 | **Les cinq notifications peuvent être générées** | Les cinq types du catalogue sont connus, rendus (FR/EN) et produits par leurs handlers. | `test/notifications.test.js` (types + contenu) ; `test/friends.test.js` (Étape 63/64) ; `test/squads.test.js` (Étape 65) ; `test/priority-availability.test.js` (Étape 66) ; `test/event-ending.test.js` (Étape 67) |
| 2 | **Chaque notification possède un déclencheur précis** | Un seul événement domaine par type ; pas d’émission hors transition autorisée (ex. `owned` depuis statut suivi, `available_now` depuis non‑disponible, couverture squad réelle, seuils d’événement). | `DOMAIN_EVENTS` dans `server/event-bus.js` ; gates Étapes 12/15/22/28/35 dans `test/notifications.test.js` |
| 3 | **Les préférences sont respectées** | Catégorie / type / fréquence désactivés → pas de création (ou pas de push selon le canal). | `evaluateFriendshipAcceptedConditions` (`social_disabled` / `type_disabled`) ; prefs collection dans `test/friends.test.js` ; `evaluateDelivery` / `evaluateTypeActive` |
| 4 | **Les catégories peuvent être désactivées séparément** | `social`, `collection` et `alerts` sont indépendantes dans l’écran de réglages et le stockage des préférences. | `NOTIFICATION_SETTINGS_SCREEN.groups` ; tests Étape 49 / prefs API |
| 5 | **Les push nécessitent une autorisation** | `push_enabled === false` → canal push refusé (`no_consent`) ; l’in‑app peut rester. | `resolvePushAllowance` / `resolveDeliveryChannels` dans `server/notification-channels.js` ; tests canaux |
| 6 | **Les heures silencieuses fonctionnent** | Hors urgences, le push est différé (pas abandonné) pendant la fenêtre ; fuseau utilisateur appliqué. | Étapes 40–41 : `quiet hours defer…`, `user timezone drives quiet hours…` |
| 7 | **Les doublons sont empêchés** | Clés métier stables (`friend_accept`, `friend_variant`, `squad_completion`, `priority_available`, `event_ending`) + `claimDedupeKey`. | Étape 54 ; Étapes 63/66/67 (re‑émet → 1 seule notif) |
| 8 | **Les événements multiples sont regroupés** | Acquisitions, progression squad et variantes d’un même événement partagent une clé de groupe avec `eventCount` / éléments principaux. | Étape 55 ; Étapes 64/65/69 (regroupement) |
| 9 | **Les collections privées ne sont jamais révélées** | Pas de notif d’acquisition si la collection de l’acteur n’est pas visible ; pre‑send annule si devenue privée. | Étape 64 (privé) ; Étape 56 (`collection_private`) ; Étape 57 (masquage pairwise) |
| 10 | **Blocages et départs de squad sont respectés** | Blocage : purge sociale / pairwise, pas de création future. Départ squad : batches stoppés, destinations révoquées (`accessRevoked`). | Étapes 57–58 ; Étape 63 (blocage immédiat) ; Étape 65 (ancien membre) ; Étape 68 (destinations) |
| 11 | **Chaque notification ouvre le bon écran** | URL d’action typée, jamais `/` (accueil) ; action normalisée absente si accès révoqué. | Étape 48 ; destinations dans le tableau ci‑dessus ; Étape 68 (ACL live sur `/compare`) |
| 12 | **Les notifications obsolètes peuvent être annulées** | Pre‑send / scheduler : amitié disparue, variante obtenue, date d’événement modifiée/prolongée, plus aucune priorité manquante → `cancelled`. | Étapes 38/56 ; Étape 67 (prolongation, plus rien ne manque) |
| 13 | **Les envois échoués n’interrompent pas les fonctions principales** | Push/email via file d’attente hors chemin métier ; échec fournisseur → retry puis fail, in‑app conservée ; token mort → plus de retry push. | Étapes 42/45 ; Étape 69 (retry / recovery) ; commentaire `notification-delivery-queue.js` |

## Exigences transversales

- Identifiants techniques stables (indépendants de la langue).
- Traductions structurées (`translationKey` + `translationParams`) pour re‑rendu FR/EN.
- Isolation destinataire : un utilisateur ne lit jamais l’inbox d’un autre (Étape 68).
- Secrets fournisseurs (VAPID privée, Resend, FCM, APNS) jamais exposés au client.

## Résultat attendu

| Suite | Rôle |
|-------|------|
| `test:notifications` | Contrat catalogue, gates, canaux, dédup, groupe, quiet hours, readiness Étape 72 |
| `test:friends` / `test:squads` | Parcours réels amitié, acquisitions, squad |
| `test:priority-availability` / `test:event-ending` | Alertes catalogue & fins d’événement |
| `test:security` | IDOR inbox, jetons push, secrets |
| `test:notification-load` | Fan‑out amis / squad / catalogue / milliers d’users / retry push |

Lorsque tous les critères sont verts, le système de notifications contextuelles
est considéré **prêt pour validation produit**.
