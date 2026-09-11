self.TAB_SYNC_CLIENT = {
  browser: "chrome",
  platform: "macos",
  displayName: "Chrome on macOS"
};

const DASHBOARD_URL = chrome.runtime.getURL("shared/popup.html");

async function openDashboard() {
  const matchingTabs = await chrome.tabs.query({ url: DASHBOARD_URL });
  const existingTab = matchingTabs.find((tab) => tab.id !== undefined);
  if (existingTab) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: DASHBOARD_URL });
}

chrome.action.onClicked.addListener(() => {
  void openDashboard().catch(() => {});
});

importScripts("../shared/background.js");
