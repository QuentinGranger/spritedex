# SPRITNEX — Checklist Fortnite

Application web statique pour suivre les Sprites Fortnite et leurs variantes.

## Fonctionnalités

- Mode swipe type Tinder : droite = possédé, gauche = manquant, haut = priorité, bas = à vérifier.
- Checklist complète avec filtres par rareté, variante et statut.
- Page “manquants” pour copier ta farm list.
- Stats de progression par rareté et variante.
- Sauvegarde locale dans le navigateur avec `localStorage`.
- Export/import JSON.
- PWA installable sur mobile quand elle est servie depuis un serveur local ou web.

## Lancer l’app

Option simple : ouvrir `index.html` dans un navigateur.

Option recommandée avec serveur local :

```bash
cd spritedex_app
python3 -m http.server 8000
```

Puis ouvrir :

```txt
http://localhost:8000
```

## Modifier la base de données

La liste des sprites est dans `app.js`, constante `SPRITES`.
Tu peux ajouter un sprite comme ceci :

```js
{
  id: "new-sprite",
  name: "New Sprite",
  rarity: "Rare",
  emoji: "✨",
  color: "rgba(141, 124, 255, 0.42)",
  effect: "Description du pouvoir.",
  variants: ["Base", "Gold", "Gummy", "Galaxy"]
}
```
