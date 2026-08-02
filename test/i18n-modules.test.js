const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
function catalogueModules(name, count) {
  return [
    ...Array.from({ length: count }, (_, index) => `js/${name}-${String(index + 1).padStart(2, "0")}.js`),
    `js/${name}.js`
  ];
}

const modules = [
  "js/i18n-locale.js",
  ...catalogueModules("i18n-fr-data", 8),
  ...catalogueModules("i18n-en-data", 8),
  ...catalogueModules("i18n-nl-data", 8),
  ...catalogueModules("i18n-nl-legacy-data", 3),
  "js/i18n-legacy-en-data.js", "js/i18n-legacy.js", "js/i18n-dom.js", "js/i18n-fetch.js", "js/i18n.js"
];

function boot(language) {
  const body = { nodeType: 1, childNodes: [], querySelectorAll: () => [] };
  const document = {
    body, documentElement: {}, title: "", querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => false })
  };
  const window = {
    location: { search: `?lang=${language}` }, navigator: { languages: [language], language },
    fetch: async (_input, init) => init
  };
  const context = vm.createContext({
    window, document, navigator: window.navigator, URLSearchParams, Headers, Request,
    Node: { ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 }, Element: class Element {},
    MutationObserver: class MutationObserver { observe() {} }, Set, Object, String, RegExp, console
  });
  modules.forEach((file) => vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file }));
  return window;
}

const english = boot("en");
assert.strictEqual(english.t("nav.home"), "Home");
assert.strictEqual(english.t("Accueil"), "Home");
assert.strictEqual(english.t("home.intro", { owned: 2, total: 3, percent: 67 }), "2 variants out of 3 collected · 67% progress.");

const dutch = boot("nl");
assert.strictEqual(dutch.t("nav.missing"), "Ontbrekend");
assert.strictEqual(dutch.t("Accueil"), "Home");

console.log("i18n modules: OK");
