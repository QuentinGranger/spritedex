// Compatibility facade. Security audit persistence is observability infrastructure.
require("./src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/observability/security-audit-log");
