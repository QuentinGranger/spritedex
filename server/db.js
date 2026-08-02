// Compatibility facade. PostgreSQL configuration now belongs to infrastructure.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/database/postgres-pool");
