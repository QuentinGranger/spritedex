// Compatibility facade. Authentication infrastructure is owned by Auth.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/auth/infrastructure/session-service");
