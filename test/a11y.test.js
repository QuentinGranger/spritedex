"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const axeSource = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const baseUrl = process.env.A11Y_BASE_URL || process.env.BASE_URL;
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN;
const adminPassword = process.env.A11Y_ADMIN_PASSWORD || "sprite-index-a11y-admin";

function apiUrl(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function assertA11y(page, name, include) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) {
    await page.addScriptTag({ content: axeSource });
  }
  const result = await page.evaluate(
    (target) =>
      window.axe.run(document, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
        ...(target ? { include: [target] } : {})
      }),
    include
  );
  const violations = result.violations.map(({ id, impact, nodes }) => `${id} (${impact}): ${nodes.length} node(s)`);
  assert.deepStrictEqual(violations, [], `${name}:\n${violations.join("\n")}`);
  console.log(`a11y: ${name} ok`);
}

async function createTestUser() {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(apiUrl("/api/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `a11y-${suffix}@example.com`,
      password: "a11y-test-password",
      username: `a11y${suffix}`.slice(0, 24),
      displayName: "A11y test user",
      cguAccepted: true,
      cguVersion: "a11y-test",
      ageConfirmed: true,
      cookieConsent: { necessary: true, analytics: false, version: "a11y-test" }
    })
  });
  const user = await response.json().catch(() => ({}));
  assert.ok(response.ok, `Cannot create a11y user: ${user.error || response.status}`);
  assert.ok(user.id && user.token && user.emailVerified, "A11y user must receive a verified test session");
  return user;
}

async function authenticateApplication(page, user) {
  await page.goto(baseUrl, { waitUntil: "networkidle0" });
  await page.evaluate((session) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("sprite-index_token", session.token);
    localStorage.setItem(
      "sprite-index_user",
      JSON.stringify({
        id: session.id,
        username: session.username,
        created_at: session.created_at
      })
    );
    localStorage.setItem("sprite-index_email_verified", "true");
    localStorage.setItem(
      "sprite-index_consent_v1",
      JSON.stringify({
        necessary: true,
        analytics: false,
        consentedAt: new Date().toISOString()
      })
    );
  }, user);
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector("#appShell", { visible: true });
}

async function authenticateAdmin(browser) {
  const ticketResponse = await fetch(apiUrl("/api/admin/terminal/ticket"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: adminPassword })
  });
  const ticket = await ticketResponse.json().catch(() => ({}));
  assert.ok(ticketResponse.ok && ticket.accessUrl, "Cannot create the a11y admin session");

  const page = await browser.newPage();
  await page.goto(ticket.accessUrl, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => location.pathname === "/admin");
  await page.waitForSelector(".admin-app-shell", { visible: true });
  return page;
}

async function main() {
  if (!baseUrl || !executablePath) {
    console.log("a11y: skipped (A11Y_BASE_URL/BASE_URL and Chrome are required)");
    return;
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await assertA11y(page, "écran public", "#loginScreen");

    const user = await createTestUser();
    await authenticateApplication(page, user);

    await page.click('.tab[data-view="checklist"]');
    await page.waitForSelector("#view-checklist.active");
    await assertA11y(page, "collection connectée", "#view-checklist");

    await page.click('.tab[data-view="social"]');
    await page.click('[data-social-tab="squad"]');
    await page.waitForSelector("#social-panel-squad:not([hidden])");
    await assertA11y(page, "squads connectées", "#social-panel-squad");

    await page.click("#accountBtn");
    await page.waitForSelector("#accountPanel", { visible: true });
    await assertA11y(page, "compte connecté", "#accountPanel");

    await page.click('#accountPanel [data-legal-doc="politique-confidentialite"]');
    await page.waitForSelector("#legalDialog[open]");
    await assertA11y(page, "modale légale", "#legalDialog");
    await page.evaluate(() => document.getElementById("legalDialog")?.close());

    const adminPage = await authenticateAdmin(browser);
    await assertA11y(adminPage, "administration connectée", ".admin-main");
    await adminPage.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
