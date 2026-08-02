"use strict";

// Compatibility facade. The Sprite Graph service is split by responsibility in
// server/sprite-graph/ while preserving the established CommonJS API.
module.exports = {
  ...require("./sprite-graph/constants"),
  ...require("./sprite-graph/normalization"),
  ...require("./sprite-graph/schema"),
  ...require("./sprite-graph/events"),
  ...require("./sprite-graph/priority"),
  ...require("./sprite-graph/social"),
  ...require("./sprite-graph/squads"),
  ...require("./sprite-graph/goals"),
  ...require("./sprite-graph/comparison"),
  ...require("./sprite-graph/collection")
};
