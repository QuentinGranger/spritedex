/* DOM translation and dynamic-content observer. */
window.SpriteIndexI18nDom = Object.freeze({
  install({ locale, translateLegacy, messageForKey }) {
    function applyDocumentMetadata() {
  document.title = locale === "en"
    ? "SPRITE-INDEX — Fortnite Collection Tracker"
    : locale === "nl"
      ? "SPRITE-INDEX — Fortnite-collectietracker"
      : "SPRITE-INDEX — Checklist Fortnite";
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute("content", locale === "en"
      ? "Your Sprite collection — checklist, farm plan and stats. Works offline."
      : locale === "nl"
        ? "Jouw Sprite-collectie — checklist, farmlijst en stats. Werkt offline."
        : "Ta collection de sprites — checklist, farm list, statistiques. Fonctionne hors ligne.");
  }
}

function translateTextNode(node) {
  if (!node || !node.nodeValue || !node.nodeValue.trim()) return;
  const parent = node.parentElement;
  if (!parent || parent.closest("script, style, code, pre, textarea")) return;
  if (parent.hasAttribute("data-i18n")) return;
  const translated = translateLegacy(node.nodeValue);
  if (translated !== node.nodeValue) node.nodeValue = translated;
}

const ATTRIBUTES = ["placeholder", "title", "aria-label", "aria-description", "alt", "value"];

function setKeyedText(element, key) {
  const text = messageForKey(key);
  if (text == null) return;
  const textChildren = [...element.childNodes].filter(
    (node) => node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()
  );
  if (textChildren.length === 1 && element.children.length > 0) {
    textChildren[0].nodeValue = textChildren[0].nodeValue.replace(
      textChildren[0].nodeValue.trim(),
      text
    );
    return;
  }
  if (element.children.length === 0) {
    element.textContent = text;
    return;
  }
  // Mixed markup (icon + label): prefer a dedicated child when present.
  const label = element.querySelector("[data-i18n], .tab__label, .onboarding-choice__label");
  if (label && label !== element) {
    label.textContent = text;
    return;
  }
  element.textContent = text;
}

function applyI18n(root = document.body) {
  if (!root) return;
  const scope = root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
    ? root
    : null;
  if (!scope || !scope.querySelectorAll) return;

  const nodes = [];
  if (scope.hasAttribute && (
    scope.hasAttribute("data-i18n")
    || scope.hasAttribute("data-i18n-placeholder")
    || scope.hasAttribute("data-i18n-title")
    || scope.hasAttribute("data-i18n-aria-label")
    || scope.hasAttribute("data-i18n-alt")
    || scope.hasAttribute("data-i18n-label")
  )) {
    nodes.push(scope);
  }
  scope.querySelectorAll("[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label], [data-i18n-alt], [data-i18n-label]").forEach((el) => {
    nodes.push(el);
  });

  for (const element of nodes) {
    if (!(element instanceof Element)) continue;
    const key = element.getAttribute("data-i18n");
    if (key) setKeyedText(element, key);
    const placeholderKey = element.getAttribute("data-i18n-placeholder");
    if (placeholderKey) {
      const text = messageForKey(placeholderKey);
      if (text != null) element.setAttribute("placeholder", text);
    }
    const titleKey = element.getAttribute("data-i18n-title");
    if (titleKey) {
      const text = messageForKey(titleKey);
      if (text != null) element.setAttribute("title", text);
    }
    const ariaKey = element.getAttribute("data-i18n-aria-label");
    if (ariaKey) {
      const text = messageForKey(ariaKey);
      if (text != null) element.setAttribute("aria-label", text);
    }
    const altKey = element.getAttribute("data-i18n-alt");
    if (altKey) {
      const text = messageForKey(altKey);
      if (text != null) element.setAttribute("alt", text);
    }
    const labelKey = element.getAttribute("data-i18n-label");
    if (labelKey) {
      const text = messageForKey(labelKey);
      if (text != null) element.setAttribute("label", text);
    }
  }
}

function translateElement(element) {
  if (!(element instanceof Element) || element.closest("script, style, code, pre")) return;
  for (const name of ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    if (name === "placeholder" && element.hasAttribute("data-i18n-placeholder")) continue;
    if (name === "title" && element.hasAttribute("data-i18n-title")) continue;
    if (name === "aria-label" && element.hasAttribute("data-i18n-aria-label")) continue;
    if (name === "alt" && element.hasAttribute("data-i18n-alt")) continue;
    if (name === "label" && element.hasAttribute("data-i18n-label")) continue;
    const raw = element.getAttribute(name);
    const translated = translateLegacy(raw);
    if (translated !== raw) element.setAttribute(name, translated);
  }
  for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) translateTextNode(child);
}

function translateDocument(root = document.body) {
  if (!root) return;
  document.documentElement.lang = locale;
  applyI18n(root);
  if (locale === "fr") return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(translateTextNode);
  translateElement(root);
  if (root.querySelectorAll) root.querySelectorAll("*").forEach(translateElement);
}

    function start() {
      applyDocumentMetadata();
      translateDocument();
      new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          if (mutation.type === "characterData") {
            translateTextNode(mutation.target);
            return;
          }
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else if (node.nodeType === Node.ELEMENT_NODE) translateDocument(node);
          });
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    return { applyI18n, translateDocument, start };
  }
});
