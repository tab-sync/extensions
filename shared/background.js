const DEFAULT_SERVER_URL = "https://tabsync.nkson.com";
const SYNC_ALARM = "tabsync-retry";
const MAX_PENDING_HISTORY = 500;
const client = self.TAB_SYNC_CLIENT;

let syncRunning = false;
let syncDirty = false;
let historyWrite = Promise.resolve();

function randomId() {
  return crypto.randomUUID();
}

function isSyncableUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function apiBase(serverUrl = DEFAULT_SERVER_URL) {
  try {
    const url = new URL(serverUrl);
    url.search = "";
    url.hash = "";
    const base = url.toString().replace(/\/+$/, "").replace(/\/api\/v1$/, "");
    return `${base}/api/v1`;
  } catch {
    return `${DEFAULT_SERVER_URL}/api/v1`;
  }
}

async function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

async function api(path, options = {}) {
  const { token, serverUrl } = await storageGet(["token", "serverUrl"]);
  if (!token) throw new Error("Sign in to sync");

  const response = await fetch(`${apiBase(serverUrl)}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "ngrok-skip-browser-warning": "1",
      authorization: `Bearer ${token}`,
      ...options.headers
    }
  });
  if (!response.ok) {
    let message = `API request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {}
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

async function ensureInstallationId() {
  const state = await storageGet("installationId");
  if (state.installationId) return state.installationId;
  const installationId = randomId();
  await chrome.storage.local.set({ installationId });
  return installationId;
}

function configuredDeviceName(value) {
  return typeof value === "string" && value.trim() ? value.trim() : client.displayName;
}

async function registerDevice() {
  const state = await storageGet(["installationId", "revision", "deviceName"]);
  const installationId = state.installationId || await ensureInstallationId();
  const displayName = configuredDeviceName(state.deviceName);
  const device = {
    installationId,
    displayName,
    browser: client.browser,
    platform: client.platform,
    extensionVersion: chrome.runtime.getManifest().version
  };
  let result;
  try {
    result = await api("/devices", { method: "POST", body: JSON.stringify(device) });
  } catch (error) {
    const legacyServer = client.browser === "firefox"
      && error.status === 400
      && error.message === "browser or platform is invalid";
    if (!legacyServer) throw error;
    result = await api("/devices", {
      method: "POST",
      body: JSON.stringify({ ...device, browser: "chrome" })
    });
  }
  const revision = Math.max(Number(state.revision || 0), Number(result.device.tabsRevision || 0));
  const latest = await storageGet("deviceName");
  await chrome.storage.local.set({
    deviceId: result.device.id,
    revision,
    deviceNameDirty: configuredDeviceName(latest.deviceName) !== displayName
  });
  return result.device.id;
}

async function ensureDevice() {
  const state = await storageGet(["deviceId", "deviceNameDirty"]);
  if (state.deviceId && !state.deviceNameDirty) return state.deviceId;
  return registerDevice();
}

async function updateDeviceName(value) {
  const deviceName = typeof value === "string" ? value.trim() : "";
  if (!deviceName || deviceName.length > 80) {
    throw new Error("Device name must be between 1 and 80 characters");
  }
  await chrome.storage.local.set({ deviceName, deviceNameDirty: true });
  await registerDevice();
  await runSync();
}

async function collectTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter((tab) => tab.id !== undefined && !tab.incognito && isSyncableUrl(tab.url))
    .map((tab) => ({
      browserTabId: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: Boolean(tab.active),
      pinned: Boolean(tab.pinned),
      url: tab.url,
      title: tab.title || ""
    }));
}

async function pushSnapshot(deviceId) {
  const tabs = await collectTabs();
  const { revision: storedRevision } = await storageGet("revision");
  const revision = Number(storedRevision || 0) + 1;
  await chrome.storage.local.set({ revision });
  const result = await api(`/devices/${encodeURIComponent(deviceId)}/tabs`, {
    method: "PUT",
    body: JSON.stringify({ revision, observedAt: new Date().toISOString(), tabs })
  });
  if (result.acceptedRevision > revision) {
    await chrome.storage.local.set({ revision: result.acceptedRevision });
  }
}

async function pushHistory(deviceId) {
  const { pendingHistory = [] } = await storageGet("pendingHistory");
  if (!pendingHistory.length) return;
  const batch = pendingHistory.slice(0, 100);
  await api(`/devices/${encodeURIComponent(deviceId)}/history`, {
    method: "POST",
    body: JSON.stringify({ events: batch })
  });
  const sent = new Set(batch.map((event) => event.eventId));
  const latest = await storageGet("pendingHistory");
  await chrome.storage.local.set({
    pendingHistory: (latest.pendingHistory || []).filter((event) => !sent.has(event.eventId))
  });
}

async function syncOnce() {
  const { token } = await storageGet("token");
  if (!token) return;
  try {
    const deviceId = await ensureDevice();
    await pushSnapshot(deviceId);
    await pushHistory(deviceId);
    await chrome.storage.local.set({ lastSyncAt: new Date().toISOString(), lastSyncError: null });
  } catch (error) {
    if (error.status === 401) {
      await chrome.storage.local.remove([
        "token",
        "username",
        "deviceId",
        "revision",
        "pendingHistory",
        "lastHistoryByTab"
      ]);
    } else if (error.status === 404) {
      await chrome.storage.local.remove("deviceId");
    }
    await chrome.storage.local.set({ lastSyncError: error.message || "Sync failed" });
  }
}

async function runSync() {
  if (syncRunning) {
    syncDirty = true;
    return;
  }
  syncRunning = true;
  try {
    do {
      syncDirty = false;
      await syncOnce();
    } while (syncDirty);
  } finally {
    syncRunning = false;
  }
}

function requestSync() {
  void runSync();
}

function queueHistory(details, kind) {
  if (details.frameId !== undefined && details.frameId !== 0) return;
  if (!isSyncableUrl(details.url)) return;

  historyWrite = historyWrite.then(async () => {
    const state = await storageGet(["token", "pendingHistory", "lastHistoryByTab"]);
    if (!state.token) return;
    const pendingHistory = state.pendingHistory || [];
    const lastHistoryByTab = state.lastHistoryByTab || {};
    const now = Date.now();
    const previous = lastHistoryByTab[details.tabId];
    if (previous?.url === details.url && now - previous.at < 2000) return;

    let title = "";
    try {
      title = (await chrome.tabs.get(details.tabId)).title || "";
    } catch {}

    pendingHistory.push({
      eventId: randomId(),
      browserTabId: details.tabId,
      kind,
      url: details.url,
      title,
      visitedAt: new Date(details.timeStamp || now).toISOString()
    });
    lastHistoryByTab[details.tabId] = { url: details.url, at: now };
    await chrome.storage.local.set({
      pendingHistory: pendingHistory.slice(-MAX_PENDING_HISTORY),
      lastHistoryByTab
    });
  }).then(runSync, async (error) => {
    await chrome.storage.local.set({ lastSyncError: error.message || "Could not queue history" });
  });
}

function initialize() {
  void ensureInstallationId();
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  requestSync();
}

chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(requestSync);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) requestSync();
});

chrome.tabs.onCreated.addListener(requestSync);
chrome.tabs.onRemoved.addListener(requestSync);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !chrome.webNavigation.onHistoryStateUpdated) {
    queueHistory({ tabId, url: changeInfo.url, timeStamp: Date.now() }, "tab_url_change");
  }
  requestSync();
});

chrome.webNavigation.onCommitted.addListener((details) => queueHistory(details, "committed"));
if (chrome.webNavigation.onHistoryStateUpdated) {
  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => queueHistory(details, "history_state"));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "AUTH_CHANGED") {
    chrome.storage.local.remove([
      "deviceId",
      "revision",
      "pendingHistory",
      "lastHistoryByTab"
    ]).then(runSync).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "SYNC_NOW") {
    runSync().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "DEVICE_NAME_CHANGED") {
    updateDeviceName(message.displayName)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || "Could not save device name" }));
    return true;
  }
  return false;
});

initialize();
