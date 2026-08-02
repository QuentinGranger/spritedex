// Renders the public app shell from small HTML fragments. The source template
// remains easy to review while both Express and Capacitor ship one complete
// document to the browser.
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.join(__dirname, "..");
const INCLUDE = /<!-- index:include ([a-z0-9-]+\.html) -->/g;

function renderIndexPage(rootDir = ROOT_DIR) {
  const template = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
  const fragmentsDir = path.join(rootDir, "index", "fragments");

  return template.replace(INCLUDE, (match, fragment) => {
    const file = path.resolve(fragmentsDir, fragment);
    if (!file.startsWith(`${fragmentsDir}${path.sep}`)) {
      throw new Error(`Invalid index fragment: ${fragment}`);
    }
    return fs.readFileSync(file, "utf8");
  });
}

module.exports = { renderIndexPage };
