"use strict";

const { canViewCollection } = require("./shared");
const { rebuildCompareResult, countVisibleCompareEntries } = require("./cache");

// Hide priorities and notes in a compare result when the requesting user is not
// authorized to see them according to each owner's granular visibility settings.
async function applyCollectionVisibilityFilters(result, reqUser, userMap) {
  if (!result || !result.records) return result;
  const view = async (ownerId, key) => {
    return canViewCollection(reqUser, ownerId, { visibilityKey: key });
  };
  const aId = String(result.users.userA.id);
  const bId = String(result.users.userB.id);
  const [seePriorityA, seeNotesA, seePriorityB, seeNotesB] = await Promise.all([
    view(aId, "priorities"),
    view(aId, "notes"),
    view(bId, "priorities"),
    view(bId, "notes")
  ]);

  const filterRecord = (r) => ({
    ...r,
    userA: {
      ...r.userA,
      priority: seePriorityA ? r.userA.priority : "none",
      note: seeNotesA ? r.userA.note : ""
    },
    userB: {
      ...r.userB,
      priority: seePriorityB ? r.userB.priority : "none",
      note: seeNotesB ? r.userB.note : ""
    }
  });

  const records = result.records.map(filterRecord);
  // Rebuild all derived values after redaction.  In particular, a raw cached
  // complementarity score and `status=priorities` filter must not reveal a
  // priority value that was just hidden in the record payload.
  return rebuildCompareResult(result, records, {
    aEnteredCount: countVisibleCompareEntries(records, "userA"),
    bEnteredCount: countVisibleCompareEntries(records, "userB")
  });
}


module.exports = { applyCollectionVisibilityFilters };
