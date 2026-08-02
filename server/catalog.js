// Compatibility facade. Catalogue persistence is owned by Sprites.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/sprites/infrastructure/catalog-repository");
