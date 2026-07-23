// routes-friends.js — friendships, invitations and privacy-aware social features.
//
// This file is now a thin aggregator. The implementation is split across the
// ./friends/ module for readability:
//   - friends/helpers.js               shared query/util helpers
//   - friends/invite-links-helpers.js  invite-link token helpers
//   - friends/state-machine.js         friendship state machine (applyFriendAction)
//   - friends/routes-lists.js          read-only listing endpoints
//   - friends/routes-requests.js       send/accept/decline/cancel/remove
//   - friends/routes-blocks.js         block/unblock/status
//   - friends/routes-search.js         privacy-safe user search
//   - friends/routes-invite-links.js   invite link CRUD + QR + redeem
//   - friends/routes-squad-invite.js   invite a friend to a squad
//   - friends/routes-notifications.js  notification feed
//
// The require order below is significant: Express matches routes in the order
// they are registered, so static routes must keep being registered before the
// parameterised routes that could otherwise shadow them.
require("./friends/routes-lists");
require("./friends/routes-requests");
require("./friends/routes-blocks");
require("./friends/routes-search");
require("./friends/routes-invite-links");
require("./friends/routes-notifications");

module.exports = {};
