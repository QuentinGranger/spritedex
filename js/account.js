/* Account behaviour is split into focused scripts in js/account/. */
function setupAccountPanel() {
  const panel = document.getElementById("accountPanel");
  const openBtn = document.getElementById("accountBtn");
  const closeBtn = document.getElementById("accountClose");
  const dashboard = document.getElementById("accountProfileOverview");
  const hero = dashboard?.querySelector(".profile-hero");
  const passport = document.getElementById("collectorPassport");
  const quickNav = document.querySelector(".account-section-nav");
  const profileActions = document.querySelector(".profile-actions");
  Object.assign(globalThis, { panel, openBtn, closeBtn, dashboard, hero, passport, quickNav, profileActions });
  window.SpriteIndexAccount?.initialize();
}
