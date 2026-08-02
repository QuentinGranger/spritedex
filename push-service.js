// Compatibility facade. Push delivery belongs to the Notifications feature.
require("./src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/notifications/infrastructure/push-service");
