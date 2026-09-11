const DEFAULT_SERVER_URL = "https://tabsync.nkson.com";

const loadingView = document.querySelector("#loading-view");
const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const logoutButton = document.querySelector("#logout");
const authError = document.querySelector("#auth-error");
const appError = document.querySelector("#app-error");
const devicesElement = document.querySelector("#devices");
const historyElement = document.querySelector("#history");
const moreButton = document.querySelector("#more");
const endpointValue = document.querySelector("#endpoint-value");
const deviceNameForm = document.querySelector("#device-name-form");
const deviceNameInput = document.querySelector("#device-name");
const deviceNameStatus = document.querySelector("#device-name-status");
const saveDeviceNameButton = document.querySelector("#save-device-name");
let nextCursor = null;
let historyItems = [];

const SESSION_KEYS = [
  "token",
  "username",
  "deviceId",
  "revision",
  "pendingHistory",
  "lastHistoryByTab"
];

function show(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function setError(element, message) {
  element.textContent = message || "";
  show(element, Boolean(message));
}

function setDeviceNameStatus(message, error = false) {
  deviceNameStatus.textContent = message || "";
  deviceNameStatus.classList.toggle("error", error);
}

function normalizeServerUrl(value = DEFAULT_SERVER_URL) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  } catch {
    return DEFAULT_SERVER_URL;
  }
}

async function updateEndpoint() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  endpointValue.textContent = normalizeServerUrl(serverUrl).replace(/^https?:\/\//, "");
}

