import {
  DEFAULT_ACTION_URLS,
  DEFAULT_SERVER_BASE_URL,
} from "./config.js";

export function normalizeBaseUrl(baseUrl) {
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

export function toWebSocketBaseUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.startsWith("https://")) {
    return `wss://${normalized.slice("https://".length)}`;
  }
  if (normalized.startsWith("http://")) {
    return `ws://${normalized.slice("http://".length)}`;
  }
  return normalized;
}

export function buildQuestionUrl(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) ? `https://www.zhihu.com/question/${text}` : "";
}

export function buildAnswerUrl(questionId, answerId) {
  const qid = String(questionId || "").trim();
  const aid = String(answerId || "").trim();
  if (!/^\d+$/.test(aid)) {
    return "";
  }
  if (/^\d+$/.test(qid)) {
    return `https://www.zhihu.com/question/${qid}/answer/${aid}`;
  }
  return `https://www.zhihu.com/answer/${aid}`;
}

export function normalizeZhihuUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("//")) {
    return `https:${text}`;
  }
  if (text.startsWith("/")) {
    return `https://www.zhihu.com${text}`;
  }
  if (/^https?:\/\//i.test(text)) {
    return text;
  }
  return "";
}

export function normalizeZhihuContentUrl(value, { questionId = "", answerId = "" } = {}) {
  const text = String(value || "").trim();
  const apiAnswerMatch = text.match(/^https?:\/\/api\.zhihu\.com\/answers\/(\d+)/i);
  if (apiAnswerMatch) {
    return buildAnswerUrl(questionId, answerId || apiAnswerMatch[1]);
  }
  const apiQuestionMatch = text.match(/^https?:\/\/api\.zhihu\.com\/questions\/(\d+)/i);
  if (apiQuestionMatch) {
    return buildQuestionUrl(apiQuestionMatch[1]);
  }
  return normalizeZhihuUrl(text);
}

export function resolveActionUrl(message) {
  if (message.url && /^https?:\/\//i.test(message.url)) {
    return message.url;
  }
  const questionUrl = buildQuestionUrl(message.question_id);
  if (questionUrl) {
    return questionUrl;
  }
  return DEFAULT_ACTION_URLS[message.action] || DEFAULT_ACTION_URLS.open_messages;
}

export function uniqueBaseUrls(values) {
  const seen = new Set();
  const urls = [];
  for (const value of values) {
    const url = normalizeBaseUrl(value);
    if (!seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
