"use strict";

// Lightweight runner. Passport scenarios are grouped by concern in test/passport/.
const shared = require("./passport/shared");
const foundations = require("./passport/foundations");
const activityAndDefinitions = require("./passport/activity-and-definitions");
const advancedBadges = require("./passport/advanced-badges");
const catalogueAndIntegrity = require("./passport/catalogue-and-integrity");
const liveContract = require("./passport/live-contract");
const livePublicProfile = require("./passport/live-public-profile");
const liveSummary = require("./passport/live-summary");
const liveCollection = require("./passport/live-collection");
const liveSocial = require("./passport/live-social");
const liveArchival = require("./passport/live-archival");

async function run() {
  console.log(`\nRunning SPRITE-INDEX passport tests against ${shared.BASE}\n`);
  await foundations.run();
  await activityAndDefinitions.run();
  await advancedBadges.run();
  await catalogueAndIntegrity.run();

  const owner = await shared.register(`PpOwn${shared.rnd()}`);
  const friend = await shared.register(`PpFr${shared.rnd()}`);
  const stranger = await shared.register(`PpSt${shared.rnd()}`);
  const users = { owner, friend, stranger };
  try {
    await liveContract.run(users);
    await livePublicProfile.run(users);
    await liveSummary.run(users);
    await liveCollection.run(users);
    await liveSocial.run(users);
    await liveArchival.run(users);
  } finally {
    await shared.cleanup(owner);
    await shared.cleanup(friend);
    await shared.cleanup(stranger);
  }

  const { passed, failed } = shared.results();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error("\nTest runner crashed:", err.message);
  process.exit(1);
});
