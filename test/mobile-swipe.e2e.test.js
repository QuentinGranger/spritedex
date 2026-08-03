// ─────────────────────────────────────────────────────────────────
// SPRITE-INDEX — Mobile swipe end-to-end regression suite
// Requires a live app server (npm start) and a local Chrome/Chromium binary.
// Run: npm run test:mobile-swipe
// ─────────────────────────────────────────────────────────────────
const assert = require("node:assert");
const fs = require("node:fs");
const puppeteer = require("puppeteer-core");

const BASE_URL = (process.env.MOBILE_SWIPE_BASE_URL || process.env.APP_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const CARD_READY_TIMEOUT = 15_000;
const CARD_CHANGE_TIMEOUT = 1_200;

const MOBILE_PROFILES = Object.freeze({
  iphoneSE: {
    name: "iPhone SE",
    viewport: { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
  },
  iphone13: {
    name: "iPhone 13",
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 }
  },
  android: {
    name: "Android",
    viewport: { width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2.625 }
  }
});
const DESKTOP_PROFILE = Object.freeze({
  name: "Desktop",
  viewport: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }
});

function findChrome() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);
  return candidates.find((file) => fs.existsSync(file));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cardSignature(page) {
  return page.evaluate(() =>
    ["cardName", "cardVariant", "cardIndex"]
      .map((id) => document.getElementById(id)?.textContent.trim() || "")
      .join(" | ")
  );
}

async function waitForCardChange(page, before, timeout = CARD_CHANGE_TIMEOUT) {
  await page.waitForFunction(
    (previous) => {
      const now = ["cardName", "cardVariant", "cardIndex"]
        .map((id) => document.getElementById(id)?.textContent.trim() || "")
        .join(" | ");
      return now !== previous && !document.getElementById("spriteCard")?.classList.contains("is-refreshing");
    },
    { timeout },
    before
  );
}

async function openGuestApp(browser, profile, initialView = "swipe") {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(profile.viewport);
  const catalogueLoaded = page.waitForResponse(
    (response) => {
      try {
        return new URL(response.url()).pathname === "/api/sprites" && response.ok();
      } catch {
        return false;
      }
    },
    { timeout: CARD_READY_TIMEOUT }
  );
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await catalogueLoaded;
  await page.waitForSelector("#loginSkip", { visible: true, timeout: CARD_READY_TIMEOUT });
  await page.click("#loginSkip");
  const cookieReject = await page.$("#cookieReject");
  if (cookieReject) await cookieReject.click();
  await page.waitForFunction(
    () => {
      const shell = document.getElementById("appShell");
      return (
        shell &&
        getComputedStyle(shell).display !== "none" &&
        document.querySelectorAll("#nowDashboardGrid .now-card").length === 3 &&
        !!document.querySelector("#nowPrimary .now-primary__reason")
      );
    },
    { timeout: CARD_READY_TIMEOUT }
  );
  if (initialView === "swipe") {
    await page.evaluate(() => document.querySelector('.tab[data-view="swipe"]')?.click());
    await page.waitForFunction(
      () => {
        const card = document.getElementById("spriteCard");
        return (
          card &&
          !card.classList.contains("is-refreshing") &&
          document.getElementById("cardIndex")?.textContent !== "0/0"
        );
      },
      { timeout: CARD_READY_TIMEOUT }
    );
  }
  return { context, page };
}

