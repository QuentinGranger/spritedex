// Compatibility facade. Versioned PostgreSQL migrations are infrastructure.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/database/migrations/runner");
