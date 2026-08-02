// Compatibility facade. Consent payload validation is shared across features.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/shared/validation/cookie-consent");
