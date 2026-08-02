// Squad route registry. Feature modules register their existing HTTP endpoints in order.
require("./squad/routes-create");
require("./squad/routes-members");
require("./squad/routes-invitations");
require("./squad/routes-history");
require("./squad/routes-analysis");
require("./squad/routes-completion");
require("./squad/routes-matrix");
require("./squad/routes-redirect");

const { generateSquadCode } = require("./squad/context");
module.exports = { generateSquadCode };
