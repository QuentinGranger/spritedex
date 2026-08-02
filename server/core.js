// Compatibility facade. Express composition now belongs to src/app/http.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/app/http/core");
