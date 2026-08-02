// Compatibility facade. HTTP composition belongs to src/app/api/goals.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/app/api/goals/register");
