# Checklist de validation — Passeport collectionneur sprite-index

Cette liste définit quand le Passeport du collectionneur est considéré comme prêt (Étape 88).

| # | Critère | Preuve / test | Statut |
|---|---------|---------------|--------|
| 1 | La date d’inscription est exacte | `getCollectorPassport` expose `user.createdAt` / `identity.createdAt` ; masquage via `showJoinDate` | ✅ |
| 2 | Le nombre de Sprites est exact | `collection.discoveredSpriteCount` vs catalogue sorti (`releasedSpriteCount`) | ✅ |
| 3 | Le nombre de variantes est exact | `ownedVariantCount` / `releasedVariantCount` ; unicité `(user, variant)` (Étape 12) | ✅ |
| 4 | Le taux de complétion est exact | `completionRate` + `completionRateDisplay` ; tests seuils 75 % / arrondis | ✅ |
| 5 | Les contenus non sortis sont exclus | Filtre catalogue actif / released ; variantes `unreleased` absentes du dénominateur (Étape 81) | ✅ |
| 6 | Les événements terminés sont versionnés | `event_collection_versions` + `catalogueVersion` / `version` sur accomplissements | ✅ |
| 7 | La rareté maximale est correcte | `highestOfficialRarity` (rareté catalogue ≠ type de variante) | ✅ |
| 8 | Une squad principale peut être choisie | `PATCH /api/passport/primary-squad` + réglages profil ; membership active requise | ✅ |
| 9 | Les comparaisons ne sont pas comptées plusieurs fois | Sessions de comparaison + dédoublonnage 30 min (Étapes 27–30) | ✅ |
| 10 | Les badges sont attribués une seule fois | `awardBadgeByCode` + clé d’idempotence + `ON CONFLICT DO NOTHING` | ✅ |
| 11 | Les anciens badges restent acquis | Historique / progression historique conservés après shrink catalogue (Étape 76) | ✅ |
| 12 | L’activité récente respecte la confidentialité | Filtrage `visibility` ami / squad / public / privé (Étapes 83–84) | ✅ |
| 13 | Chaque section possède un réglage de visibilité | `passport|statistics|badges|activity|comparisonsVisibility` | ✅ |
| 14 | L’écran fonctionne correctement sur mobile | CSS viewports phone / tablet / desktop + contrat Étape 85 | ✅ |
| 15 | Aucune donnée privée n’est exposée par les cartes partagées | `buildShareCardFromPassport` / `/passport/card` excluent e-mail, notes, amis, activité privée (Étape 83) | ✅ |
| 16 | Accessibilité de base | Alt badges, contraste, textes hors couleur, clavier, titres, barre + texte SR (Étape 86) | ✅ |
| 17 | Mesure d’utilisation | Événements `passport_*` + `getPassportAnalyticsMetrics` (Étape 87) | ✅ |

## Commandes de validation

```bash
node --check analytics.js
node --check js/passport-render.js
node --check js/account.js
node --check server/routes-passport.js

# Serveur requis
npm run test:passport
```

## Notes

- Accessibilité : phrase type « Progression de la collection : 64 variantes sur 82, soit 78,1 %. »
- Analytics produit : `passport_opened`, `passport_shared`, `passport_comparison_started`, `passport_badge_opened`, `passport_badge_unlocked`, `passport_privacy_changed`, `passport_primary_squad_selected`, `passport_share_card_generated`.
- Mesures : passeports consultés, taux de partage, comparaisons depuis un passeport, utilisateurs ayant débloqué un badge, retours après badge, complétion moyenne, fréquence de mise à jour des collections.
