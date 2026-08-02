"use strict";

// Compatibility facade. Badge rules, persistence and specialised evaluators
// live in server/passport-badges/ while preserving the historic CommonJS API.
const definitions = require("./passport-badges/definitions");

module.exports = {
  ...require("./passport-badges/content"),
  ...definitions,
  MILESTONE_BADGES: definitions.MILESTONE_BY_CODE,
  ...require("./passport-badges/rules"),
  ...require("./passport-badges/schema"),
  ...require("./passport-badges/definitions-query"),
  ...require("./passport-badges/unlocking"),
  ...require("./passport-badges/qualifications"),
  ...require("./passport-badges/rarities-events"),
  ...require("./passport-badges/complementary"),
  ...require("./passport-badges/user-badges")
};
