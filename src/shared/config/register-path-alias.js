"use strict";

// The project currently runs on CommonJS, so browser import maps and
// TypeScript's paths option are not available. This small, explicit resolver
// provides the same stable `@/` source-root alias to server-side modules
// without adding a runtime dependency.
const Module = require("module");
const path = require("path");

const sourceRoot = path.resolve(__dirname, "..", "..");
let installed = false;

function installSourceAlias() {
  if (installed) return;
  installed = true;
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function resolveSpriteIndexSource(request, parent, isMain, options) {
    if (request === "@/" || request.startsWith("@/")) {
      const target = path.resolve(sourceRoot, request.slice(2));
      if (target !== sourceRoot && !target.startsWith(`${sourceRoot}${path.sep}`)) {
        throw new Error(`Invalid @/ import: ${request}`);
      }
      return resolveFilename.call(this, target, parent, isMain, options);
    }
    return resolveFilename.call(this, request, parent, isMain, options);
  };
}

module.exports = { installSourceAlias, sourceRoot };
