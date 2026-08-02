// SPRITE-INDEX — Friends / invitations integration tests
// Run against a live server: node server.js, then node test/friends.test.js
"use strict";

const { BASE, ...helpers } = require("./friends/shared");
const suites = [
  require("./friends/friendship-lifecycle"),
  require("./friends/invitation-settings"),
  require("./friends/invite-links"),
  require("./friends/request-cooldown"),
  require("./friends/visibility"),
  require("./friends/squad-analytics"),
  require("./friends/notification-preferences"),
  require("./friends/notification-acceptance"),
  require("./friends/notification-acquisition"),
  require("./friends/squad-friendship"),
  require("./friends/squad-invitations"),
  require("./friends/squad-visibility"),
  require("./friends/account-deletion"),
  require("./friends/squad-deletion"),
  require("./friends/account-suspension")
];

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function run() {
  console.log(`\nRunning SPRITE-INDEX friends tests against ${BASE}\n`);
  const ctx = { ...helpers, test };
  for (const suite of suites) await suite(ctx);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
