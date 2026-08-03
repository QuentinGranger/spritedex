// ── Plan de farm par événement ────────────────────────────────────────────
// The plan is deliberately local-first: it remains useful in guest mode and
// does not claim to schedule a background push when the browser is closed.
const FARM_PLAN_STORAGE_KEY = "sprite-index_farm_plan_v1";
let farmReminderTimers = [];

function farmPlanData() {
  if (state.farmPlan) return state.farmPlan;
  try {
    const saved = JSON.parse(localStorage.getItem(FARM_PLAN_STORAGE_KEY) || "{}");
    state.farmPlan = {
      entries: saved && typeof saved.entries === "object" ? saved.entries : Object.create(null),
      reminders: saved && typeof saved.reminders === "object" ? saved.reminders : Object.create(null),
      notified: saved && typeof saved.notified === "object" ? saved.notified : Object.create(null)
    };
  } catch {
    state.farmPlan = { entries: Object.create(null), reminders: Object.create(null), notified: Object.create(null) };
  }
  return state.farmPlan;
}

function saveFarmPlan() {
  localStorage.setItem(FARM_PLAN_STORAGE_KEY, JSON.stringify(farmPlanData()));
}

function farmSprite(item) {
  return SPRITES.find((sprite) => String(sprite.id) === String(item.spriteId)) || null;
}

function farmContext(item) {
  const sprite = farmSprite(item) || {};
  const variant = sprite.variantDetails?.[item.variantType] || {};
  const eventId = variant.eventId || sprite.eventId || "";
  const availability = variant.availability || sprite.availability || {};
  const status = typeof availability === "string" ? availability : availability.status;
  const confidence = variant.confidence || availability.confidence || sprite.confidence || "unknown";
  const rawSource =
    variant.acquisitionMethod ||
    sprite.acquisitionMethod ||
    variant.sources?.[0]?.title ||
    sprite.sources?.[0]?.title ||
    "";
  const source =
    typeof rawSource === "string" ? rawSource : rawSource?.label || rawSource?.name || rawSource?.title || "";
  return {
    event: EVENTS?.[eventId] || (sprite.event && typeof sprite.event === "object" ? sprite.event : null),
    eventId,
    status: String(status || "unknown").toLowerCase(),
    confidence: String(confidence || "unknown"),
    source: String(source || "")
  };
}

function farmDateLabel(date) {
  const parsed = new Date(date || "");
  if (Number.isNaN(parsed.getTime())) return t("farm.noDeadline");
  return parsed.toLocaleDateString(uiLocale(), { day: "numeric", month: "short", year: "numeric" });
}

function farmDeadline(event) {
  const end = new Date(event?.endDate || "").getTime();
  if (!Number.isFinite(end)) return t("farm.noDeadline");
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (days < 0) return t("farm.ended");
  if (days === 0) return t("farm.endsToday");
  return t("farm.endsIn", { count: days });
}

function farmAvailabilityLabel(status) {
  if (status === "available") return t("farm.available");
  if (status === "unavailable") return t("farm.unavailable");
  return t("farm.availabilityUnknown");
}

function farmStatusLabel(status) {
  return t(`farm.status.${status || "none"}`);
}

function farmStatusFor(item) {
  const planned = farmPlanData().entries[item.id]?.status;
  if (planned) return planned;
  return getEntry(item.id).status === "owned" ? "obtained" : "none";
}

function farmRelevantEvents(items) {
  const grouped = new Map();
  for (const item of items) {
    const context = farmContext(item);
    if (!context.eventId) continue;
    const planStatus = farmPlanData().entries[item.id]?.status;
    const missing = isCollectibleMissingStatus(getEntry(item.id).status);
    if (!missing && !planStatus) continue;
    const event = context.event || { id: context.eventId, name: context.eventId };
    const key = String(context.eventId);
    if (!grouped.has(key)) grouped.set(key, { id: key, event, items: [] });
    grouped.get(key).items.push({ item, context });
  }
  return [...grouped.values()]
    .filter(({ event, items }) => {
      const end = new Date(event.endDate || "").getTime();
      return (
        items.some(({ item }) => farmPlanData().entries[item.id]?.status) || !Number.isFinite(end) || end >= Date.now()
      );
    })
    .sort((a, b) => new Date(a.event.endDate || "2999-01-01") - new Date(b.event.endDate || "2999-01-01"));
}

function farmPlanRow({ item, context }) {
  const status = farmStatusFor(item);
  const image = safeImageUrl(item.img);
  const controls = ["target", "obtained", "abandoned"]
    .map(
      (value) =>
        `<button type="button" class="farm-plan__status ${status === value ? "is-active" : ""}" data-farm-status="${value}" data-farm-id="${escapeHtml(String(item.id))}" aria-pressed="${status === value}">${escapeHtml(farmStatusLabel(value))}</button>`
    )
    .join("");
  return `<article class="farm-plan__row">
    <div class="farm-plan__avatar">${image ? `<img src="${escapeHtml(image)}" alt="" loading="lazy">` : '<span aria-hidden="true">?</span>'}</div>
    <div class="farm-plan__identity"><strong>${escapeHtml(item.spriteName)}</strong><span>${escapeHtml(item.variant)}</span>
      <div class="farm-plan__meta"><span class="farm-chip farm-chip--${escapeHtml(context.status)}">${escapeHtml(farmAvailabilityLabel(context.status))}</span><span class="farm-chip farm-chip--deadline">${escapeHtml(farmDateLabel(context.event?.endDate))}</span>${context.source ? `<span class="farm-chip">${escapeHtml(context.source)}</span>` : ""}<span class="farm-chip farm-chip--confidence">${escapeHtml(t("farm.confidence", { value: context.confidence }))}</span></div>
    </div>
    <div class="farm-plan__controls" aria-label="${escapeHtml(t("farm.statusAria", { name: `${item.spriteName} ${item.variant}` }))}">${controls}</div>
  </article>`;
}

