const DEFAULT_SERVER_URL = "https://tabsync.nkson.com";
const LOCAL_SERVER_URL = "http://localhost:3000";
const SESSION_KEYS = [
  "token",
  "username",
  "deviceId",
  "revision",
  "pendingHistory",
  "lastHistoryByTab",
  "lastSyncAt",
  "lastSyncError"
];

const form = document.querySelector("#settings-form");
const serverUrlInput = document.querySelector("#server-url");
const status = document.querySelector("#settings-status");

function normalizeServerUrl(value) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use HTTP or HTTPS.");
  }
  if (url.protocol === "http:" && !isSupportedLocalServer(url)) {
    throw new Error("Use HTTPS for a remote server. HTTP is available only for localhost:3000 during development.");
  }
  if (url.username || url.password) {
    throw new Error("Server URL cannot include credentials.");
  }
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
}

function isSupportedLocalServer(url) {
  return (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.port === "3000";
}

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

document.querySelector("#use-local-server").addEventListener("click", () => {
  serverUrlInput.value = LOCAL_SERVER_URL;
  serverUrlInput.focus();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  try {
    const serverUrl = normalizeServerUrl(serverUrlInput.value);
    const stored = await chrome.storage.local.get("serverUrl");
    const previous = normalizeServerUrl(stored.serverUrl || DEFAULT_SERVER_URL);
    if (serverUrl !== previous) await chrome.storage.local.remove(SESSION_KEYS);
    await chrome.storage.local.set({ serverUrl });
    await chrome.runtime.sendMessage({ type: "AUTH_CHANGED" }).catch(() => null);
    serverUrlInput.value = serverUrl;
    setStatus(serverUrl === previous ? "Server settings saved." : "Server changed. Sign in to continue.");
  } catch (error) {
    setStatus(error.message, true);
  }
});

void (async () => {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  serverUrlInput.value = normalizeServerUrl(serverUrl || DEFAULT_SERVER_URL);
})();
