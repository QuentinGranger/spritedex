"use strict";

const nodeGlobals = {
  AbortController: "readonly",
  AbortSignal: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  clearImmediate: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  exports: "writable",
  fetch: "readonly",
  globalThis: "readonly",
  module: "readonly",
  process: "readonly",
  require: "readonly",
  setImmediate: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  structuredClone: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly"
};

const bugFindingRules = {
  "no-constant-binary-expression": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-fallthrough": "error",
  "no-redeclare": "error",
  "no-undef": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-optional-chaining": "error",
  "use-isnan": "error",
  "valid-typeof": "error"
};

// The static browser client still uses ordered global scripts. Lint the new
// CommonJS source tree strictly; server/client/test use bug-finding rules so
// regressions stay visible without forcing a full unused-vars cleanup first.
module.exports = [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: nodeGlobals
    },
    rules: {
      ...bugFindingRules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]
    }
  },
  {
    files: [
      "server/**/*.js",
      "scripts/**/*.js",
      "security.js",
      "security-logger.js",
      "server.js",
      "analytics.js",
      "push-service.js",
      "seed.js",
      "sprite-data.js"
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: nodeGlobals
    },
    rules: {
      ...bugFindingRules
    }
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...nodeGlobals,
        after: "readonly",
        afterEach: "readonly",
        before: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        it: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        document: "readonly",
        window: "readonly"
      }
    },
    rules: {
      ...bugFindingRules,
      // Many integration suites share harness globals across files.
      "no-undef": "off"
    }
  },
  {
    files: ["js/**/*.js", "sw.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        AbortController: "readonly",
        Blob: "readonly",
        CSS: "readonly",
        CustomEvent: "readonly",
        DOMParser: "readonly",
        Document: "readonly",
        Element: "readonly",
        Event: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        Image: "readonly",
        IntersectionObserver: "readonly",
        MutationObserver: "readonly",
        Node: "readonly",
        Notification: "readonly",
        PushManager: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        WebSocket: "readonly",
        Worker: "readonly",
        alert: "readonly",
        atob: "readonly",
        btoa: "readonly",
        caches: "readonly",
        clearInterval: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        crypto: "readonly",
        document: "readonly",
        fetch: "readonly",
        history: "readonly",
        indexedDB: "readonly",
        localStorage: "readonly",
        location: "readonly",
        matchMedia: "readonly",
        navigator: "readonly",
        performance: "readonly",
        queueMicrotask: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        self: "readonly",
        sessionStorage: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        window: "readonly"
      }
    },
    rules: {
      ...bugFindingRules,
      // Ordered classic scripts share globals across files.
      "no-undef": "off",
      "no-redeclare": "off"
    }
  }
];