function renderFarmPlan() {
  const mount = document.getElementById("farmPlanner");
  if (!mount) return;
  const events = farmRelevantEvents(getAllItems());
  if (!events.length) {
    mount.innerHTML = `<header class="farm-planner__heading"><div><p class="eyebrow">${escapeHtml(t("farm.eyebrow"))}</p><h3>${escapeHtml(t("farm.title"))}</h3><p>${escapeHtml(t("farm.empty"))}</p></div></header>`;
    return;
  }
  mount.innerHTML = `<header class="farm-planner__heading"><div><p class="eyebrow">${escapeHtml(t("farm.eyebrow"))}</p><h3>${escapeHtml(t("farm.title"))}</h3><p>${escapeHtml(t("farm.description"))}</p></div></header>${events
    .map(({ id, event, items }) => {
      const plan = farmPlanData();
      const targets = items.filter(({ item }) => farmStatusFor(item) === "target").length;
      const reminderOn = Boolean(plan.reminders[id]);
      return `<section class="farm-event-card"><header class="farm-event-card__header"><div><span class="farm-event-card__deadline">${escapeHtml(farmDeadline(event))}</span><h4>${escapeHtml(event.name || id)}</h4><p>${escapeHtml(t("farm.eventProgress", { target: targets, total: items.length }))} · ${escapeHtml(farmDateLabel(event.endDate))}</p></div><label class="farm-reminder"><input type="checkbox" data-farm-reminder="${escapeHtml(id)}" ${reminderOn ? "checked" : ""}><span>${escapeHtml(t("farm.reminder"))}</span></label></header><div class="farm-plan__rows">${items.map(farmPlanRow).join("")}</div></section>`;
    })
    .join("")}`;
  farmScheduleReminders();
}

function farmPlanSetStatus(itemId, status) {
  const plan = farmPlanData();
  plan.entries[itemId] = { status, updatedAt: new Date().toISOString() };
  const entry = getEntry(itemId);
  if (status === "target")
    setEntry(
      itemId,
      { status: "priority", priority: entry.priority === "none" ? "medium" : entry.priority },
      { render: false }
    );
  if (status === "obtained")
    setEntry(itemId, { status: "owned", obtainedAt: entry.obtainedAt || new Date().toISOString() }, { render: false });
  if (status === "abandoned" && entry.status === "priority")
    setEntry(itemId, { status: "missing", priority: "none" }, { render: false });
  saveFarmPlan();
  renderAll();
  toast(farmStatusLabel(status));
}

async function farmPlanSetReminder(eventId, enabled, input) {
  if (enabled && "Notification" in window && Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      input.checked = false;
      toast(t("farm.permissionNeeded"));
      return;
    }
  }
  farmPlanData().reminders[eventId] = Boolean(enabled);
  saveFarmPlan();
  farmScheduleReminders();
  toast(enabled ? t("farm.reminderOn") : t("farm.reminderOff"));
}

function farmScheduleReminders() {
  farmReminderTimers.forEach(clearTimeout);
  farmReminderTimers = [];
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  for (const { id, event } of farmRelevantEvents(getAllItems())) {
    if (!farmPlanData().reminders[id]) continue;
    const due = new Date(event.endDate || "").getTime() - 3 * 86400000;
    const eventEnd = String(event.endDate || "");
    if (!Number.isFinite(due)) continue;
    const notify = () => {
      if (farmPlanData().notified[id] === eventEnd) return;
      new Notification(t("farm.notificationTitle"), { body: t("farm.notificationBody", { event: event.name || id }) });
      farmPlanData().notified[id] = eventEnd;
      saveFarmPlan();
    };
    const delay = due - Date.now();
    if (delay <= 0 && new Date(event.endDate).getTime() > Date.now()) notify();
    else if (delay < 2147483647) farmReminderTimers.push(setTimeout(notify, delay));
  }
}

function setupFarmPlanEvents() {
  const mount = document.getElementById("farmPlanner");
  if (!mount) return;
  mount.addEventListener("click", (event) => {
    const button = event.target.closest("[data-farm-status]");
    if (button) farmPlanSetStatus(button.dataset.farmId, button.dataset.farmStatus);
  });
  mount.addEventListener("change", (event) => {
    const input = event.target.closest("[data-farm-reminder]");
    if (input) farmPlanSetReminder(input.dataset.farmReminder, input.checked, input);
  });
}
