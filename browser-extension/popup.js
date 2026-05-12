const loginForm = document.getElementById("login-form");
const ZHIHU_HOME_URL = "https://www.zhihu.com/";
const CREATOR_ANALYTICS_URL = "https://www.zhihu.com/creator/analytics/work/all";
const ZHIHU_NOTIFICATIONS_URL = "https://www.zhihu.com/notifications";
const statusEl = document.getElementById("status");
const versionEl = document.getElementById("version");
const lastReportEl = document.getElementById("last-report");
const feedbackEl = document.getElementById("feedback");
const metricEls = {
  read: {
    value: document.getElementById("metric-read"),
    time: document.getElementById("metric-read-time"),
  },
  agree: {
    value: document.getElementById("metric-agree"),
    time: document.getElementById("metric-agree-time"),
  },
  comment: {
    value: document.getElementById("metric-comment"),
    time: document.getElementById("metric-comment-time"),
  },
  message: {
    value: document.getElementById("metric-message"),
    time: document.getElementById("metric-message-time"),
  },
};
const loginEmailEl = document.getElementById("login-email");
const loginPasswordEl = document.getElementById("login-password");
const webAuthLoginEl = document.getElementById("web-auth-login");
const pollNowEl = document.getElementById("poll-now");
const metricReadLinkEl = document.getElementById("metric-read-link");
const metricAgreeLinkEl = document.getElementById("metric-agree-link");
const metricCommentLinkEl = document.getElementById("metric-comment-link");
const metricMessageLinkEl = document.getElementById("metric-message-link");
const reportDashboardEl = document.getElementById("report-dashboard");
const openDashboardEl = document.getElementById("open-dashboard");
const logoutBrowserEl = document.getElementById("logout-browser");
const serverHomeLinkEl = document.getElementById("server-home-link");
const openZhihuLinkEl = document.getElementById("open-zhihu-link");
const toolsSectionEl = document.getElementById("tools-section");
const DEFAULT_SERVER_BASE_URL = "https://kanshan.r2049.cn";
let serverBaseUrl = DEFAULT_SERVER_BASE_URL;

function renderVersion() {
  const manifest = chrome.runtime.getManifest();
  versionEl.textContent = `版本 ${manifest.version}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setFeedback(text) {
  feedbackEl.textContent = text || "";
}

function formatTimestamp(value) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "暂无";
  }

  const pad = (number) => String(number).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

function formatMetricValue(value) {
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return String(value);
  }
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(number);
}

function renderMetric(key, value, time) {
  metricEls[key].value.textContent = formatMetricValue(value);
  metricEls[key].time.textContent = time || "-";
}

function renderDashboardOverview(overview) {
  const today = overview?.today || {};
  renderMetric("read", today.read, today.read_time);
  renderMetric("agree", today.agree, today.agree_time);
  renderMetric("comment", today.comment, today.comment_time);
  renderMetric("message", today.message, today.message_time);
}

function renderConnectionState(state, feedbackText) {
  const isLoggedIn = !!state.browserToken;
  loginForm.hidden = isLoggedIn;
  statusEl.hidden = isLoggedIn;
  logoutBrowserEl.hidden = !isLoggedIn;
  toolsSectionEl.hidden = !isLoggedIn;
  setStatus(isLoggedIn ? "已登录" : "未登录");
  lastReportEl.textContent = `最后上报时间：${formatTimestamp(state.lastDashboardReportedAt)}`;
  renderDashboardOverview(state.dashboardOverview);
  setFeedback(feedbackText);
}

function requestMessageStatsRefresh() {
  chrome.runtime.sendMessage({ type: "refresh-message-stats-now" }, (reply) => {
    if (!reply || !reply.ok) {
      return;
    }
    chrome.storage.local.get({ dashboardOverview: null }, (state) => {
      renderDashboardOverview(state.dashboardOverview);
    });
  });
}

function validateCurrentSession() {
  chrome.runtime.sendMessage({ type: "validate-browser-session" }, (reply) => {
    if (!reply || reply.ok) {
      return;
    }
    if (reply.loggedOut) {
      loadState(reply.error || "登录已失效，请重新登录");
      return;
    }
    setFeedback(reply.error || "登录状态检查失败");
  });
}

function normalizeServerBaseUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_SERVER_BASE_URL)
    .trim()
    .replace(/\/+$/, "");

  if (!/^https?:\/\//i.test(normalized)) {
    return `https://${normalized}`;
  }

  if (normalized.startsWith("http://")) {
    const hostname = normalized
      .replace(/^http:\/\//i, "")
      .split("/")[0]
      .split("@")
      .pop()
      .split(":")[0];
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "::1") {
      return `https://${normalized.slice("http://".length)}`;
    }
  }

  return normalized;
}

