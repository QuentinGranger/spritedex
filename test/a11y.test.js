"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const baseUrl = process.env.A11Y_BASE_URL || process.env.BASE_URL;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;

async function main() {
  if (!baseUrl || !executablePath) {
    console.log("a11y: skipped (A11Y_BASE_URL/BASE_URL and Chrome are required)");
    return;
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() =>
      axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })
    );
    const violations = result.violations.map(({ id, impact, nodes }) => `${id} (${impact}): ${nodes.length} node(s)`);
    assert.deepStrictEqual(violations, [], `Accessibility violations:\n${violations.join("\n")}`);
    console.log("a11y: ok");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
