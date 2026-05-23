import {
  DASHBOARD_REPORT_ALARM,
  DASHBOARD_REPORT_PERIOD_MINUTES,
  POLL_ALARM,
} from "./background/config.js";
import {
  loginWithPassword,
  logoutBrowser,
  registerWithWebSession,
  validateBrowserSession,
} from "./background/auth.js";
import {
  refreshLocalMessageStats,
  reportDashboardSnapshot,
} from "./background/dashboard.js";
import {
  isMessageSocketActive,
  pollMessages,
  startMessageSocket,
} from "./background/messages.js";
import { refreshMessageBadgeFromStorage } from "./background/state.js";

function ensureAlarms() {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.create(DASHBOARD_REPORT_ALARM, {
    periodInMinutes: DASHBOARD_REPORT_PERIOD_MINUTES,
  });
}

function refreshMessageStats(options) {
  refreshLocalMessageStats(options).catch(() => {});
}

function pollMessagesWhenSocketInactive() {
  startMessageSocket();
  if (!globalThis.WebSocket || !isMessageSocketActive()) {
    pollMessages();
  }
  refreshMessageStats();
}

function openExtensionTabOnce(path) {
  const baseUrl = chrome.runtime.getURL(path);
  chrome.tabs.query({}, (tabs) => {
    const existing = tabs.find((tab) => tab.url?.startsWith(baseUrl));
    if (existing?.id) {
      chrome.tabs.update(existing.id, { active: true });
      if (existing.windowId !== undefined) {
        chrome.windows.update(existing.windowId, { focused: true });
      }
      return;
    }
    chrome.tabs.create({
      url: `${baseUrl}?installed=1`
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureAlarms();
  refreshMessageBadgeFromStorage().catch(() => {});
  startMessageSocket();
  refreshMessageStats({ force: true });
  if (details.reason === "install") {
    openExtensionTabOnce("popup.html");
  }
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  refreshMessageBadgeFromStorage().catch(() => {});
  startMessageSocket();
  refreshMessageStats({ force: true });
  reportDashboardSnapshot().catch(() => {});
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollMessagesWhenSocketInactive();
  } else if (alarm.name === DASHBOARD_REPORT_ALARM) {
    reportDashboardSnapshot().catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(() => {
  pollMessagesWhenSocketInactive();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    pollMessagesWhenSocketInactive();
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName === "local" &&
    (changes.browserToken || changes.dashboardOverview)
  ) {
    refreshMessageBadgeFromStorage().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "login-with-password") {
    loginWithPassword(message)
      .then((data) => {
        ensureAlarms();
        sendResponse({ ok: true, data });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "register-with-web-session") {
    registerWithWebSession(message)
      .then((data) => {
        ensureAlarms();
        sendResponse({ ok: true, data });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "validate-browser-session") {
    validateBrowserSession()
      .then((data) => sendResponse(data))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "poll-now") {
    pollMessages()
      .then(() => {
        startMessageSocket();
        return refreshLocalMessageStats({ force: true });
      })
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "refresh-message-stats-now") {
    refreshLocalMessageStats({ force: true })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "report-dashboard-now") {
    const requireComplete = Boolean(message?.requireComplete);
    reportDashboardSnapshot({ requireComplete })
      .then((result) => {
        if (result?.ok) {
          sendResponse({ ok: true, data: result });
          return;
        }
        sendResponse({ ok: false, error: result?.error || "上报失败" });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === "logout-browser" || message.type === "disconnect-device") {
    logoutBrowser()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

refreshMessageBadgeFromStorage().catch(() => {});
startMessageSocket();