async function cardCenter(page) {
  return page.$eval("#spriteCard", (card) => {
    card.scrollIntoView({ block: "center", inline: "center" });
    const rect = card.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

async function touchSwipe(page, direction) {
  const start = await cardCenter(page);
  const distance = 155;
  const end = {
    x: start.x + (direction === "right" ? distance : direction === "left" ? -distance : 0),
    y: start.y + (direction === "down" ? distance : direction === "up" ? -distance : 0)
  };
  const client = await page.createCDPSession();
  const point = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(start.x, start.y) });
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(start.x + (end.x - start.x) * progress, start.y + (end.y - start.y) * progress)
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchTap(page, selector) {
  const point = await page.$eval(selector, (element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const client = await page.createCDPSession();
  const touchPoints = [{ x: point.x, y: point.y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchDragDown(page, selector, distance = 110) {
  const point = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + Math.min(20, rect.height / 2) };
  });
  const client = await page.createCDPSession();
  const touch = (x, y) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touch(point.x, point.y) });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touch(point.x, point.y + distance) });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function withGuestApp(browser, profile, run, initialView = "swipe") {
  const app = await openGuestApp(browser, profile, initialView);
  try {
    await run(app.page);
  } finally {
    await app.context.close();
  }
}

async function main() {
  const executablePath = findChrome();
  if (!executablePath) {
    throw new Error("Chrome/Chromium introuvable. Définis PUPPETEER_EXECUTABLE_PATH pour lancer les tests mobiles.");
  }
  const ping = await fetch(`${BASE_URL}/api/sprites`).catch(() => null);
  if (!ping?.ok) throw new Error(`Serveur indisponible sur ${BASE_URL}. Lance d'abord: npm start`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
  });
  let passed = 0;
  let failed = 0;
  const test = async (name, run) => {
    try {
      await run();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${name}\n      ${error.message}`);
    }
  };

  try {
    console.log(`\nMobile swipe E2E against ${BASE_URL}\n`);

    await test("l'accueil met en avant une recommandation intelligente et ouvre le tri", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          assert.strictEqual(await page.$$eval("#nowDashboardGrid .now-card", (cards) => cards.length), 3);
          assert.ok(await page.$("#nowPrimary .now-primary__reason"), "raison de la recommandation absente");
          assert.strictEqual(await page.$eval(".tab.active", (tab) => tab.dataset.view), "home");
          await touchTap(page, '[data-now-action="swipe"]');
          await page.waitForFunction(() => document.querySelector(".tab.active")?.dataset.view === "swipe", {
            timeout: CARD_READY_TIMEOUT
          });
        },
        "home"
      ));

    await test("l'état de sauvegarde reste explicite hors ligne", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          assert.ok(
            await page.$eval("#syncBar", (bar) => bar.classList.contains("sync-bar--local")),
            "état local absent"
          );
          await page.evaluate(() => {
            state.userId = "sync-test";
            Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
            window.dispatchEvent(new Event("offline"));
          });
          await page.waitForFunction(
            () => document.getElementById("syncBar")?.classList.contains("sync-bar--offline"),
            { timeout: CARD_READY_TIMEOUT }
          );
          await page.evaluate(() => {
            state.userId = null;
            Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => true });
            window.dispatchEvent(new Event("online"));
          });
          await page.waitForFunction(() => document.getElementById("syncBar")?.classList.contains("sync-bar--local"), {
            timeout: CARD_READY_TIMEOUT
          });
        },
        "home"
      ));

    await test("la navigation mobile compacte les vues secondaires dans Plus", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          assert.strictEqual(
            await page.$eval('.tab[data-view="stats"]', (tab) => getComputedStyle(tab).display),
            "none"
          );
          await page.evaluate(() => document.getElementById("mobileMoreButton")?.click());
          await page.waitForFunction(() => !document.getElementById("mobileMoreMenu")?.hidden, {
            timeout: CARD_READY_TIMEOUT
          });
          await touchDragDown(page, ".mobile-more__sheet header");
          await page.waitForFunction(() => document.getElementById("mobileMoreMenu")?.hidden, {
            timeout: CARD_READY_TIMEOUT
          });
          await page.evaluate(() => document.getElementById("mobileMoreButton")?.click());
          await page.waitForFunction(() => !document.getElementById("mobileMoreMenu")?.hidden, {
            timeout: CARD_READY_TIMEOUT
          });
          await page.evaluate(() => document.querySelector('[data-mobile-view="stats"]')?.click());
          await page.waitForFunction(() => document.querySelector(".tab.active")?.dataset.view === "stats", {
            timeout: CARD_READY_TIMEOUT
          });
          assert.ok(await page.$eval("#mobileMoreButton", (button) => button.classList.contains("active")));
        },
        "home"
      ));

    await test("la recherche globale tactile trouve une variante et permet de la marquer possédée", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          const target = await page.evaluate(() => {
            const item = getAllItems().find((candidate) => getEntry(candidate.id).status !== "owned");
            return { id: item.id, query: `${item.spriteName} ${item.variantName || item.variant}` };
          });
          await touchTap(page, "#commandPaletteOpen");
          await page.waitForFunction(() => document.getElementById("commandPalette")?.open, {
            timeout: CARD_READY_TIMEOUT
          });
          await page.type("#commandPaletteInput", target.query);
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll("[data-command-index]")].some((button) =>
                button.textContent.includes("Marquer possédé")
              ),
            { timeout: CARD_READY_TIMEOUT }
          );
          await page.evaluate(() =>
            [...document.querySelectorAll("[data-command-index]")]
              .find((button) => button.textContent.includes("Marquer possédé"))
              ?.click()
          );
          await page.waitForFunction(
            (itemId) => getEntry(itemId).status === "owned",
            { timeout: CARD_READY_TIMEOUT },
            target.id
          );
          assert.ok(
            await page.$eval("#commandPalette", (dialog) => !dialog.open),
            "la palette doit se fermer après l’action"
          );
        },
        "home"
      ));

    await test("la recherche globale comprend les intentions de navigation et de réglages", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          await touchTap(page, "#commandPaletteOpen");
          await page.type("#commandPaletteInput", "statistiques");
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll("[data-command-index]")].some((button) =>
                button.textContent.includes("Ouvrir les statistiques")
              ),
            { timeout: CARD_READY_TIMEOUT }
          );
          await page.evaluate(() =>
            [...document.querySelectorAll("[data-command-index]")]
              .find((button) => button.textContent.includes("Ouvrir les statistiques"))
              ?.click()
          );
          await page.waitForFunction(() => document.querySelector(".tab.active")?.dataset.view === "stats", {
            timeout: CARD_READY_TIMEOUT
          });
          await page.evaluate(() => document.getElementById("commandPaletteOpen")?.click());
          await page.type("#commandPaletteInput", "reglages");
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll("[data-command-index]")].some((button) =>
                button.textContent.includes("Ouvrir mon compte")
              ),
            { timeout: CARD_READY_TIMEOUT }
          );
        },
        "home"
      ));

    await test("desktop : la palette se ferme par Échap et par sa croix", () =>
      withGuestApp(
        browser,
        DESKTOP_PROFILE,
        async (page) => {
          let step = "ouverture initiale";
          await page.click("#desktopSearch");
          try {
            await page.waitForFunction(() => document.getElementById("commandPalette")?.open, {
              timeout: CARD_READY_TIMEOUT
            });
            step = "fermeture Échap";
            await page.keyboard.press("Escape");
            await page.waitForFunction(() => !document.getElementById("commandPalette")?.open, {
              timeout: CARD_READY_TIMEOUT
            });
            step = "seconde ouverture";
            await page.click("#desktopSearch");
            await page.waitForFunction(() => document.getElementById("commandPalette")?.open, {
              timeout: CARD_READY_TIMEOUT
            });
            step = "fermeture croix";
            await page.click("[data-command-palette-close]");
            await page.waitForFunction(() => !document.getElementById("commandPalette")?.open, {
              timeout: CARD_READY_TIMEOUT
            });
          } catch (error) {
            throw new Error(`${step}: ${error.message}`);
          }
        },
        "home"
      ));

    await test("le plan de farm par événement est accessible depuis les manquants", () =>
      withGuestApp(
        browser,
        MOBILE_PROFILES.iphone13,
        async (page) => {
          await page.evaluate(() => document.querySelector('.tab[data-view="missing"]')?.click());
          await page.waitForFunction(() => document.querySelector(".tab.active")?.dataset.view === "missing", {
            timeout: CARD_READY_TIMEOUT
          });
          assert.ok(await page.$("#farmPlanner .farm-planner__heading"), "en-tête du plan de farm absent");
        },
        "home"
      ));

    await test("une priorité déclarée devient la recommandation principale", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
        const targetName = await page.$eval("#cardName", (element) => element.textContent.trim());
        const before = await cardSignature(page);
        await touchTap(page, "#markPriority");
        await waitForCardChange(page, before);
        await page.evaluate(() => document.querySelector('.tab[data-view="home"]')?.click());
        await page.waitForFunction(
          (name) => document.querySelector("#nowPrimary h3")?.textContent.includes(name),
          { timeout: CARD_READY_TIMEOUT },
          targetName
        );
      }));

    await test("la session de tri suit la progression, se met en pause et annule la dernière action", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
        const target = await page.evaluate(() => ({ id: currentItem().id, status: getEntry(currentItem().id).status }));
        assert.ok((await page.$eval("#swipeSessionProgress", (node) => node.textContent)).includes("0 traité"));
        const before = await cardSignature(page);
        await touchTap(page, "#markMissing");
        await waitForCardChange(page, before);
        await page.waitForFunction(
          () => document.getElementById("swipeSessionProgress")?.textContent.includes("1 traité"),
          { timeout: CARD_READY_TIMEOUT }
        );
        await touchTap(page, "#swipeSessionPause");
        await page.waitForFunction(
          () =>
            document.getElementById("swipeSessionPause")?.textContent.includes("Reprendre") &&
            document.getElementById("markOwned")?.disabled,
          { timeout: CARD_READY_TIMEOUT }
        );
        await touchTap(page, "#swipeSessionPause");
        await touchTap(page, "#swipeSessionUndo");
        await page.waitForFunction(
          ({ id, status }) => getEntry(id).status === status,
          { timeout: CARD_READY_TIMEOUT },
          target
        );
        assert.ok((await page.$eval("#swipeSessionProgress", (node) => node.textContent)).includes("0 traité"));
      }));

    await test("le poste de tri mobile tient au-dessus de la navigation sans défilement", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphoneSE, async (page) => {
        const layout = await page.evaluate(() => {
          const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const nav = rect("#mainTabs");
          const card = rect("#spriteCard");
          const actions = rect(".swipe-actions");
          const session = rect("#swipeSession");
          return {
            scrollY: window.scrollY,
            cardTop: card?.top,
            actionsBottom: actions?.bottom,
            sessionTop: session?.top,
            navTop: nav?.top
          };
        });
        assert.ok(layout.scrollY <= 2, `le swipe ne doit pas commencer scrollé (${layout.scrollY}px)`);
        assert.ok(layout.sessionTop >= 0 && layout.cardTop >= 0, "session ou carte hors viewport");
        assert.ok(
          layout.actionsBottom <= layout.navTop - 4,
          `actions recouvertes par la navigation (${layout.actionsBottom} > ${layout.navTop})`
        );
      }));

    await test("desktop : les raccourcis de session classent puis annulent", () =>
      withGuestApp(browser, DESKTOP_PROFILE, async (page) => {
        const target = await page.evaluate(() => ({ id: currentItem().id, status: getEntry(currentItem().id).status }));
        const before = await cardSignature(page);
        await page.keyboard.press("?");
        await page.waitForFunction(() => !document.getElementById("swipeShortcutGuide")?.hidden, {
          timeout: CARD_READY_TIMEOUT
        });
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.getElementById("swipeShortcutGuide")?.hidden, {
          timeout: CARD_READY_TIMEOUT
        });
        await page.keyboard.press("4");
        await waitForCardChange(page, before);
        await page.waitForFunction((id) => getEntry(id).status === "owned", { timeout: CARD_READY_TIMEOUT }, target.id);
        await page.keyboard.down("Control");
        await page.keyboard.press("z");
        await page.keyboard.up("Control");
        await page.waitForFunction(
          ({ id, status }) => getEntry(id).status === status,
          { timeout: CARD_READY_TIMEOUT },
          target
        );
      }));

    await test("iPhone SE : swipe droit conserve le scroll et change de carte", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphoneSE, async (page) => {
        await cardCenter(page);
        const scrollBefore = await page.evaluate(() => window.scrollY);
        assert.ok(scrollBefore > 0, "la carte doit pouvoir être testée hors du haut de page");
        const before = await cardSignature(page);
        await touchSwipe(page, "right");
        await waitForCardChange(page, before);
        const scrollAfter = await page.evaluate(() => window.scrollY);
        assert.ok(
          Math.abs(scrollAfter - scrollBefore) <= 3,
          `scroll déplacé de ${scrollAfter - scrollBefore}px après swipe droit`
        );
      }));

    await test("Android : swipe vertical vers le haut conserve le scroll et change de carte", () =>
      withGuestApp(browser, MOBILE_PROFILES.android, async (page) => {
        await cardCenter(page);
        const scrollBefore = await page.evaluate(() => window.scrollY);
        const before = await cardSignature(page);
        await touchSwipe(page, "up");
        await waitForCardChange(page, before);
        const scrollAfter = await page.evaluate(() => window.scrollY);
        assert.ok(
          Math.abs(scrollAfter - scrollBefore) <= 3,
          `scroll déplacé de ${scrollAfter - scrollBefore}px après swipe vertical`
        );
      }));

    await test("iPhone 13 : chacun des quatre boutons d'action change correctement de carte", async () => {
      for (const selector of ["#markOwned", "#markMissing", "#markPriority", "#markUnsure"]) {
        await withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
          const before = await cardSignature(page);
          await touchTap(page, selector);
          await waitForCardChange(page, before);
        });
      }
    });

    await test("la nouvelle carte est disponible rapidement après une action", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
        const before = await cardSignature(page);
        const startedAt = Date.now();
        await touchTap(page, "#markOwned");
        await waitForCardChange(page, before);
        const elapsed = Date.now() - startedAt;
        assert.ok(elapsed < 900, `nouvelle carte reçue en ${elapsed}ms (attendu < 900ms)`);
      }));

    await test("un swipe diffère les listes cachées puis les rafraîchit à l'ouverture", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
        const beforeChecklist = await page.$eval("#checklistList", (list) => list.innerHTML);
        const beforeMissing = await page.$eval("#missingList", (list) => list.innerHTML);
        const beforeStats = await page.$eval("#rarityBars", (list) => list.innerHTML);
        const beforeCard = await cardSignature(page);
        await touchTap(page, "#markOwned");
        await waitForCardChange(page, beforeCard);
        assert.strictEqual(
          await page.$eval("#checklistList", (list) => list.innerHTML),
          beforeChecklist,
          "checklist reconstruite pendant le swipe"
        );
        assert.strictEqual(
          await page.$eval("#missingList", (list) => list.innerHTML),
          beforeMissing,
          "manquants reconstruits pendant le swipe"
        );
        assert.strictEqual(
          await page.$eval("#rarityBars", (list) => list.innerHTML),
          beforeStats,
          "stats reconstruites pendant le swipe"
        );
        await page.evaluate(() => document.querySelector('.tab[data-view="checklist"]')?.click());
        await page.waitForFunction(
          (previous) => document.getElementById("checklistList")?.innerHTML !== previous,
          { timeout: CARD_READY_TIMEOUT },
          beforeChecklist
        );
      }));

    await test("le swipe reste utilisable après un retour d'arrière-plan", () =>
      withGuestApp(browser, MOBILE_PROFILES.iphone13, async (page) => {
        const background = await page.browserContext().newPage();
        await background.goto("about:blank");
        await background.bringToFront();
        await delay(150);
        await page.bringToFront();
        await background.close();
        const before = await cardSignature(page);
        await touchSwipe(page, "left");
        await waitForCardChange(page, before);
      }));
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\nMobile swipe suite failed: ${error.message}\n`);
  process.exitCode = 1;
});
