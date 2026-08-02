const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV ||= "test";
process.env.APP_URL ||= "http://127.0.0.1:3000";
process.env.OAUTH_REDIRECT_BASE ||= process.env.APP_URL;
process.env.CORS_ORIGIN ||= process.env.APP_URL;

const directory = path.join(__dirname, "../server/squad");
const files = fs.readdirSync(directory).filter((file) => file.endsWith(".js"));
assert.ok(files.length >= 13, "les routes Squad doivent rester découpées par fonctionnalité");

for (const file of files) {
  const lines = fs.readFileSync(path.join(directory, file), "utf8").split("\n").length;
  assert.ok(lines <= 500, `${file} dépasse 500 lignes (${lines})`);
}

const { generateSquadCode } = require("../server/routes-squad");
assert.match(generateSquadCode(), /^SPRITE-[A-Z2-9]{13}$/);

console.log("squad route modules: OK");