async function api(path, options = {}, explicitToken) {
  const { token: storedToken, serverUrl } = await chrome.storage.local.get(["token", "serverUrl"]);
  const token = explicitToken || storedToken;
  const response = await fetch(`${normalizeServerUrl(serverUrl)}/api/v1${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "ngrok-skip-browser-warning": "1",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });
  let body = null;
  let invalidJson = false;
  if (response.status !== 204) {
    try {
      body = await response.json();
    } catch {
      invalidJson = true;
    }
  }
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  if (invalidJson) throw new Error("Server returned a non-JSON response");
  return body;
}

function renderTab(tab) {
  const row = document.createElement("div");
  row.className = "tab-row";
  const icon = document.createElement("span");
  icon.className = "favicon";
  icon.textContent = "↗";
  const link = document.createElement("a");
  link.className = "tab-link";
  link.href = tab.url;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: tab.url });
  });
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = tab.title || tab.url;
  const url = document.createElement("div");
  url.className = "url";
  url.textContent = tab.url;
  link.append(title, url);
  row.append(icon, link);
  return row;
}

function renderDevices(devices) {
  devicesElement.replaceChildren();
  if (!devices.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No tracked devices yet.";
    devicesElement.append(empty);
    return;
  }
  for (const device of devices) {
    const card = document.createElement("article");
    card.className = "device";
    const heading = document.createElement("h3");
    heading.textContent = device.displayName;
    const meta = document.createElement("p");
    meta.className = "device-meta";
    meta.textContent = `${device.browser} · ${device.openTabs.length} tabs · ${new Date(device.lastSeenAt).toLocaleString()}`;
    const tabs = document.createElement("div");
    tabs.className = "tab-list";
    if (device.openTabs.length) device.openTabs.forEach((tab) => tabs.append(renderTab(tab)));
    else {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No open tabs.";
      tabs.append(empty);
    }
    card.append(heading, meta, tabs);
    devicesElement.append(card);
  }
}

function renderHistory() {
  historyElement.replaceChildren();
  if (!historyItems.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No captured history yet.";
    historyElement.append(empty);
    return;
  }
  for (const item of historyItems) {
    const row = document.createElement("div");
    row.className = "history-row";
    const icon = document.createElement("span");
    icon.className = "favicon";
    icon.textContent = "H";
    const copy = document.createElement("div");
    copy.className = "history-copy";
    const link = document.createElement("a");
    link.className = "tab-link title";
    link.href = item.url;
    link.textContent = item.title || item.url;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.tabs.create({ url: item.url });
    });
    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = `${item.deviceName} · ${new Date(item.visitedAt).toLocaleString()}`;
    copy.append(link, time);
    row.append(icon, copy);
    historyElement.append(row);
  }
}

async function loadState(append = false) {
  setError(appError, "");
  try {
    if (!append) await chrome.runtime.sendMessage({ type: "SYNC_NOW" }).catch(() => null);
    const cursor = append && nextCursor ? `&cursor=${encodeURIComponent(nextCursor)}` : "";
    const state = await api(`/state?historyLimit=50${cursor}`);
    renderDevices(state.devices);
    const local = await chrome.storage.local.get(["deviceName", "installationId"]);
    const currentDevice = state.devices.find((device) => device.installationId === local.installationId);
    if (document.activeElement !== deviceNameInput) {
      deviceNameInput.value = local.deviceName || currentDevice?.displayName || "";
    }
    historyItems = append ? historyItems.concat(state.history.items) : state.history.items;
    nextCursor = state.history.nextCursor;
    renderHistory();
    show(moreButton, Boolean(nextCursor));
    const sync = await chrome.storage.local.get(["lastSyncAt", "lastSyncError"]);
    document.querySelector("#sync-status").textContent = sync.lastSyncError
      ? `Sync issue: ${sync.lastSyncError}`
      : sync.lastSyncAt ? `Synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}` : "Sync ready";
    document.querySelector("#sync-dot").classList.toggle("ok", !sync.lastSyncError);
  } catch (error) {
    if (error.status === 401) {
      await chrome.storage.local.remove(SESSION_KEYS);
      return showLogin();
    }
    setError(appError, error.message);
  }
}

function showLogin() {
  show(loadingView, false);
  show(loginView, true);
  show(appView, false);
  show(logoutButton, false);
}

function showApp() {
  show(loadingView, false);
  show(loginView, false);
  show(appView, true);
  show(logoutButton, true);
  void loadState();
}

async function authenticate(mode) {
  setError(authError, "");
  const username = document.querySelector("#username").value.trim();
  const password = document.querySelector("#password").value;
  try {
    const result = await api(`/auth/${mode}`, {
      method: "POST",
      body: JSON.stringify({ username, password })
    }, null);
    await chrome.storage.local.remove(SESSION_KEYS);
    await chrome.storage.local.set({ token: result.token, username: result.user.username });
    await chrome.runtime.sendMessage({ type: "AUTH_CHANGED" }).catch(() => null);
    showApp();
  } catch (error) {
    setError(authError, error.message);
  }
}

document.querySelector("#login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void authenticate("login");
});
document.querySelector("#register").addEventListener("click", () => void authenticate("register"));
document.querySelector("#refresh").addEventListener("click", () => void loadState());
moreButton.addEventListener("click", () => void loadState(true));
deviceNameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!deviceNameForm.reportValidity()) return;

  const displayName = deviceNameInput.value.trim();
  if (!displayName) {
    deviceNameInput.setCustomValidity("Enter a device name.");
    deviceNameInput.reportValidity();
    return;
  }

  deviceNameInput.setCustomValidity("");
  saveDeviceNameButton.disabled = true;
  setDeviceNameStatus("Saving…");
  try {
    const result = await chrome.runtime.sendMessage({ type: "DEVICE_NAME_CHANGED", displayName });
    if (!result?.ok) throw new Error(result?.error || "Could not save device name");
    deviceNameInput.value = displayName;
    setDeviceNameStatus("Device name saved.");
    await loadState();
  } catch (error) {
    setDeviceNameStatus(error.message || "Could not save device name", true);
  } finally {
    saveDeviceNameButton.disabled = false;
  }
});
deviceNameInput.addEventListener("input", () => {
  deviceNameInput.setCustomValidity("");
  setDeviceNameStatus("");
});
logoutButton.addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" }).catch(() => null);
  await chrome.storage.local.remove(SESSION_KEYS);
  showLogin();
});

void (async () => {
  await updateEndpoint();
  const { token } = await chrome.storage.local.get("token");
  if (!token) return showLogin();
  try {
    await api("/me");
    showApp();
  } catch {
    await chrome.storage.local.remove(SESSION_KEYS);
    showLogin();
  }
})();
