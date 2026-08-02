"use strict";

// HTTP composition only: goal handlers remain owned by the goals feature.
require("@/features/goals/presentation/http/create");
require("@/features/goals/presentation/http/feasibility");
require("@/features/goals/presentation/http/recommendation");
require("@/features/goals/presentation/http/list");

module.exports = require("@/features/goals/presentation/http/completion");
