#!/usr/bin/env node
"use strict";

const { hashAdminPassword } = require("../server/admin-access");
const { promptHidden } = require("./admin-terminal");

(async () => {
  const password = await promptHidden("Choose an admin password (12 characters minimum): ");
  const confirmation = await promptHidden("Confirm the admin password: ");
  if (password !== confirmation) throw new Error("Passwords do not match. Nothing was generated.");
  const hash = hashAdminPassword(password);
  console.log("\nAdd this single line to your local .env and to the production environment:");
  console.log(`ADMIN_ACCESS_PASSWORD_HASH=${hash}`);
  console.log("\nKeep the password private. The hash is safe to store in an environment variable.");
})().catch((error) => {
  console.error(`Admin password setup failed: ${error.message}`);
  process.exitCode = 1;
});
