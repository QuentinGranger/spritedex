const { contextBridge } = require("electron");

// The renderer only receives a boolean platform marker; Node/Electron APIs
// remain isolated from the web application.
contextBridge.exposeInMainWorld("SPRITEDEX_DESKTOP", true);
