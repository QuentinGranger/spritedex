// Client-side regression tests for friend and squad invitation links.
// Run: node test/client-invite-links.test.js
const assert = require("node:assert");
const fs = require("node:fs");
const vm = require("node:vm");

const initSource = fs.readFileSync("js/init.js", "utf8");
const linkHandlers = initSource.slice(0, initSource.indexOf("// If opened with a \"?share=<token>\""));

function createContext(search) {
  const values = new Map();
  const calls = { fetch: [], join: 0, tabs: 0, toasts: [] };
  const elements = {
    loginInviteNotice: { hidden: true },
    loginInviteTitle: { textContent: "" },
    loginInviteDetail: { textContent: "" }
  };
  const location = { search, pathname: "/", hash: "" };
  const context = {
    URLSearchParams,
    location,
    history: {
      replaceState(_state, _title, next) {
        const url = new URL(next, "https://sprite-index.test");
        location.pathname = url.pathname;
        location.search = url.search;
        location.hash = url.hash;
      }
    },
    sessionStorage: {
      setItem(key, value) { values.set(key, String(value)); },
      getItem(key) { return values.get(key) || null; },
      removeItem(key) { values.delete(key); }
    },
    state: { userId: null, activeSquad: null },
    API_BASE: "/api",
    authHeaders: () => ({ Authorization: "Bearer test" }),
    document: {
      querySelector() { return { click() { calls.tabs += 1; } }; },
      getElementById(id) { return elements[id] || null; }
    },
    setSocialTab() {},
    setCompareMode() {},
    els: { squadCodeInput: { value: "" } },
    joinSquad() { calls.join += 1; },
    toast(message) { calls.toasts.push(message); },
    toastError() {},
    t(key, params) { return params?.name ? `${key}:${params.name}` : key; },
    fetch(url) {
      calls.fetch.push(url);
      return Promise.resolve({ ok: true, status: 201, json: async () => ({}) });
    },
    console
  };
  vm.createContext(context);
  vm.runInContext(linkHandlers, context);
  return { context, values, calls, location, elements };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function run() {
  {
    const { context, values, calls, location } = createContext("?invite=friend-token&joinSquad=ALPHA");
    context.handleInviteLink();
    assert.strictEqual(values.get("sprite-index_pending_friend_invite"), "friend-token");
    assert.strictEqual(location.search, "?joinSquad=ALPHA", "the other deep-link parameter must be preserved");
    assert.strictEqual(calls.fetch.length, 0, "an anonymous visitor must not redeem before login");

    context.state.userId = 42;
    context.handleInviteLink();
    await flush();
    assert.strictEqual(calls.fetch[0], "/api/friends/invite-links/friend-token/use");
    assert.strictEqual(values.get("sprite-index_pending_friend_invite"), undefined, "successful redemption must clear the pending token");
  }

  {
    const { context, values, calls, location } = createContext("?joinSquad=BRAVO");
    context.handleJoinLink();
    assert.strictEqual(values.get("sprite-index_pending_squad_join"), "BRAVO");
    assert.strictEqual(location.search, "", "the squad code must not remain in the visible URL");
    assert.strictEqual(calls.join, 0, "an anonymous visitor must not attempt to join before login");

    context.state.userId = 9;
    context.handleJoinLink();
    assert.strictEqual(context.els.squadCodeInput.value, "BRAVO");
    assert.strictEqual(calls.join, 1, "the pending squad join must resume after login");
    assert.strictEqual(values.get("sprite-index_pending_squad_join"), undefined, "a resumed squad join must clear its pending code");
  }

  {
    const { context, elements } = createContext("?invite=onboarding-token");
    context.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ owner: { displayName: "Quentin" } })
    });
    await context.setupPendingInvitationOnboarding();
    assert.strictEqual(elements.loginInviteNotice.hidden, false, "the invite context must be visible before account creation");
    assert.strictEqual(elements.loginInviteTitle.textContent, "login.friendInviteTitle:Quentin");
  }

  console.log("6 passed, 0 failed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
