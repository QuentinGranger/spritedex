// Compatibility facade. Collection HTTP handlers now live with the feature.
require("../../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/collections/presentation/http/effects");
