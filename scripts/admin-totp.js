#!/usr/bin/env node
"use strict";

const { buildTotpUri, generateTotpSecret, totpAt, decodeBase32 } = require("../server/admin-totp");

const secret = process.argv[2] && !process.argv[2].startsWith("-")
  ? String(process.argv[2]).trim().toUpperCase()
  : generateTotpSecret();

if (!decodeBase32(secret)) {
  console.error("Invalid base32 secret.");
  process.exitCode = 1;
  process.exit(1);
}

const uri = buildTotpUri({ secret });
console.log("Add this single line to your local .env and to the production environment:");
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log("\nOptional: force MFA even before the secret is set (ticket issue will fail closed):");
console.log("ADMIN_REQUIRE_MFA=true");
console.log("\nScan or import this otpauth URI in an authenticator app:");
console.log(uri);
console.log(`\nCurrent code (for a quick smoke test): ${totpAt(decodeBase32(secret))}`);
