// Compatibility facade. HTTP composition belongs to src/app/api/collections.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/app/api/collections/register");
