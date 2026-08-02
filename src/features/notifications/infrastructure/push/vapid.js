"use strict";

const crypto = require("crypto");
const webpush = require("web-push");
const fs = require("fs");
const path = require("path");

// Keep the persisted fallback in its historical location. Moving this module
// must not rotate browser subscriptions on an application upgrade.
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..", "..");
const VAPID_FILE = path.join(PROJECT_ROOT, ".vapid-keys.json");
const DEFAULT_VAPID_SUBJECT = "mailto:contact@sprite-index.com";

function isValidVapidKeys(value) {
  return !!(
    value &&
    typeof value.publicKey === "string" &&
    value.publicKey.length > 0 &&
    typeof value.privateKey === "string" &&
    value.privateKey.length > 0
  );
}

function readStoredVapidKeys(filePath = VAPID_FILE) {
  // Open without following links, then inspect and chmod the *open file
  // descriptor*. `lstat` followed by `chmod/readFile(path)` would leave a
  // time-of-check/time-of-use window for a local symlink replacement.
  const noFollow = fs.constants.O_NOFOLLOW;
  if (!noFollow) throw new Error("Secure VAPID key reads require O_NOFOLLOW support");
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow);
  try {
    const stats = fs.fstatSync(fd);
    // Refuse special files. A secret file must be a regular file owned and
    // controlled by the deployment, never an arbitrary device/pipe.
    if (!stats.isFile()) throw new Error("VAPID key file must be a regular file");

    // Existing installations may have been created with the process umask.
    // Apply permissions through the descriptor so they cannot be redirected.
    fs.fchmodSync(fd, 0o600);

    const saved = JSON.parse(fs.readFileSync(fd, "utf8"));
    if (!isValidVapidKeys(saved)) {
      // Do not silently replace malformed existing material: replacing it
      // would invalidate subscriptions and could conceal tampering.
      throw new Error("VAPID key file is missing a public or private key");
    }
    return {
      publicKey: saved.publicKey,
      privateKey: saved.privateKey,
      subject: saved.subject || process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
    };
  } finally {
    fs.closeSync(fd);
  }
}

function createVapidKeysFile(filePath, keys) {
  // Write the complete payload to a private temporary file, then publish it
  // with `link`. Unlike `rename`, link fails when the destination already
  // exists, so a concurrent process (or a pre-existing file) is never
  // overwritten. The published file is therefore both complete and 0600.
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(16).toString("hex")}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(keys, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.linkSync(temporaryPath, filePath);
  } finally {
    if (fd != null) fs.closeSync(fd);
    // The destination has its own hard link after publication. If publishing
    // failed, this only removes our private, incomplete temporary file.
    try {
      fs.unlinkSync(temporaryPath);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}

function loadOrCreateVapidKeys(filePath = VAPID_FILE) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      subject: process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
    };
  }

  try {
    return readStoredVapidKeys(filePath);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("[PUSH] Refusing to replace existing VAPID keys:", err.message);
      throw err;
    }
  }

  const generated = webpush.generateVAPIDKeys();
  const keys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    subject: process.env.VAPID_SUBJECT || DEFAULT_VAPID_SUBJECT
  };
  try {
    createVapidKeysFile(filePath, keys);
    console.log("[PUSH] Generated and saved new VAPID keys to", filePath);
    return keys;
  } catch (err) {
    // A concurrent process may have created the key file first. Read that
    // material rather than overwrite it; any other failure is unsafe to hide.
    if (err.code === "EEXIST") return readStoredVapidKeys(filePath);
    console.error("[PUSH] Failed to create VAPID key file:", err.message);
    throw err;
  }
}

const vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails(vapidKeys.subject, vapidKeys.publicKey, vapidKeys.privateKey);

function getVapidPublicKey() {
  return vapidKeys.publicKey;
}

module.exports = { getVapidPublicKey };
