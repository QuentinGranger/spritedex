# Migrations PostgreSQL

Les migrations sont des modules CommonJS immuables nommés
`NNN_description.js`. Elles sont exécutées dans l'ordre lexical et leur checksum
est enregistré dans `schema_migrations`.

```js
module.exports = {
  id: "002_add_example_column",
  description: "Add the example column to users",
  async up({ client }) {
    await client.query("ALTER TABLE users ADD COLUMN example TEXT");
  },
  async down({ client }) {
    await client.query("ALTER TABLE users DROP COLUMN example");
  }
};
```

Utilisez `client` pour que `up` et `down` restent atomiques. Une opération qui
ne peut pas être annulée sans perte de données doit déclarer
`irreversible: true` et, si nécessaire, `transaction: false` : le rollback est
alors une restauration contrôlée depuis une sauvegarde PostgreSQL, jamais une
suppression forcée de l'historique.

Avant déploiement :

```bash
node scripts/migrate.js up --dry-run
npm run migrate:status
```

Ne modifiez jamais un fichier déjà appliqué : le déploiement sera bloqué par le
contrôle de checksum. Créez une nouvelle migration corrective à la place.
