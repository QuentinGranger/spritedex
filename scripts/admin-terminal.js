"use strict";

function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Promise.reject(new Error("An interactive terminal is required to enter the admin password."));
  }

  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const stdin = process.stdin;

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (stdin.isRaw) stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = (callback, result) => {
      if (settled) return;
      settled = true;
      cleanup();
      process.stdout.write("\n");
      callback(result);
    };
    const onKey = (key) => {
      if (key === "\u0003") return finish(reject, new Error("Admin command cancelled."));
      if (key === "\r" || key === "\n") return finish(resolve, value);
      if (key === "\u0004") return finish(reject, new Error("Admin command cancelled."));
      if (key === "\u007f" || key === "\b") {
        value = value.slice(0, -1);
        return;
      }
      // Do not echo any character; copy/paste remains supported.
      if (!/\p{C}/u.test(key)) value += key;
    };
    const onData = (chunk) => {
      // A terminal may deliver a paste as one chunk. Process it character by
      // character so the final Return key is still recognized.
      for (const key of Array.from(String(chunk))) {
        onKey(key);
        if (settled) break;
      }
    };

    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

module.exports = { promptHidden };
