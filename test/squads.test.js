// SPRITE-INDEX — Squad / friend invitation & recommendations tests
// Run against a live server: node server.js, then node test/squads.test.js
const shared = require("./squads/shared");
const runFriendshipsAndCapacity = require("./squads/friendships-and-capacity");
const runPrivacy = require("./squads/privacy");
const runRecommendations = require("./squads/recommendations");
const runCompletionNotification = require("./squads/completion-notification");
const runCompletionProgression = require("./squads/completion-progression");
const runCompletionEngine = require("./squads/completion-engine");

async function run() {
  const { BASE, rnd, register, cleanup, getVariantSamples, results } = shared;
  console.log(`\nRunning SPRITE-INDEX squads tests against ${BASE}\n`);
  const alice = await register(`SqAlice${rnd()}`);
  const bob = await register(`SqBob${rnd()}`);
  const charlie = await register(`SqCharlie${rnd()}`);
  try {
    await runFriendshipsAndCapacity({ alice, bob, charlie });
    const samples = await getVariantSamples(alice.token);
    await runPrivacy(samples);
    await runRecommendations(samples);
    await runCompletionNotification(samples);
    await runCompletionProgression(samples);
    await runCompletionEngine();
  } finally {
    await cleanup(alice);
    await cleanup(bob);
    await cleanup(charlie);
  }
  const { passed, failed } = results();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("\nTest runner crashed:", err.message);
  process.exit(1);
});
