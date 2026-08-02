// Compatibility facade. Goal handlers now live with the feature.
require("../../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/goals/presentation/http/recommendation");
