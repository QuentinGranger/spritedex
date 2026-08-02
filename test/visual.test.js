"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");
const { PNG } = require("pngjs");

const baseUrl = process.env.VISUAL_BASE_URL || process.env.BASE_URL;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
const baselinePath = process.env.VISUAL_BASELINE_PATH || path.join(__dirname, "visual-baselines", "mobile-login.png");
const baselineRequired = process.env.VISUAL_REQUIRE_BASELINE !== "0";

async function main() {
  if (!baseUrl || !executablePath) {
    console.log("visual: skipped (VISUAL_BASE_URL/BASE_URL and Chrome are required)");
    return;
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector("#loginScreen");
    await page.evaluate(() => document.fonts?.ready);
    const screenshot = await page.screenshot({ type: "png" });
    const image = PNG.sync.read(screenshot);
    assert.strictEqual(image.width, 390);
    assert.strictEqual(image.height, 844);
    const colors = new Set();
    for (let offset = 0; offset < image.data.length; offset += 64) {
      colors.add(`${image.data[offset]}:${image.data[offset + 1]}:${image.data[offset + 2]}`);
    }
    assert.ok(colors.size > 8, "visual smoke test detected an unexpectedly blank page");
    if (process.env.VISUAL_UPDATE === "1") {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, screenshot);
      console.log(`visual: baseline updated at ${baselinePath}`);
      return;
    }
    if (!fs.existsSync(baselinePath)) {
      if (baselineRequired) {
        throw new Error(`visual baseline is required but missing: ${baselinePath}`);
      }
      console.log("visual: smoke test ok (no baseline committed yet)");
      return;
    }
    const baseline = PNG.sync.read(fs.readFileSync(baselinePath));
    assert.strictEqual(baseline.width, image.width, "visual baseline width differs");
    assert.strictEqual(baseline.height, image.height, "visual baseline height differs");
    let changedPixels = 0;
    for (let offset = 0; offset < image.data.length; offset += 4) {
      const delta =
        Math.abs(image.data[offset] - baseline.data[offset]) +
        Math.abs(image.data[offset + 1] - baseline.data[offset + 1]) +
        Math.abs(image.data[offset + 2] - baseline.data[offset + 2]);
      if (delta > 24) changedPixels += 1;
    }
    const changedRatio = changedPixels / (image.width * image.height);
    assert.ok(changedRatio <= 0.005, `visual regression: ${(changedRatio * 100).toFixed(2)}% of pixels changed`);
    console.log("visual: mobile screenshot smoke test ok");
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
