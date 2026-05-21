import {
  BROWSER_ID_CODE_LENGTH,
  BROWSER_ID_PREFIX,
  BROWSER_SESSION_REGISTER_URL,
  DEFAULT_SERVER_BASE_URL,
  FALLBACK_SERVER_BASE_URLS,
  WEB_AUTH_COOKIE_NAME,
} from "./config.js";
import {
  refreshLocalMessageStats,
  reportDashboardSnapshot,
  validateZhihuSession,
} from "./dashboard.js";
import { closeMessageSocket, startMessageSocket } from "./messages.js";
import {
  clearBrowserAuthState,
  getState,
  saveState,
} from "./state.js";
import {
  normalizeBaseUrl,
  uniqueBaseUrls,
} from "./urls.js";

function createBrowserId() {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  const bytes = new Uint8Array(BROWSER_ID_CODE_LENGTH);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  const suffix = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  return `${BROWSER_ID_PREFIX}${suffix}`;
}

function isCurrentBrowserId(value) {
  return (
    typeof value === "string" &&
    value.startsWith(BROWSER_ID_PREFIX) &&
    value.length === BROWSER_ID_PREFIX.length + BROWSER_ID_CODE_LENGTH
  );
}

async function getOrCreateBrowserId() {
  const state = await chrome.storage.local.get({
    browserId: "",
    browserToken: "",
  });
  if (isCurrentBrowserId(state.browserId)) {
    return state.browserId;
  }
  if (state.browserId && state.browserToken) {
    return state.browserId;
  }
  const browserId = createBrowserId();
  await saveState({ browserId });
  return browserId;
}

async function getWebAuthTokenFromCookie(baseUrl) {
  if (!chrome.cookies?.get) {
    return "";
  }

  return new Promise((resolve) => {
    chrome.cookies.get(
      {
        url: baseUrl,
        name: WEB_AUTH_COOKIE_NAME,
      },
      (cookie) => {
        if (chrome.runtime.lastError || !cookie?.value) {
          resolve("");
          return;
        }
        try {
          resolve(decodeURIComponent(cookie.value));
        } catch {
          resolve(cookie.value);
        }
      }
    );
  });
}

export async function validateBrowserSession() {
  const state = await getState();
  if (!state.browserToken) {
    return {
      ok: false,
      error: "未登录，请先登录插件",
    };
  }

  const baseUrl = normalizeBaseUrl(state.serverBaseUrl);
  const url =
    `${baseUrl}/api/browser/messages?after_id=${Number.MAX_SAFE_INTEGER}` +
    "&limit=1";
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.browserToken}`,
    },
  });
  if (response.status === 401) {
    closeMessageSocket();
    await clearBrowserAuthState();
    return {
      ok: false,
      loggedOut: true,
      error: "登录已失效，请重新登录",
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      error: `登录状态检查失败：HTTP ${response.status}`,
    };
  }

  const zhihuSession = await validateZhihuSession();
  if (!zhihuSession.ok) {
    return zhihuSession;
  }
  return {
    ok: true,
    zhihuProfileName: zhihuSession.profileName || "",
  };
}

export async function loginWithPassword({ serverBaseUrl, email, password }) {
  const baseUrl = normalizeBaseUrl(serverBaseUrl);
  const browserId = await getOrCreateBrowserId();
  const response = await fetch(`${baseUrl}/api/browser/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      password,
      browser_id: browserId
    })
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("账号或密码不正确");
    }
    throw new Error(`登录失败：HTTP ${response.status}`);
  }
  const data = await response.json();
  await saveState({
    serverBaseUrl: baseUrl,
    browserToken: data.browser_token,
    account: email,
    deviceId: data.device_id,
    lastMessageId: Math.max(0, Number(data.last_message_id) || 0)
  });
  startMessageSocket();
  refreshLocalMessageStats({ force: true }).catch(() => {});
  reportDashboardSnapshot().catch(() => {});
  return { ...data, browserId };
}

export async function registerWithWebSession({ serverBaseUrl } = {}) {
  const state = await getState();
  if (state.browserToken) {
    startMessageSocket();
    return {
      status: "paired",
      browser_token: state.browserToken,
      device_id: state.deviceId,
      last_message_id: state.lastMessageId || 0,
    };
  }

  const browserId = await getOrCreateBrowserId();
  const candidateBaseUrls = uniqueBaseUrls([
    serverBaseUrl,
    state.serverBaseUrl,
    DEFAULT_SERVER_BASE_URL,
    ...FALLBACK_SERVER_BASE_URLS,
  ]);
  let lastError = "";

  for (const baseUrl of candidateBaseUrls) {
    const webToken = await getWebAuthTokenFromCookie(baseUrl);
    if (!webToken) {
      continue;
    }

    const response = await fetch(`${baseUrl}${BROWSER_SESSION_REGISTER_URL}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${webToken}`,
      },
      body: JSON.stringify({
        browser_id: browserId,
      }),
    });
    if (!response.ok) {
      lastError =
        response.status === 401 || response.status === 403
          ? "Kanshan Web 登录态已失效，请重新登录 Web 控制台"
          : `授权登录失败：HTTP ${response.status}`;
      continue;
    }

    const data = await response.json();
    await saveState({
      serverBaseUrl: baseUrl,
      browserToken: data.browser_token,
      deviceId: data.device_id,
      lastMessageId: Math.max(0, Number(data.last_message_id) || 0),
    });
    startMessageSocket();
    refreshLocalMessageStats({ force: true }).catch(() => {});
    reportDashboardSnapshot().catch(() => {});
    return { ...data, browserId, serverBaseUrl: baseUrl };
  }

  throw new Error(lastError || "未检测到 Kanshan Web 登录态");
}

export async function logoutBrowser() {
  closeMessageSocket();
  await clearBrowserAuthState();
}
