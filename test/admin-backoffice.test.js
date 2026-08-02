"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "admin.html"), "utf8");
const client = fs.readFileSync(path.join(root, "js", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(root, "css", "admin.css"), "utf8");
const routes = fs.readFileSync(path.join(root, "server", "routes-admin-operations.js"), "utf8");
const profileRoutes = fs.readFileSync(path.join(root, "server", "routes-profile.js"), "utf8");
const authRoutes = fs.readFileSync(path.join(root, "server", "routes-auth.js"), "utf8");
const adminAccess = fs.readFileSync(path.join(root, "server", "admin-access.js"), "utf8");
const adminAudit = fs.readFileSync(path.join(root, "server", "admin-audit.js"), "utf8");
const graphAdmin = fs.readFileSync(path.join(root, "server", "routes-sprite-graph-admin.js"), "utf8");
const schema = fs.readFileSync(path.join(root, "server", "schema.js"), "utf8");
const publicNews = fs.readFileSync(path.join(root, "server", "news.js"), "utf8");

for (const tab of ["overview", "players", "catalog", "events", "collections", "social", "notifications", "intelligence", "passports", "privacy"]) {
  assert.match(html, new RegExp(`data-admin-tab="${tab}"`), `missing ${tab} navigation item`);
  assert.match(html, new RegExp(`data-admin-panel="${tab}"`), `missing ${tab} panel`);
}

for (const endpoint of [
  "/api/admin/overview", "/api/admin/players", "/api/admin/catalog", "/api/admin/events",
  "/api/admin/collections/integrity", "/api/admin/social", "/api/admin/notifications/operations",
  "/api/admin/passports", "/api/admin/privacy", "/suspension-history"
]) {
  assert.ok(routes.includes(endpoint), `missing protected operational endpoint ${endpoint}`);
}

assert.match(routes, /app\.get\("\/api\/admin\/players\/:userId"/, "player dossier endpoint must exist");
assert.match(routes, /catalog_synced_at|notifications_stuck|passport_synced_at/, "overview health must measure freshness and blocked background jobs");
assert.match(routes, /pg_postmaster_start_time|latencyMs/, "overview health must measure real database latency and status");
assert.match(routes, /security_migrations[\s\S]*admin_named_operators_v1/, "overview health must detect missing required migrations");
assert.match(fs.readFileSync(path.join(root, "server", "ws.js"), "utf8"), /getWebSocketHealth|authFailures|wsHealth/, "websocket health must expose real errors and authentication failures");
assert.match(html, /id="overviewHealthCards"|id="overviewHealthStamp"|id="overviewHealthSummary"/, "overview must expose a dedicated real-health panel");
assert.match(client, /freshnessLabel|overviewHealthCard|overviewHealthSummary/, "overview UI must render freshness and service-health states");
assert.match(client, /data-go-tab=.*tab|overviewHealthCard\(.*"catalog"/, "health alerts must link directly to the relevant operational tab");
assert.match(routes, /reporter_username/, "reports must expose reporter identity");
assert.match(routes, /resolved_with_suspension|alsoSuspend|body\.suspend/, "moderators must be able to resolve and suspend together");
assert.match(html, /id="playerDossier"/, "moderation dossier panel must exist");
assert.match(html, /id="reportDecisionDialog"/, "report decisions must use an accessible dialog");
assert.match(client, /selectPlayer|renderPlayerDossier/, "client must open the player moderation dossier");
assert.match(client, /Resolve \+ suspend|Résoudre \+ suspendre/, "UI must offer resolve-and-suspend");
assert.match(client, /closeRelatedOpenReports|reportDecisionCloseRelated/, "UI must offer closing related open reports");
assert.match(routes, /closeRelatedOpenReports|closedRelated/, "API must support closing related open reports");
assert.match(schema, /user_reports[\s\S]*priority[\s\S]*appeal_status/, "reports must persist priority and appeal lifecycle");
assert.match(routes, /REPORT_PRIORITIES|priority = COALESCE/, "moderation must validate and preserve report priority");
assert.match(routes, /admin_notes|appeal_message|appeal_resolution/, "admin notes and appeal decisions must be stored server-side");
assert.match(routes, /\/api\/admin\/reports\/:reportId\/appeal/, "appeal processing needs a protected API");
assert.match(client, /reportDecisionPriority|reportDecisionInternalNote/, "moderators must be able to set a priority and private note");
assert.match(client, /handleReportAppeal|data-report-appeal/, "player dossiers must expose appeal history and handling");
assert.match(html, /id="reportPriorityFilter"|id="reportTriage"/, "report triage must expose an accessible priority filter");
assert.match(routes, /CASE ur\.priority WHEN 'urgent'/, "open reports must be ordered by operational priority");
assert.match(routes, /priorityCounts/, "report triage must receive complete priority facets");
assert.doesNotMatch(client, /async function handleReportAction[\s\S]{0,400}window\.prompt/, "report decisions must not use prompt dialogs");

assert.match(routes, /requireAdminCapability/, "operational endpoints must require the admin session and capability");
assert.match(routes, /app\.get\("\/api\/admin\/audit", requireAdminCapability\("audit\.read"\)/, "the audit journal must have a dedicated protected endpoint");
assert.match(routes, /app\.get\("\/api\/admin\/audit\/export", requireAdminCapability\("audit\.read"\)/, "audit export must remain capability-protected");
assert.match(routes, /safeAuditDetails|AUDIT_PRIVATE_DETAIL_KEY/, "audit responses must redact sensitive operational fields");
assert.match(routes, /MAX_AUDIT_EXPORT_ROWS/, "audit exports must be bounded");
assert.match(routes, /admin_audit_log/, "administrative mutations must be auditable");
assert.match(routes, /reason.*requis|justification.*requise/i, "sensitive actions require a justification");
assert.match(schema, /suspension_source[\s\S]*'self'[\s\S]*'admin'/, "schema must distinguish self-service and admin suspensions");
assert.match(routes, /suspension_source\s*=\s*CASE WHEN \$2 THEN 'admin'/, "admin suspensions must be marked as admin-owned");
assert.match(routes, /DELETE FROM sessions WHERE user_id = \$1/, "admin suspension must revoke active sessions");
assert.match(routes, /suspension-history/, "administrators must be able to review suspension history");
assert.match(routes, /INSERT INTO admin_audit_log[\s\S]*player\.suspended|writeAdminAudit[\s\S]*player\.suspended/, "suspension and audit history must be written together");
assert.match(
  profileRoutes,
  /suspension_source IS DISTINCT FROM 'admin' OR suspended_until <= NOW\(\)/,
  "self-service suspension routes must not override an active admin suspension"
);
assert.match(authRoutes, /adminSuspended[\s\S]*Compte suspendu par un administrateur/, "admin-suspended users must not receive new login sessions");
assert.match(schema, /admin_access_tickets/, "admin tickets must be durable across instances");
assert.match(schema, /admin_access_sessions/, "admin sessions must be durable across instances");
assert.match(adminAccess, /INSERT INTO admin_access_tickets/, "ticket issuance must persist to Postgres");
assert.match(adminAccess, /INSERT INTO admin_access_sessions/, "session creation must persist to Postgres");
assert.match(adminAccess, /ADMIN_OPERATOR_LABEL|resolveOperatorLabel/, "operators must be attributable beyond a shared terminal label");
assert.match(adminAccess, /max_expires_at|ADMIN_SESSION_MAX_TTL_MS/, "admin sessions must have an absolute expiry ceiling");
assert.match(adminAccess, /ADMIN_MAX_CONCURRENT_SESSIONS|enforceConcurrentSessionLimit/, "concurrent admin sessions must be capped");
assert.match(adminAccess, /session\.context_changed|ipChanged/, "admin sessions must audit material client-context changes");
assert.match(schema, /admin_operators|admin_security_alerts/, "named admin accounts and persistent security alerts must be stored durably");
assert.match(adminAccess, /verifyAdminOperatorCredentials|rotateAdminOperatorSecret/, "named admin credentials and secret rotation must be implemented server-side");
assert.match(fs.readFileSync(path.join(root, "server", "routes-admin.js"), "utf8"), /terminalIdentityLimiter|keyGenerator/, "admin login attempts must be limited per address and identity");
assert.match(fs.readFileSync(path.join(root, "server", "routes-admin.js"), "utf8"), /\/api\/admin\/operators|security-alerts/, "owner operations must manage named admins and security alerts");
assert.match(adminAccess, /unusualLogin|security\.unusual_login/, "unusual named-admin logins must generate an auditable alert");
assert.match(html, /id="adminOperators"|id="adminSecurityAlerts"/, "admin access and security alerts must be visible in the backoffice");
assert.match(client, /openAdminOperatorDialog|toggleAdminOperator|acknowledgeSecurityAlert/, "backoffice must create, rotate and control named admin access");
assert.match(adminAudit, /async function writeAdminAudit/, "admin audit writes must be centralized");
assert.match(adminAudit, /withAdminAudit/, "mutations must be able to commit with their audit row");
assert.match(adminAudit, /requireJustification/, "mutation audits must require a justification by default");
assert.match(adminAudit, /class AdminHttpError/, "audit helpers must expose typed HTTP errors");
assert.doesNotMatch(routes, /audit write failed[\s\S]{0,80}catch/, "operational audit failures must not be swallowed");
assert.match(routes, /Événement et justification requis|Actualité et justification requises/, "event and news creation must require a justification");
assert.match(routes, /withAdminAudit[\s\S]*event\.created/, "event creation must audit atomically");
assert.match(routes, /withAdminAudit[\s\S]*news\.created/, "news creation must audit atomically");
assert.match(routes, /withAdminAudit[\s\S]*event\.updated/, "event updates must audit atomically");
assert.match(routes, /withAdminAudit[\s\S]*news\.updated/, "news updates must audit atomically");
assert.match(routes, /withAdminAudit[\s\S]*catalog\.updated/, "catalog updates must audit atomically");
assert.match(routes, /editorial_status|EDITORIAL_STATUSES/, "catalog workflow states must be stored and validated server-side");
assert.match(routes, /catalog\/:spriteId\/workflow|catalog\.workflow_/, "sprites must support auditable editorial transitions");
assert.match(routes, /catalog\/bulk-workflow|catalog\.bulk_workflow/, "catalog must support bounded auditable bulk workflow updates");
assert.match(routes, /events\/bulk-status|event\.bulk_status/, "events must support bounded auditable bulk status updates");
assert.match(html, /id="catalogBulkBar"|id="eventsBulkBar"|id="bulkActionDialog"/, "bulk actions need selection controls and a confirmation dialog");
assert.match(client, /openBulkAction|submitBulkAction|bulkIds/, "client must preview and execute selected bulk actions");
assert.match(routes, /variants\/:variantId\/workflow|variant_workflow_/, "variants must support editorial transitions");
assert.match(routes, /history\/:historyId\/rollback|catalog\.rollback/, "catalog history must support audited rollback");
assert.match(routes, /withAdminAudit[\s\S]*report\.\$\{status\}|withAdminAudit[\s\S]*report\./, "report resolutions must audit atomically");
assert.match(routes, /notification\.queue_process_requested/, "queue flushes must audit the decision before side effects");
assert.match(graphAdmin, /writeAdminAudit|withAdminAudit/, "sprite graph flag changes must enter admin_audit_log");
assert.match(graphAdmin, /Une justification est requise/, "sprite graph flag changes must require a justification");
assert.match(graphAdmin, /graph\.metric_suspended|graph\.metric_restored/, "sprite graph flag audits must name the action");
assert.match(graphAdmin, /AdminHttpError/, "sprite graph flag errors must expose typed HTTP failures");
assert.match(routes, /actor: adminActorFromReq\(req\)/, "operational audits must record the authenticated admin actor");
assert.match(html, /id="playerSuspensionDialog"/, "suspension actions must use an accessible dialog");
assert.match(html, /id="adminSessionBadge"/, "operators must see the durable session identity");
assert.match(html, /id="revokeOtherSessions"/, "operators must be able to revoke concurrent sessions");
assert.match(html, /id="adminReasonDialog"/, "audited quick actions must use an accessible reason dialog");
assert.match(html, /id="auditSearch"/, "the audit journal must support direct search");
assert.match(html, /id="auditDetailDialog"/, "the audit journal must expose a detail view");
assert.match(html, /id="auditExportButton"/, "the audit journal must offer an export action");
assert.match(client, /requestReason|adminReasonForm/, "audited quick actions must collect a structured justification");
assert.match(client, /loadAudit|openAuditDetail|exportAudit/, "the client must load, inspect and export the audit journal");
assert.match(client, /details\.changes/, "audit detail views must render before\/after change snapshots");
assert.doesNotMatch(client, /window\.prompt/, "the backoffice must not use blocking native prompts");
assert.doesNotMatch(html, /localhost(?::\d+)?/i, "the backoffice shell must not hardcode a local deployment URL");
assert.match(client, /bootstrapSession|\/api\/admin\/session/, "client must hydrate the durable admin session");
assert.match(client, /Why restore|Pourquoi rétablir/, "restoring a suspended metric must also require a justification");
assert.doesNotMatch(client, /async function handlePlayerAction[\s\S]{0,500}window\.prompt/, "player suspension must not use prompt dialogs");
assert.match(client, /data-admin-tab/, "client must wire tab navigation");
assert.match(html, /id="eventEditorDialog"/, "events must use an accessible editor dialog");
assert.match(html, /id="newsEditorDialog"/, "news must use an accessible editor dialog");
assert.match(html, /id="variantEditorDialog"/, "variants must use an accessible editor dialog");
assert.match(html, /id="availabilityEditorDialog"/, "availability must use an accessible editor dialog");
assert.match(client, /openEventEditor|submitEventEditor/, "client must drive the event editor dialog");
assert.match(client, /openNewsEditor|submitNewsEditor/, "client must drive the news editor dialog");
assert.match(client, /openVariantEditor|openAvailabilityEditor/, "client must drive catalog secondary editors");
assert.match(client, /setCatalogWorkflow|setVariantWorkflow|rollbackCatalogHistory/, "client must drive catalog workflow and rollback actions");
assert.match(client, /retryFailedNotifications/, "client must support batch notification recovery");
assert.match(routes, /notifications\/retry-failed|failed_batch_retried/, "notification failures must support auditable batch retry");
assert.doesNotMatch(client, /function createEvent[\s\S]{0,900}window\.prompt/, "event creation must not use prompt dialogs");
assert.doesNotMatch(client, /function createNews[\s\S]{0,900}window\.prompt/, "news creation must not use prompt dialogs");
assert.doesNotMatch(client, /function openVariantEditor[\s\S]{0,600}window\.prompt/, "variant edits must not use prompt dialogs");
assert.doesNotMatch(client, /function openAvailabilityEditor[\s\S]{0,600}window\.prompt/, "availability creation must not use prompt dialogs");
assert.doesNotMatch(client, /async function editEvent[\s\S]{0,500}window\.prompt/, "event edits must not use prompt dialogs");
assert.doesNotMatch(client, /async function updateNewsStatus[\s\S]{0,500}window\.prompt/, "news publish/archive must not use prompt dialogs");
assert.match(routes, /fanoutPublishedNews/, "admin news publish must fan out to players");
assert.match(routes, /app\.get\("\/api\/admin\/news\/:newsId"/, "news editor needs a detail endpoint");
assert.match(routes, /app\.get\("\/api\/admin\/events\/:eventId"/, "event editor needs a detail endpoint");
assert.match(routes, /previousStatus !== "published"/, "news fan-out must run on first publish only");
assert.match(publicNews, /async function fanoutPublishedNews/, "news module must expose admin publish fan-out");
assert.match(html, /id="newsEditorFanoutWarning"/, "news editor must warn before fan-out");
assert.match(html, /admin-news-preview|newsEditorPreviewTitle/, "news editor must show a player-facing preview");
assert.match(html, /id="newsStatusFilter"/, "editorial tab must filter news by status");
assert.match(client, /willFanoutNews|syncNewsEditorChrome|refreshNewsPreview/, "client must preview news and detect first publish");
assert.match(client, /previousStatus|forceStatus/, "publish actions must preserve the prior status for fan-out detection");
assert.match(client, /name="color"|name="eventId"|name="seasonId"|name="effect"/, "catalog editor must expose the editable sprite fields");
assert.match(routes, /SELECT COUNT\(\*\).*FROM squad_members sm[\s\S]*WHERE sm\.squad_id = s\.id/, "squad member counts must not use cartesian JOIN inflation");
assert.doesNotMatch(
  routes,
  /FROM squads s\s+LEFT JOIN squad_members sm[\s\S]{0,200}LEFT JOIN squad_wishlist_items/,
  "social squad list must not multiply rows via wishlist/activity joins"
);
assert.match(routes, /app\.get\("\/api\/admin\/social\/squads\/:squadId"/, "social ops need a squad detail endpoint");
assert.match(html, /id="squadDossier"/, "social tab must expose a squad ops dossier");
assert.match(html, /id="socialPendingInvites"/, "social tab must list pending invitations");
assert.match(html, /id="socialRecentBlocks"/, "social tab must list recent blocks");
assert.match(html, /id="squadAccessDialog"/, "squad access changes must use an accessible dialog");
assert.match(html, /id="squadInviteCancelDialog"/, "invitation cancellation must use an accessible dialog");
assert.match(html, /id="squadSearch"|id="squadJoinFilter"/, "social tab must support squad search and join filters");
assert.match(html, /id="socialPendingFriends"/, "social tab must surface pending friend requests");
assert.match(client, /openSquadAccessDialog|submitSquadAccess/, "client must drive the squad access dialog");
assert.match(client, /openSquadInviteCancelDialog|submitSquadInviteCancel/, "client must drive invitation cancellation");
assert.doesNotMatch(client, /function openSquadAccessDialog[\s\S]{0,200}window\.prompt|async function toggleSquad[\s\S]{0,400}window\.prompt/, "squad access must not use prompt dialogs");
assert.match(routes, /invitations\/:invitationId\/cancel/, "admins must be able to cancel pending squad invitations");
assert.match(routes, /req\.query\.q|joinFilter/, "social squad list must support search and join filters");
assert.match(html, /id="privacyDeletionQueue"/, "privacy tab must list the deletion queue");
assert.match(html, /id="privacyPurgeDialog"/, "account purge must use an accessible dialog");
assert.match(html, /id="privacyExportDialog"/, "data export must use an accessible dialog");
assert.match(client, /openPrivacyPurgeDialog|submitPrivacyPurge/, "client must drive privacy purge");
assert.match(client, /openPrivacyExportDialog|submitPrivacyExport/, "client must drive privacy export");
assert.match(routes, /\/api\/admin\/privacy\/purge/, "admins must be able to purge deleted accounts");
assert.match(routes, /\/api\/admin\/privacy\/export\/:userId/, "admins must be able to export personal data");
assert.match(routes, /privacy\.export_generated|privacy\.accounts_purged|privacy\.account_purged/, "privacy mutations must be audited");
assert.match(fs.readFileSync(path.join(root, "server", "privacy-ops.js"), "utf8"), /async function purgeDeletedAccounts/, "purge logic must be centralized");
assert.match(html, /id="privacyRestoreDialog"/, "soft-delete restore must use an accessible dialog");
assert.match(html, /id="privacyRevokeLinksDialog"/, "share-link revocation must use an accessible dialog");
assert.match(html, /id="privacyDeletionFilter"/, "deletion queue must be filterable");
assert.match(client, /openPrivacyRestoreDialog|submitPrivacyRestore/, "client must restore soft-deleted accounts");
assert.match(client, /openPrivacyRevokeLinksDialog|submitPrivacyRevokeLinks/, "client must revoke active share links");
assert.match(client, /privacyPurgeConfirm|Type .* to confirm|Tapez/, "purge confirmation must require typing the username");
assert.match(routes, /\/api\/admin\/privacy\/restore/, "admins must be able to restore soft-deleted accounts");
assert.match(routes, /\/api\/admin\/privacy\/revoke-share-links/, "admins must be able to revoke active share links");
assert.match(routes, /privacy\.account_restored|privacy\.share_links_revoked/, "restore and link revocation must be audited");
assert.match(routes, /app\.get\("\/api\/admin\/search"/, "backoffice must expose a universal search endpoint");
assert.match(routes, /squad_invitations|notification_delivery_queue|admin_audit_log/, "universal search must cover operational records beyond catalog");
assert.match(routes, /friend_invite_links/, "universal search must include friend invitation links without exposing their token");
assert.match(html, /id="adminUniversalSearch"|id="adminSearchDialog"/, "backoffice must expose the universal search palette");
assert.match(client, /openUniversalSearch|searchUniversally|openUniversalResult/, "client must provide universal search interactions");
assert.match(client, /moveUniversalSelection|data-universal-filter/, "universal search must support keyboard navigation and result filters");
assert.match(client, /universalQuickActions|renderUniversalQuickActions/, "universal search must provide safe quick actions before a query");
assert.match(routes, /sv_preview\.image_path|si_preview\.image_path/, "admin catalog lists must fall back to variant images when a sprite image is absent");
assert.match(client, /adminCatalogImage|adminImageUrl/, "admin catalog UI must normalize local sprite image paths");
assert.match(routes, /same_name_records|data_issues/, "admin catalog must surface duplicate candidates and isolated records as data issues");
assert.match(routes, /canonical\.id LIKE 'sprite\\\\_%'|compatibilityVariants/, "admin catalog must hide legacy short ids from the primary view and support seeded variants");
assert.match(client, /renderCatalogEmptyState|data-catalog-show-issues/, "catalog inspector must guide admins toward data issues before a selection");
assert.match(css, /\.admin-bulk-bar\[hidden\].*display: none !important/, "hidden bulk actions must never occupy the catalog layout");

const authz = fs.readFileSync(path.join(root, "server", "admin-authz.js"), "utf8");
const totp = fs.readFileSync(path.join(root, "server", "admin-totp.js"), "utf8");
const accessPage = fs.readFileSync(path.join(root, "admin-access.html"), "utf8");
const accessClient = fs.readFileSync(path.join(root, "js", "admin-access.js"), "utf8");
const adminRoutes = fs.readFileSync(path.join(root, "server", "routes-admin.js"), "utf8");
assert.match(authz, /ROLE_CAPABILITIES|resolveOperatorRole|hasCapability/, "admin AuthZ must define roles and capabilities");
assert.match(authz, /privacy\.purge/, "destructive privacy actions must be capability-gated");
assert.match(totp, /verifyTotpCode|isAdminMfaConfigured/, "admin MFA must verify TOTP codes");
assert.match(totp, /consumeTotpCode|matchTotpCode/, "MFA codes must be single-use against replay");
assert.match(adminAccess, /role, expires_at|actor_label, role/, "admin sessions must persist the operator role");
assert.match(adminAccess, /consumeTotpCode|AdminAccessError|peekAdminTicket/, "ticket consume must support MFA without burning the ticket on failure");
assert.match(adminRoutes, /requireAdminCapability/, "session routes must expose capability middleware");
assert.match(adminRoutes, /\/api\/admin\/terminal\/challenge/, "access page must be able to challenge a ticket before MFA");
assert.match(adminRoutes, /requireAdminStepUp|ADMIN_STEPUP_REQUIRED/, "destructive privacy actions must require MFA step-up");
assert.match(routes, /requireAdminCapability\("privacy\.purge"\)/, "purge must require the privacy.purge capability");
assert.match(routes, /requireAdminCapability\("players\.moderate"\)/, "moderation writes must require players.moderate");
assert.match(routes, /requireAdminCapability\("catalog\.write"\)/, "catalog mutations must require catalog.write");
assert.match(routes, /requireAdminStepUp/, "privacy mutations must chain the step-up middleware");
assert.match(graphAdmin, /intelligence\.write|intelligence\.read/, "sprite graph terminal access must honor intelligence capabilities");
assert.match(html, /data-requires-cap="privacy\.purge"/, "UI must hide purge actions without capability");
assert.match(html, /id="adminRolesNote"/, "privacy panel must describe the active role");
assert.match(html, /data-stepup-field|id="privacyPurgeMfa"/, "privacy dialogs must collect step-up MFA");
assert.match(html, /id="adminCapabilityList"/, "privacy panel must list active capabilities");
assert.match(client, /function can\(|applyAuthz|data-requires-cap/, "client must mirror server-side capabilities");
assert.match(client, /needsStepUp|stepUpHeaders|assertStepUp/, "client must send step-up MFA for privacy writes");
assert.match(client, /function can\([\s\S]*return false/, "capability checks must fail closed before session hydration");
assert.match(accessPage, /id="accessMfaForm"/, "access page must collect MFA when configured");
assert.match(accessClient, /\/api\/admin\/terminal\/challenge|totp/, "access client must challenge then submit MFA");
assert.match(schema, /admin_totp_replays/, "TOTP replay protection must be durable");

console.log("admin backoffice surface: ok");
