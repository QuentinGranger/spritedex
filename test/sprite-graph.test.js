// SPRITE-INDEX — Sprite Graph test runner (Étapes 1–101).
// Individual scenarios live in ./sprite-graph/ to keep each domain focused.
const { pool, API, stopGraphOutboxWorker, stopCommunityStatsDailyJob } = require("./sprite-graph/shared");
const suites = [
  require("./sprite-graph/01.js"),
  require("./sprite-graph/02.js"),
  require("./sprite-graph/03.js"),
  require("./sprite-graph/04.js"),
  require("./sprite-graph/05.js"),
  require("./sprite-graph/06.js"),
  require("./sprite-graph/07.js"),
  require("./sprite-graph/08.js"),
  require("./sprite-graph/09.js"),
  require("./sprite-graph/10.js"),
  require("./sprite-graph/11.js"),
  require("./sprite-graph/12.js"),
  require("./sprite-graph/13.js"),
  require("./sprite-graph/14.js"),
  require("./sprite-graph/15.js"),
  require("./sprite-graph/16.js"),
  require("./sprite-graph/17.js"),
  require("./sprite-graph/18.js"),
  require("./sprite-graph/19.js"),
  require("./sprite-graph/20.js"),
  require("./sprite-graph/21.js"),
  require("./sprite-graph/22.js"),
  require("./sprite-graph/23.js"),
  require("./sprite-graph/24.js"),
  require("./sprite-graph/25.js"),
  require("./sprite-graph/26.js"),
  require("./sprite-graph/27.js"),
  require("./sprite-graph/28.js"),
  require("./sprite-graph/29.js"),
  require("./sprite-graph/30.js"),
  require("./sprite-graph/31.js"),
  require("./sprite-graph/32.js"),
];

async function run(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err && err.message ? err.message : err}`);
    return false;
  }
}

async function main() {
  console.log(`\nRunning SPRITE-INDEX Sprite Graph étapes 1–101 against ${API}\n`);
  stopGraphOutboxWorker();
  stopCommunityStatsDailyJob();
  let passed = 0;
  let failed = 0;
  for (const suite of suites) {
    if (await run(suite.name, suite.run)) passed++; else failed++;
  }
  console.log(`\n${passed} passed, ${failed} failed\n`);
  await pool.end().catch(() => {});
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
