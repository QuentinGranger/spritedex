// Compatibility facade. Error reporting belongs to observability infrastructure.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/observability/monitoring");