async function registerWithWebSession() {
  setFeedback("授权登录中...");
  webAuthLoginEl.disabled = true;
  chrome.runtime.sendMessage(
    {
      type: "register-with-web-session",
      serverBaseUrl,
    },
    (reply) => {
      webAuthLoginEl.disabled = false;
      if (!reply || !reply.ok) {
        setFeedback(reply?.error || "授权登录失败，请先登录 Web 控制台");
        return;
      }
      loadState("授权登录成功");
    }
  );
}

async function loadState(statusText, options = {}) {
  const state = await chrome.storage.local.get({
    serverBaseUrl: DEFAULT_SERVER_BASE_URL,
    deviceId: "",
    browserToken: "",
    account: "",
    lastDashboardReportedAt: "",
    dashboardOverview: null,
  });
  serverBaseUrl = normalizeServerBaseUrl(state.serverBaseUrl);
  renderConnectionState(state, statusText);
  if (state.browserToken) {
    validateCurrentSession();
    if (options.refreshMessageStats !== false) {
      requestMessageStatsRefresh();
    }
  }
}

webAuthLoginEl?.addEventListener("click", registerWithWebSession);

metricReadLinkEl?.addEventListener("click", () => {
  chrome.tabs.create({ url: CREATOR_ANALYTICS_URL });
});

metricAgreeLinkEl?.addEventListener("click", () => {
  chrome.tabs.create({ url: ZHIHU_NOTIFICATIONS_URL });
});

metricCommentLinkEl?.addEventListener("click", () => {
  chrome.tabs.create({ url: ZHIHU_NOTIFICATIONS_URL });
});

metricMessageLinkEl?.addEventListener("click", () => {
  chrome.tabs.create({ url: ZHIHU_NOTIFICATIONS_URL });
});

openZhihuLinkEl?.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({ url: ZHIHU_HOME_URL });
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = loginEmailEl.value.trim();
  const password = loginPasswordEl.value;
  if (!email || !password) {
    setFeedback("请输入账号和密码");
    return;
  }

  setFeedback("登录中...");
  chrome.runtime.sendMessage(
    {
      type: "login-with-password",
      serverBaseUrl: serverBaseUrl,
      email,
      password
    },
    (reply) => {
      if (!reply || !reply.ok) {
        setFeedback(reply?.error || "登录失败");
        return;
      }
      loginPasswordEl.value = "";
      renderConnectionState(
        {
          browserToken: reply.data?.browser_token || "paired",
          deviceId: reply.data?.device_id,
          account: email,
          lastDashboardReportedAt: "",
        },
        "登录成功"
      );
      requestMessageStatsRefresh();
    }
  );
});

serverHomeLinkEl?.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.tabs.create({
    url: normalizeServerBaseUrl(serverBaseUrl)
  });
});

pollNowEl.addEventListener("click", () => {
  setFeedback("检查中...");
  chrome.runtime.sendMessage({ type: "poll-now" }, (reply) => {
    if (!reply || !reply.ok) {
      setFeedback(reply?.error || "检查失败");
      return;
    }
    loadState("检查完成", { refreshMessageStats: false });
  });
});

reportDashboardEl?.addEventListener("click", () => {
  setFeedback("上报中...");
  reportDashboardEl.disabled = true;
  chrome.runtime.sendMessage({ type: "report-dashboard-now" }, (reply) => {
    reportDashboardEl.disabled = false;
    if (!reply || !reply.ok) {
      loadState(reply?.error || "上报失败");
      return;
    }
    loadState("上报成功：已推送到服务端");
  });
});

openDashboardEl?.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("dashboard.html")
  });
});

logoutBrowserEl?.addEventListener("click", (event) => {
  event.preventDefault();
  if (logoutBrowserEl.classList.contains("is-disabled")) {
    return;
  }
  setFeedback("退出中...");
  logoutBrowserEl.classList.add("is-disabled");
  chrome.runtime.sendMessage({ type: "logout-browser" }, (reply) => {
    logoutBrowserEl.classList.remove("is-disabled");
    if (!reply || !reply.ok) {
      setFeedback(reply?.error || "退出失败");
      return;
    }
    loginPasswordEl.value = "";
    loadState("已退出登录");
  });
});

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (changes.dashboardOverview) {
    renderDashboardOverview(changes.dashboardOverview.newValue);
  }
  if (changes.lastDashboardReportedAt) {
    lastReportEl.textContent =
      `最后上报时间：${formatTimestamp(changes.lastDashboardReportedAt.newValue)}`;
  }
  if (changes.browserToken) {
    const oldToken = changes.browserToken.oldValue || "";
    const newToken = changes.browserToken.newValue || "";
    if (oldToken && !newToken) {
      loadState("登录已失效，请重新登录", { refreshMessageStats: false });
    }
  }
});

renderVersion();
loadState();
