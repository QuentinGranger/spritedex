(() => {
  "use strict";

  const modules = [];
  window.SpriteIndexAccount = {
    register(name, init) { modules.push({ name, init }); },
    initialize() { modules.forEach(({ init }) => init()); }
  };
})();
