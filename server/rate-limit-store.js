// Compatibility facade. Distributed throttling is infrastructure.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/infrastructure/cache/rate-limit-store");
