"use strict";

const ctx = require("./notifications/shared");

console.log("\nRunning SPRITE-INDEX notification catalog tests\n");
require("./notifications/catalog-basics").register(ctx);

(async () => {
  for (const suite of ["event-bus-and-gates","content-and-dedupe","presend-and-center","delivery-and-ui","readiness-and-security","contextual-contracts"]) {
    await require(`./notifications/${suite}`).register(ctx);
  }
  const { passed, failed } = ctx.result;
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
