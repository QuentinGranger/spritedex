"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const documentsDirectory = path.join(root, "js", "legal-content", "fr");
const expectedDocuments = [
  "mentions-legales",
  "politique-confidentialite",
  "cgu",
  "regles-communautaires",
  "cookies",
  "donnees-personnelles",
  "suppression-compte",
  "contact",
  "signalement",
  "licences"
];

for (const id of expectedDocuments) {
  const source = fs.readFileSync(path.join(documentsDirectory, `${id}.js`), "utf8");
  assert.ok(source.split("\n").length <= 500, `legal document ${id} exceeds the 500-line module limit`);
}

const legal = require(path.join(root, "js", "legal-content"));
assert.ok(legal.LEGAL_VALIDATION.valid, legal.LEGAL_VALIDATION.errors.join("; "));
assert.deepStrictEqual(
  Object.keys(legal.LEGAL_DOCUMENTS),
  expectedDocuments,
  "French legal documents must retain their order"
);

for (const lang of ["fr", "en", "nl"]) {
  for (const id of expectedDocuments) {
    const document = legal.getLegalDocument(id, lang);
    assert.ok(document && document.content, `${lang}:${id} is missing`);
    assert.ok(!/\[[A-Z0-9_]+\]/.test(document.content), `${lang}:${id} has unresolved placeholders`);
  }
}

console.log("legal content modules: ok");
