#!/usr/bin/env node
// Cross-platform entry point for Render/background process managers.
process.env.PROCESS_ROLE = "worker";
require("../server");
