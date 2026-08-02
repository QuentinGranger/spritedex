"use strict";

// The static browser client still uses ordered global scripts. Lint the new
// CommonJS source tree independently until that client is converted to ESM.
module.exports = [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        fetch: "readonly"
      }
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-dupe-keys": "error",
      "no-fallthrough": "error",
      "no-redeclare": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }]
    }
  }
];
