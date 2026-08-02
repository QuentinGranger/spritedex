"use strict";

const MASTERY_MAX_LEVEL = 5;

function normalizeMasteryLevel(entry, status) {
  if (status !== "owned") return 0;
  const level = Number(entry?.masteryLevel);
  return Number.isInteger(level) && level >= 1 && level <= MASTERY_MAX_LEVEL ? level : 1;
}

module.exports = { MASTERY_MAX_LEVEL, normalizeMasteryLevel };
