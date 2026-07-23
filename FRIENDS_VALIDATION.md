# Critères de validation — Système d’amis SPRITNEX

Ce document formalise les critères d’acceptation du système d’amis et les
points de vérification automatisés associés.

## Comment exécuter les validations

```bash
node server.js              # démarrer le serveur	npm test                    # exécute les tests d’intégration
```

Les suites `test:security`, `test:compare` et `test:friends` couvrent
l’ensemble des critères ci‑dessous.

## Critères et traceabilité

| # | Critère | Condition d’acceptation | Fichier de test | Test(s) correspondant(s) |
|---|---------|-------------------------|-----------------|--------------------------|
| 1 | **Pseudonyme unique** | Un compte reçoit un `username` unique. L’inscription avec un pseudo déjà utilisé est rejetée (409) sans révéler la cause. | `test/security.test.js` | `register duplicate does not reveal whether email or username is taken` |
| 2 | **Recherche d’utilisateur** | Recherche possible à partir de 3 caractères ; résultats publics sans e‑mail ni identifiant privé. | `test/friends.test.js` | `user search finds bob by username with public fields`, `search rejects queries under 3 characters` |
| 3 | **Envoyer une invitation** | L’expéditeur peut envoyer une demande d’ami (`POST /api/friends/requests`). | `test/friends.test.js` | `alice can send friend request to bob`, `bob can send friend request to a new user by username` |
| 4 | **Accepter ou refuser** | Le destinataire accepte (`/accept`) ou refuse (`/decline`) la demande. | `test/friends.test.js` | `bob accepts friend request`, `nina can decline a friend request by requestId` |
| 5 | **Annuler une invitation** | L’expéditeur peut annuler sa demande (`DELETE /api/friends/requests/:id`). | `test/friends.test.js` | `alice can cancel a sent invitation`, `sender can cancel a request via DELETE /api/friends/requests/:id` |
| 6 | **Apparition mutuelle après acceptation** | Les deux utilisateurs figurent dans `/api/friends` avec champs publics. | `test/friends.test.js` | `both users see each other as friends with public fields` |
| 7 | **Comparaison en un clic** | La comparaison est accessible via `/api/compare/:friendId` lorsque l’amitié existe. | `test/friends.test.js` | `alice can quick compare with bob via /api/compare/:friendId` |
| 8 | **Supprimer un ami** | Un utilisateur peut supprimer une amitié (`DELETE /api/friends/:friendId`). | `test/friends.test.js` | `alice can remove bob from friends via DELETE` |
| 9 | **Bloquer / débloquer** | Bloquer empêche les demandes ; débloquer permet d’en renvoyer une. | `test/friends.test.js` | `block prevents new friend request`, `alice can unblock bob`, `user can list, unblock and must re-invite a blocked user` |
| 10 | **Respect des paramètres de confidentialité** | Les réglages `friendInvitesFrom` (`everyone`, `mutual_squad_members`, `nobody`) et les visibilités de collection / profil sont appliqués. | `test/friends.test.js` | `friend list respects privacy settings`, `nobody setting blocks friend requests`, `mutual_squad_members setting only allows shared squad members`, `private collection blocks comparison even between friends` |
| 11 | **Lien d’invitation créé et révoqué** | Génération de liens d’invitation permanents/24h/7j/usage unique, révocation possible. | `test/friends.test.js` | `create a permanent invite link`, `revoke invite link makes it unusable`, `single-use link is consumed after one redeem`, `regenerate invite link invalidates old token` |
| 12 | **QR code générable** | Le endpoint d’invitation retourne une URL pouvant être transformée en QR code. | `test/friends.test.js` | `generate QR code for invite link` |
| 13 | **Limitation des invitations abusives** | Impossible de renvoyer une demande si déjà en attente, bloqué, ou après un refus récent (7 jours). | `test/friends.test.js` | `bob cannot resend request to alice using addresseeId`, `new request is blocked for 7 days after decline` |
| 14 | **Aucune fuite d’e‑mail ou d’identifiant privé** | Recherche, liste d’amis et profils publics n’exposent pas `email`, `id` interne sensible, etc. | `test/friends.test.js` `test/security.test.js` | `user search finds bob by username with public fields`, `public shared view exposes status but NOT notes`, `shared profile hides collection when it is private` |

## Exigences transversales

- Le soft-delete et la suspension de compte (Étape 32) ne doivent pas
  restaurer automatiquement une amitié si la suppression est volontaire.
- Rejoindre la même escouade ne doit **pas** créer automatiquement une amitié
  (Étape 30).
- Les boutons “Inviter en escouade” et “Ajouter comme ami” ne s’affichent que
  si les conditions (amitié, blocage, paramètres de confidentialité) le
  permettent.

## Résultat attendu

`npm test` doit afficher **0 échec** pour les trois suites et tous les critères
ci‑dessus doivent avoir un test de régression exécutable.
