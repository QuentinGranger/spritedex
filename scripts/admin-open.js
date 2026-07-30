#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { spawn } = require("child_process");
const { promptHidden } = require("./admin-terminal");

function resolveAdminOrigin() {
  const raw = process.env.ADMIN_CONSOLE_URL
    || process.env.APP_URL
    || process.env.OAUTH_REDIRECT_BASE
    || `http://localhost:${process.env.PORT || 3000}`;
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
    throw new Error("ADMIN_CONSOLE_URL must be an http(s) origin without credentials.");
  }
  return url.origin;
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

(async () => {
  const origin = resolveAdminOrigin();
  const password = await promptHidden("Admin password: ");
  if (!password) throw new Error("No password entered.");

  const response = await fetch(new URL("/api/admin/terminal/ticket", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.accessUrl) {
    throw new Error(payload.error || "Access denied. Check the password and terminal admin configuration.");
  }

  const access = new URL(payload.accessUrl);
  if (!/^https?:$/.test(access.protocol) || access.pathname !== "/admin/access" || !/^[a-f0-9]{64}$/i.test(access.hash.slice(1))) {
    throw new Error("The server returned an invalid admin access link.");
  }

  console.log("One-time access link created (valid for 5 minutes).");
  console.log(access.toString());
  if (!process.argv.includes("--no-open")) openBrowser(access.toString());
})().catch((error) => {
  console.error(`Unable to open the backoffice: ${error.message}`);
  process.exitCode = 1;
});
