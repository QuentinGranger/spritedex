"use strict";

const analytics = require("../../analytics");
const security = require("../../security");
const secLog = require("../../security-logger");
const { areFriends, canViewCollection, checkPrivacyAccess, getCollectionAccessReason, getRequestingUser, getVisibility, hashCapabilityToken, isBlocked, requireNotSuspended, shareSquad } = require("../auth");
const { buildAcquisitionMethod, buildAvailability, buildRecurrence, dedupeSpritesBySlug } = require("../catalog");
const { APP_URL, app } = require("../core");
const { pool } = require("../db");
const comparisonSessions = require("../comparison-sessions");
const crypto = require("crypto");
const QRCode = require("qrcode");

module.exports = { analytics, security, secLog, areFriends, canViewCollection, checkPrivacyAccess, getCollectionAccessReason, getRequestingUser, getVisibility, hashCapabilityToken, isBlocked, requireNotSuspended, shareSquad, buildAcquisitionMethod, buildAvailability, buildRecurrence, dedupeSpritesBySlug, APP_URL, app, pool, comparisonSessions, crypto, QRCode };
