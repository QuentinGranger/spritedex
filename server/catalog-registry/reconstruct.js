"use strict";

const { reduceEvents } = require("./reduce");
const { loadEvents } = require("./append");

async function reconstructEntity(db, entityType, entityId, client = null) {
  const runner = client || db;
  const events = await loadEvents(runner, entityType, entityId);
  if (!events.length) return { events: [], state: null };
  const state = reduceEvents(events, { entityType, entityId });
  return { events, state };
}

module.exports = { reconstructEntity };
