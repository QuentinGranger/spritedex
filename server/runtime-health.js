// Compatibility facade. Runtime state belongs to observability infrastructure.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/observability/runtime-health");
