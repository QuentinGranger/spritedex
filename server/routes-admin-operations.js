"use strict";

// Compatibility facade. Domain routes register themselves through focused modules.
const shared = require("./admin-operations/shared");
require("./admin-operations/overview");
require("./admin-operations/players");
require("./admin-operations/moderation");
require("./admin-operations/reports");
require("./admin-operations/catalog");
require("./admin-operations/editorial");
require("./admin-operations/collections");
require("./admin-operations/social");
require("./admin-operations/notifications");
require("./admin-operations/passports");
require("./admin-operations/privacy-audit");

module.exports = { audit: shared.audit };
