// Compatibility entry point. Squad-stat responsibilities live in focused modules.
const { SQUAD_COMMUNITY_ELIGIBILITY, decomposeCatalogueVsAcquisition, ratePercent } = require("./sprite-graph-squad-stats/shared");
const { ensureSquadDailyStatsTables } = require("./sprite-graph-squad-stats/schema");
const { listEligibleSquadIds } = require("./sprite-graph-squad-stats/eligibility");
const { calculateSquadDailyStats } = require("./sprite-graph-squad-stats/daily");
const { calculateCommunitySquadProgress, getCommunitySquadProgress } = require("./sprite-graph-squad-stats/community");
const { resolveSquadSizeBand, resolveCompletionBand, getSquadCommunityContext } = require("./sprite-graph-squad-stats/context");

module.exports = {
  SQUAD_COMMUNITY_ELIGIBILITY,
  ensureSquadDailyStatsTables,
  listEligibleSquadIds,
  decomposeCatalogueVsAcquisition,
  calculateSquadDailyStats,
  calculateCommunitySquadProgress,
  getCommunitySquadProgress,
  resolveSquadSizeBand,
  resolveCompletionBand,
  getSquadCommunityContext,
  ratePercent
};
