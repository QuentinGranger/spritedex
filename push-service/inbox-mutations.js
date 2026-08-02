// Compatibility facade. Push infrastructure is owned by Notifications.
require("../src/shared/config/register-path-alias").installSourceAlias();
module.exports = require("@/features/notifications/infrastructure/push/inbox-mutations");
