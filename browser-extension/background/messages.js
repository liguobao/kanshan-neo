import {
  BROWSER_MESSAGE_BATCH_LIMIT,
  BROWSER_MESSAGE_WS_PATH,
  BROWSER_MESSAGE_WS_PING_MS,
  BROWSER_MESSAGE_WS_RECONNECT_MS,
  BROWSER_MESSAGE_WS_TOKEN_PROTOCOL,
} from "./config.js";
import {
  clearBrowserAuthState,
  getState,
  saveState,
} from "./state.js";
import {
  normalizeBaseUrl,
  resolveActionUrl,
  toWebSocketBaseUrl,
} from "./urls.js";

let pollMessagesPromise = null;
let messageSocket = null;
let messageSocketToken = "";
let messageSocketPingTimer = null;
let messageSocketReconnectTimer = null;
let messageSocketConnecting = false;

export async function pollMessages() {
  if (pollMessagesPromise) {
    return pollMessagesPromise;
  }

  pollMessagesPromise = pollMessagesOnce().finally(() => {
    pollMessagesPromise = null;
  });
  return pollMessagesPromise;
}

function clearMessageSocketTimers() {
  if (messageSocketPingTimer) {
    clearInterval(messageSocketPingTimer);
    messageSocketPingTimer = null;
  }
  if (messageSocketReconnectTimer) {
    clearTimeout(messageSocketReconnectTimer);
    messageSocketReconnectTimer = null;
  }
}

export function closeMessageSocket() {
  clearMessageSocketTimers();
  messageSocketToken = "";
  messageSocketConnecting = false;
  if (messageSocket) {
    const socket = messageSocket;
    messageSocket = null;
    try {
      socket.close(1000, "client reset");
    } catch {
      // Ignore sockets that are already closing.
    }
  }
}

export function isMessageSocketActive() {
  if (!globalThis.WebSocket) {
    return false;
  }
  return (
    messageSocket &&
    (messageSocket.readyState === globalThis.WebSocket.OPEN ||
      messageSocket.readyState === globalThis.WebSocket.CONNECTING)
  );
}

function scheduleMessageSocketReconnect() {
  if (messageSocketReconnectTimer) {
    return;
  }
  messageSocketReconnectTimer = setTimeout(() => {
    messageSocketReconnectTimer = null;
    startMessageSocket();
  }, BROWSER_MESSAGE_WS_RECONNECT_MS);
}

async function processBrowserMessages(items) {
  const state = await getState();
  let lastMessageId = state.lastMessageId || 0;
  for (const message of items || []) {
    lastMessageId = Math.max(lastMessageId, message.id || 0);
    await chrome.tabs.create({
      url: resolveActionUrl(message),
      active: true
    });
  }
  if (lastMessageId !== state.lastMessageId) {
    await saveState({ lastMessageId });
  }
  return lastMessageId;
}

async function handleMessageSocketPayload(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  if (data?.type === "messages") {
    await processBrowserMessages(data.items || []);
  } else if (data?.type === "error") {
    closeMessageSocket();
    if (data.error === "invalid browser token") {
      await clearBrowserAuthState();
    }
  }
}

export async function startMessageSocket() {
  if (!globalThis.WebSocket || messageSocketConnecting) {
    return;
  }

  const state = await getState();
  if (!state.browserToken) {
    closeMessageSocket();
    return;
  }
  if (
    messageSocket &&
    messageSocketToken === state.browserToken &&
    (messageSocket.readyState === globalThis.WebSocket.OPEN ||
      messageSocket.readyState === globalThis.WebSocket.CONNECTING)
  ) {
    return;
  }

  closeMessageSocket();
  messageSocketConnecting = true;

  const params = new URLSearchParams({
    after_id: String(state.lastMessageId || 0),
    limit: String(BROWSER_MESSAGE_BATCH_LIMIT),
  });
  const url = `${toWebSocketBaseUrl(state.serverBaseUrl)}${BROWSER_MESSAGE_WS_PATH}?${params.toString()}`;
  const socket = new WebSocket(url, [
    BROWSER_MESSAGE_WS_TOKEN_PROTOCOL,
    state.browserToken,
  ]);
  messageSocket = socket;
  messageSocketToken = state.browserToken;

  socket.onopen = () => {
    if (messageSocket !== socket) {
      return;
    }
    messageSocketConnecting = false;
    if (messageSocketReconnectTimer) {
      clearTimeout(messageSocketReconnectTimer);
      messageSocketReconnectTimer = null;
    }
    messageSocketPingTimer = setInterval(() => {
      if (
        messageSocket === socket &&
        socket.readyState === globalThis.WebSocket.OPEN
      ) {
        socket.send(JSON.stringify({ type: "ping" }));
      }
    }, BROWSER_MESSAGE_WS_PING_MS);
  };

  socket.onmessage = (event) => {
    handleMessageSocketPayload(event.data).catch(() => {});
  };

  socket.onerror = () => {
    if (messageSocket === socket) {
      try {
        socket.close();
      } catch {
        // Ignore sockets that are already closing.
      }
    }
  };

  socket.onclose = (event) => {
    if (messageSocket !== socket) {
      return;
    }
    clearMessageSocketTimers();
    messageSocket = null;
    messageSocketToken = "";
    messageSocketConnecting = false;
    if (event.code === 1008) {
      clearBrowserAuthState().catch(() => {});
      return;
    }
    scheduleMessageSocketReconnect();
  };
}

async function pollMessagesOnce() {
  const state = await getState();
  if (!state.browserToken) {
    return { ok: false, skipped: true };
  }

  const baseUrl = normalizeBaseUrl(state.serverBaseUrl);
  const params = new URLSearchParams({
    after_id: String(state.lastMessageId || 0),
    limit: String(BROWSER_MESSAGE_BATCH_LIMIT),
  });
  const url = `${baseUrl}/api/browser/messages?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${state.browserToken}`
    }
  });
  if (!response.ok) {
    if (response.status === 401) {
      closeMessageSocket();
      await clearBrowserAuthState();
      return { ok: false, unauthorized: true };
    }
    return { ok: false, status: response.status };
  }

  const data = await response.json();
  await processBrowserMessages(data.items || []);
  return { ok: true, count: data.count || 0 };
}
