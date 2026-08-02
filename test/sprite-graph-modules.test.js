const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const directory = path.join(__dirname, "sprite-graph");
const files = fs.readdirSync(directory).filter((file) => /^\d+\.js$/.test(file)).sort();
assert.strictEqual(files.length, 32, "un module doit exister pour chacun des 32 scénarios Sprite Graph");

for (const file of files) {
  const suite = require(path.join(directory, file));
  assert.strictEqual(typeof suite.name, "string", `${file} doit exposer son nom`);
  assert.strictEqual(typeof suite.run, "function", `${file} doit exposer sa fonction de test`);
}

console.log("sprite graph modules: OK");
