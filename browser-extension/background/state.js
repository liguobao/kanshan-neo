import {
  DEFAULT_SERVER_BASE_URL,
  MESSAGE_BADGE_BACKGROUND_COLOR,
  MESSAGE_BADGE_MAX_COUNT,
} from "./config.js";

export async function getState() {
  return chrome.storage.local.get({
    serverBaseUrl: DEFAULT_SERVER_BASE_URL,
    browserToken: "",
    browserId: "",
    account: "",
    deviceId: "",
    lastMessageId: 0
  });
}

export async function saveState(patch) {
  await chrome.storage.local.set(patch);
}

export function pickMessageBadgeCount(overview) {
  const rawValue =
    overview?.today?.message ??
    overview?.notifications?.unread ??
    overview?.notifications?.total;
  const count = Number(rawValue);
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.floor(count);
}

export function setMessageBadge(count) {
  if (!chrome.action?.setBadgeText) {
    return;
  }

  const text =
    count > MESSAGE_BADGE_MAX_COUNT
      ? `${MESSAGE_BADGE_MAX_COUNT}+`
      : count > 0
        ? String(count)
        : "";
  chrome.action.setBadgeBackgroundColor?.({
    color: MESSAGE_BADGE_BACKGROUND_COLOR,
  });
  chrome.action.setBadgeText({ text });
}

export async function refreshMessageBadgeFromStorage() {
  const state = await chrome.storage.local.get({
    browserToken: "",
    dashboardOverview: null,
  });
  if (!state.browserToken) {
    setMessageBadge(0);
    return;
  }
  setMessageBadge(pickMessageBadgeCount(state.dashboardOverview));
}

export async function clearBrowserAuthState() {
  await saveState({
    browserToken: "",
    deviceId: "",
    account: "",
    lastMessageId: 0,
    lastDashboardReportedAt: "",
    lastMessageStatsRefreshedAt: "",
    zhihuDataRefreshedAt: "",
    dashboardOverview: null,
  });
  setMessageBadge(0);
}
