"use strict";

// Compatibility facade. News parsing, sources, extraction and delivery are isolated by concern.
require("./news/routes");

const parsing = require("./news/parsing");
const sources = require("./news/sources");
const events = require("./news/events");
const catalog = require("./news/catalog");
const delivery = require("./news/delivery");
const refresh = require("./news/refresh");
const cron = require("./news/cron");

module.exports = { ...parsing, ...sources, ...events, ...catalog, ...delivery, ...refresh, startNewsCron: cron.startNewsCron };
Object.defineProperty(module.exports, "newsInterval", { enumerable: true, get: cron.getNewsInterval });
