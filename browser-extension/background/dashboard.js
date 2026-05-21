import {
  BROWSER_DASHBOARD_PUSH_URL,
  CREATOR_AGGR_URL,
  CREATOR_ANALYSIS_METRIC_FIELDS,
  CREATOR_ANSWER_LIST_URL,
  CREATOR_DAILY_URL,
  CREATOR_HOME_URL,
  CREATOR_RECOMMEND_URL,
  DASHBOARD_ITEM_TIME_FIELDS,
  DASHBOARD_LIST_LIMIT,
  DASHBOARD_LOOKBACK_DAYS,
  DASHBOARD_MOMENTS_LIMIT,
  DASHBOARD_PUSH_SOURCE,
  DEFAULT_NOTIFICATIONS_URL,
  HOMEPAGE_TODAY_METRIC_FIELDS,
  MESSAGE_STATS_REFRESH_MIN_INTERVAL_MS,
  MOMENTS_URL,
  MS_PER_DAY,
  NOTICE_COUNT_FIELDS,
  PROFILE_URL,
  ZHIHU_AUTH_COOKIE_NAMES,
  ZHIHU_HOME_URL,
} from "./config.js";
import {
  clearBrowserAuthState,
  getState,
  saveState,
} from "./state.js";
import { closeMessageSocket } from "./messages.js";
import {
  buildAnswerUrl,
  buildQuestionUrl,
  normalizeBaseUrl,
  normalizeZhihuContentUrl,
  normalizeZhihuUrl,
} from "./urls.js";

let localMessageStatsPromise = null;
const DEFAULT_NOTIFICATION_PAGE_LIMIT = 20;
const DEFAULT_NOTIFICATION_MAX_PAGES = 3;

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseNumericValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const normalized = String(value).replace(/[^0-9.-]/g, "");
  if (!normalized || normalized === "-" || normalized === "." || normalized === "-.") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDateParam(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDashboardDateRange() {
  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (DASHBOARD_LOOKBACK_DAYS - 1));
  return {
    start: formatDateParam(startDate),
    end: formatDateParam(endDate),
  };
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    const millis = value < 1e12 ? value * 1000 : value;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }
  if (/^\d+(\.\d+)?$/.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) {
      return null;
    }
    const millis = num < 1e12 ? num * 1000 : num;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickTimestampValue(node, fields = DASHBOARD_ITEM_TIME_FIELDS) {
  if (!node || typeof node !== "object") {
    return "";
  }
  const candidates = [
    node,
    node.answer,
    node.question,
    node.target,
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    for (const field of fields) {
      const value = candidate[field];
      if (parseDateValue(value)) {
        return value;
      }
    }
  }
  return "";
}

function isWithinDashboardWindow(value) {
  const date = parseDateValue(value);
  if (!date) {
    return false;
  }
  const now = Date.now();
  return (
    date.getTime() >= now - DASHBOARD_LOOKBACK_DAYS * MS_PER_DAY &&
    date.getTime() <= now + 60_000
  );
}

function hasRecentDashboardTimestamp(item) {
  const timestamp = pickTimestampValue(item);
  return !timestamp || isWithinDashboardWindow(timestamp);
}

function toNumber(value) {
  const parsed = parseNumericValue(value);
  return parsed === null ? 0 : Math.max(0, Math.floor(parsed));
}

function firstNumberValue(values) {
  if (!Array.isArray(values)) {
    return 0;
  }
  for (const value of values) {
    const parsed = parseNumericValue(value);
    if (parsed !== null) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return 0;
}

function findByKeys(payload, candidates, predicate) {
  const targetKeys = new Set(candidates.map(normalizeKey));
  let best;

  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== "object") {
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item);
        if (best !== undefined) {
          return;
        }
      }
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (targetKeys.has(normalizeKey(key)) && (!predicate || predicate(value))) {
        best = value;
        return;
      }
      visit(value);
      if (best !== undefined) {
        return;
      }
    }
  };

  visit(payload);
  return best;
}

function findMetricValue(payload, aliases) {
  if (!payload) {
    return null;
  }
  for (const alias of aliases.map(normalizeKey)) {
    const value = findByKeys(payload, [alias], (v) => parseNumericValue(v) !== null);
    const parsed = parseNumericValue(value);
    if (parsed !== null) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function findMetricFromPayloads(payloads, aliases) {
  for (const payload of payloads) {
    const value = findMetricValue(payload, aliases);
    if (value !== null) {
      return value;
    }
  }
  return 0;
}

function findTodayMetric({ homepageData, dailyData, aggrData }, metric) {
  return findMetricFromPayloads(
    [homepageData, dailyData, aggrData],
    [
      ...(HOMEPAGE_TODAY_METRIC_FIELDS[metric] || []),
      ...(CREATOR_ANALYSIS_METRIC_FIELDS[metric] || []),
    ]
  );
}

function extractNoticeCount(data, keys) {
  const value = findMetricValue(data, Array.isArray(keys) ? keys : [keys]);
  return value === null ? 0 : value;
}

function sumNoticeCounts(data, keys) {
  return (Array.isArray(keys) ? keys : [keys]).reduce(
    (total, key) => total + extractNoticeCount(data, key),
    0
  );
}

function isUnreadNotification(item) {
  return item?.is_read === false;
}

function isCommentNotification(item) {
  const target = item?.target && typeof item.target === "object" ? item.target : {};
  const verb = String(item?.content?.verb || "");
  const targetUrl = String(target?.url || "");
  return (
    target?.type === "comment" ||
    targetUrl.includes("/comments/") ||
    /评论|回复/.test(verb)
  );
}

function notificationMergeCount(item) {
  const count = toNumber(item?.merge_count);
  return count > 0 ? count : 1;
}

function sanitizeCommentNotification(item) {
  const target = item?.target && typeof item.target === "object" ? item.target : {};
  const nestedTarget =
    target?.target && typeof target.target === "object" ? target.target : {};
  const content = item?.content && typeof item.content === "object" ? item.content : {};
  const contentTarget =
    content?.target && typeof content.target === "object" ? content.target : {};
  const extend = content?.extend && typeof content.extend === "object" ? content.extend : {};
  const actors = Array.isArray(content?.actors) ? content.actors : [];

  return {
    id: String(item?.id || target?.id || ""),
    is_read: item?.is_read === true,
    merge_count: notificationMergeCount(item),
    verb: stripHtmlText(content?.verb),
    actor_names: actors
      .map((actor) => stripHtmlText(actor?.name))
      .filter(Boolean)
      .slice(0, 3),
    target_title: stripHtmlText(contentTarget?.text || nestedTarget?.title || ""),
    target_url: normalizeZhihuUrl(contentTarget?.link || nestedTarget?.url),
    comment_text: trimText(
      stripHtmlText(extend?.text || target?.content || ""),
      160
    ),
    create_time: item?.create_time || target?.created_time || "",
    resource_type: target?.resource_type || nestedTarget?.resource_type || nestedTarget?.type || "",
  };
}

function normalizeNotificationPageUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("http://www.zhihu.com/")) {
    return `https://${text.slice("http://".length)}`;
  }
  if (text.startsWith("//www.zhihu.com/")) {
    return `https:${text}`;
  }
  if (text.startsWith("/")) {
    return `https://www.zhihu.com${text}`;
  }
  return text;
}

async function fetchDefaultNotificationSummary() {
  let url =
    `${DEFAULT_NOTIFICATIONS_URL}?` +
    new URLSearchParams({
      limit: String(DEFAULT_NOTIFICATION_PAGE_LIMIT),
    }).toString();
  const visited = new Set();
  let unreadCommentCount = 0;
  const unreadCommentItems = [];

  for (let page = 0; page < DEFAULT_NOTIFICATION_MAX_PAGES && url; page += 1) {
    const normalizedUrl = normalizeNotificationPageUrl(url);
    if (!normalizedUrl || visited.has(normalizedUrl)) {
      break;
    }
    visited.add(normalizedUrl);

    const result = await fetchZhihuJson(normalizedUrl).catch(() => ({ ok: false }));
    if (!result.ok || !result.data) {
      return { ok: false, unreadCommentCount: null };
    }

    const items = toArray(result.data);
    const unreadItems = items.filter(isUnreadNotification);
    for (const item of unreadItems) {
      if (isCommentNotification(item)) {
        unreadCommentCount += notificationMergeCount(item);
        unreadCommentItems.push(sanitizeCommentNotification(item));
      }
    }

    if (!unreadItems.length || result.data?.paging?.is_end) {
      break;
    }
    url = normalizeNotificationPageUrl(result.data?.paging?.next);
  }

  return { ok: true, unreadCommentCount, unreadCommentItems };
}

function calcNoticeMetrics(meData, notificationSummary = null) {
  const unreadCount = sumNoticeCounts(meData, NOTICE_COUNT_FIELDS.unread);
  const followCount = extractNoticeCount(meData, NOTICE_COUNT_FIELDS.follow);
  const voteCount = extractNoticeCount(meData, NOTICE_COUNT_FIELDS.vote);
  const commentCount =
    notificationSummary?.ok && notificationSummary.unreadCommentCount !== null
      ? notificationSummary.unreadCommentCount
      : extractNoticeCount(meData, NOTICE_COUNT_FIELDS.comment);
  return {
    unread: unreadCount,
    follow: followCount,
    vote: voteCount,
    comment: commentCount,
    total: unreadCount + followCount + voteCount + commentCount,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function latestNoticeTime(meData) {
  return firstPresentText([
    meData?.message_updated_time,
    meData?.updated_time,
    meData?.notifications_updated_time,
  ]) || "刚刚";
}

function buildLocalMessageOverview(previousOverview, noticeMetrics, noticeTime, capturedAt) {
  const previousToday = isPlainObject(previousOverview?.today)
    ? previousOverview.today
    : {};
  const previousNotifications = isPlainObject(previousOverview?.notifications)
    ? previousOverview.notifications
    : {};

  const today = {
    ...previousToday,
    agree: noticeMetrics.vote,
    agree_time: noticeTime,
    comment: noticeMetrics.comment,
    comment_time: noticeTime,
    message: noticeMetrics.unread,
    message_time: noticeTime,
  };
  const notifications = {
    ...previousNotifications,
    unread: noticeMetrics.unread,
    unread_time: noticeTime,
    follow: noticeMetrics.follow,
    follow_time: noticeTime,
    vote: noticeMetrics.vote,
    vote_time: noticeTime,
    comment: noticeMetrics.comment,
    comment_time: noticeTime,
    total: noticeMetrics.total,
    total_time: noticeTime,
  };

  return {
    captured_at: capturedAt,
    today,
    notifications,
  };
}

async function pushDashboardPayload(state, payload) {
  const response = await fetch(
    `${normalizeBaseUrl(state.serverBaseUrl)}${BROWSER_DASHBOARD_PUSH_URL}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.browserToken}`,
      },
      body: JSON.stringify(payload),
    }
  );

  if (response.ok) {
    return { ok: true };
  }
  if (response.status === 401) {
    closeMessageSocket();
    await clearBrowserAuthState();
    return {
      ok: false,
      error: "登录已失效，请重新登录",
    };
  }
  return {
    ok: false,
    error: `服务端上报失败：HTTP ${response.status}`,
  };
}

function firstPresentText(values) {
  if (!Array.isArray(values)) {
    return "";
  }
  for (const value of values) {
    if (typeof value === "string") {
      const text = value.trim();
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function trimText(value, maxLen = 80) {
  const text = String(value || "");
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}…`;
}

function stripHtmlText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function resolveRecommendationUrl(item) {
  const question = item?.question && typeof item.question === "object" ? item.question : {};
  const target = item?.target && typeof item.target === "object" ? item.target : {};
  const action = item?.action && typeof item.action === "object" ? item.action : {};
  const operations = item?.operations && typeof item.operations === "object" ? item.operations : {};

  for (const value of [
    item?.question_url,
    question?.url,
    target?.question_url,
  ]) {
    const url = normalizeZhihuUrl(value);
    if (url) {
      return url;
    }
  }

  for (const value of [
    item?.question_id,
    item?.qid,
    question?.id,
    question?.question_id,
    question?.url_token,
    target?.question_id,
    target?.id,
  ]) {
    const url = buildQuestionUrl(value);
    if (url) {
      return url;
    }
  }

  for (const value of [
    item?.url,
    target?.url,
    item?.link,
    item?.write_answer_url,
    item?.answer_url,
    item?.action_url,
    action?.url,
    operations?.url,
    question?.action_url,
    question?.answer_url,
  ]) {
    const url = normalizeZhihuUrl(value);
    if (url) {
      return url;
    }
  }

  return "";
}

function toArray(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.data?.data)) {
    return payload.data.data;
  }
  return [];
}

function pickRecommendList(payload) {
  const flat = toArray(payload);
  if (flat.length) {
    return flat;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }
  return [];
}

function sanitizeRecommendationList(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  const findCandidate = (item, keys) => {
    const candidates = Array.isArray(keys) ? keys : [keys];
    for (const key of candidates) {
      if (item?.[key] !== undefined && item?.[key] !== null) {
        return item[key];
      }
      if (item?.question?.[key] !== undefined && item?.question?.[key] !== null) {
        return item.question[key];
      }
    }
    return "";
  };

  return items
    .filter((item) => item && typeof item === "object")
    .filter(hasRecentDashboardTimestamp)
    .slice(0, DASHBOARD_LIST_LIMIT)
    .map((item) => ({
      title: firstPresentText([
        item?.title,
        item?.question?.title,
        item?.target?.title,
        item?.question_title,
        item?.name,
      ]),
      content: trimText(
        firstPresentText([
          item?.content,
          item?.excerpt,
          item?.description,
          item?.summary,
        ]),
        220
      ),
      url: resolveRecommendationUrl(item),
      reason: firstPresentText([
        stripHtmlText(item?.reason),
        stripHtmlText(item?.recommend_reason),
        stripHtmlText(item?.recommend_reason_text),
      ]),
      action: firstPresentText([
        stripHtmlText(item?.action_text),
        stripHtmlText(item?.action?.text),
        stripHtmlText(item?.operation_text),
      ]),
      read_count: toNumber(
        findCandidate(item, ["read_count", "reads", "pv", "view_count", "views_count", "views", "show"])
      ),
      answer_count: toNumber(
        findCandidate(item, ["answer_count", "answers_count", "answer_num", "answers_num"])
      ),
      follower_count: toNumber(
        findCandidate(item, ["follower_count", "followers_count", "follow_count"])
      ),
      comment_count: toNumber(
        findCandidate(item, ["comment_count", "comments_count", "comment_num"])
      ),
      updated_time:
        item?.updated_time || item?.created_time || item?.updated_at || item?.created || "",
      action_url:
        normalizeZhihuUrl(item?.action_url) ||
        normalizeZhihuUrl(item?.action?.url) ||
        normalizeZhihuUrl(item?.operations?.url) ||
        normalizeZhihuUrl(item?.question?.action_url) ||
        "",
      write_answer_url:
        normalizeZhihuUrl(item?.write_answer_url) ||
        normalizeZhihuUrl(item?.answer_url) ||
        normalizeZhihuUrl(item?.question?.answer_url) ||
        ""
    }))
    .filter((item) => item.title);
}

function sanitizeRecommendedAnswers(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && typeof item === "object")
    .filter((item) => {
      const target = item?.target || {};
      return target?.type === "answer" || item?.type === "answer" || item?.answer_id;
    })
    .slice(0, DASHBOARD_LIST_LIMIT)
    .map((item) => {
      const target = item?.target || {};
      const question = target?.question || item?.question || {};
      const author = target?.author || item?.author || {};
      const actor = Array.isArray(item?.actors) ? item.actors[0] || {} : {};
      const answerId = String(item?.answer_id || target?.id || item?.id || "").trim();
      const questionId = String(item?.question_id || question?.id || target?.question_id || "").trim();
      const url =
        normalizeZhihuContentUrl(item?.url || item?.answer_url || target?.url, {
          questionId,
          answerId,
        }) || buildAnswerUrl(questionId, answerId);

      return {
        id: answerId || item?.id || "",
        answer_id: answerId,
        question_id: /^\d+$/.test(questionId) ? questionId : "",
        title: firstPresentText([
          stripHtmlText(item?.title),
          stripHtmlText(item?.question_title),
          stripHtmlText(question?.title),
          stripHtmlText(target?.title),
        ]),
        excerpt: trimText(
          firstPresentText([
            stripHtmlText(item?.excerpt),
            stripHtmlText(item?.content),
            stripHtmlText(target?.excerpt),
            stripHtmlText(target?.excerpt_new),
            stripHtmlText(target?.content),
          ]),
          220
        ),
        action_text: stripHtmlText(item?.action_text),
        actor_name: stripHtmlText(item?.actor_name || actor?.name),
        author_name: stripHtmlText(item?.author_name || author?.name),
        voteup_count: firstNumberValue([
          item?.voteup_count,
          item?.upvote_count,
          item?.agree_count,
          target?.voteup_count,
          target?.upvote_count,
          target?.agree_count,
        ]),
        comment_count: firstNumberValue([
          item?.comment_count,
          item?.comments_count,
          target?.comment_count,
          target?.comments_count,
        ]),
        updated_time:
          item?.updated_time || item?.created_time || target?.updated_time || target?.created_time || "",
        created_time:
          item?.created_time || target?.created_time || "",
        url,
      };
    })
    .filter((item) => item.title && item.url);
}

function sanitizeAnswers(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && typeof item === "object")
    .filter(hasRecentDashboardTimestamp)
    .slice(0, DASHBOARD_LIST_LIMIT)
    .map((item) => {
      const answer = item?.answer || {};
      const answerUrlToken = answer?.url_token || item?.url_token || "";
      const answerId = answer?.id || item?.id || "";
      const answerUrl = answer?.url || item?.url || "";
      const questionUrl = item?.question?.url || item?.question_url || "";
      const questionId = answer?.question_id || "";
      const createdAt = answer?.created_time || item?.created_time || answer?.created || item?.created || "";
      const voteupCount = firstNumberValue([
        item?.voteup_count,
        item?.upvote_count,
        item?.agree_count,
        item?.upvote,
        item?.vote,
        answer?.voteup_count,
        answer?.upvote_count,
        answer?.agree_count,
      ]);
      const commentCount = firstNumberValue([
        item?.comment_count,
        item?.comments_count,
        item?.comment_num,
        item?.comment,
        answer?.comment_count,
        answer?.comments_count,
        answer?.comment_num,
      ]);

      return {
        id: answerId,
        question_title: firstPresentText([
          item?.question_title,
          item?.question?.title,
          item?.title,
          answer?.title,
        ]),
        excerpt: trimText(
          firstPresentText([
            item?.excerpt,
            item?.summary,
            item?.description,
            item?.content,
            item?.question?.excerpt,
            answer?.excerpt,
            answer?.content,
          ]),
          220
        ),
        question_url:
          questionUrl ||
          (questionId ? `https://www.zhihu.com/question/${questionId}` : "") ||
          (answerUrlToken ? `https://www.zhihu.com/answer/${answerUrlToken}` : ""),
        answer_url:
          item?.answer_url ||
          answerUrl ||
          (answerUrlToken ? `https://www.zhihu.com/answer/${answerUrlToken}` : item?.url_name || ""),
        voteup_count: voteupCount,
        comment_count: commentCount,
        updated_at: answer?.updated_time || item?.updated_time || item?.updated_at || "",
        created_at: createdAt,
        read_count: toNumber(item?.pv || item?.view || item?.views || item?.show || 0),
        upvote_count: voteupCount,
        like_count: toNumber(item?.like || item?.like_count || 0),
        collect_count: toNumber(item?.collect || item?.favorite_count || item?.favorites_count || 0),
        share_count: toNumber(item?.share || item?.share_count || 0),
      };
    })
    .filter((item) => item.question_title);
}

function pickAvatar(profile) {
  if (!profile || typeof profile !== "object") {
    return "liukanshan-avatar.jpg";
  }
  return profile.avatar_url || profile.image_url || profile.avatar || "liukanshan-avatar.jpg";
}

function pickName(profile) {
  if (!profile || typeof profile !== "object") {
    return "未登录";
  }
  return profile.name || profile.username || profile.account || profile.url_token || "未登录";
}

function hasValidZhihuProfile(profile) {
  if (!profile || typeof profile !== "object" || profile.error) {
    return false;
  }
  return Boolean(
    profile.id ||
      profile.uid ||
      profile.url_token ||
      profile.name ||
      profile.username ||
      profile.account ||
      profile.member
  );
}

function pickMemberSlug(meData) {
  if (!meData || typeof meData !== "object") {
    return "";
  }
  return String(meData.url_token || meData.member?.url_token || meData.slug || "");
}

async function hasZhihuAuthCookie() {
  if (!chrome.cookies?.get) {
    return false;
  }

  for (const name of ZHIHU_AUTH_COOKIE_NAMES) {
    const hasCookie = await new Promise((resolve) => {
      chrome.cookies.get(
        {
          url: ZHIHU_HOME_URL,
          name,
        },
        (cookie) => {
          resolve(!chrome.runtime.lastError && Boolean(cookie?.value));
        }
      );
    });
    if (hasCookie) {
      return true;
    }
  }

  return false;
}

async function fetchZhihuJson(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "fetch",
      "x-zse-93": "101_3_3.0"
    }
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  try {
    return { ok: true, data: await response.json() };
  } catch {
    return { ok: false, status: response.status };
  }
}

export async function validateZhihuSession() {
  const zhihuCookieDetected = await hasZhihuAuthCookie();
  const result = await fetchZhihuJson(PROFILE_URL).catch((error) => ({
    ok: false,
    error: error?.message || "知乎登录态检查失败",
  }));

  if (result.ok && hasValidZhihuProfile(result.data)) {
    return {
      ok: true,
      zhihuCookieDetected,
      zhihuApiReadable: true,
      profileName: pickName(result.data),
    };
  }

  if (zhihuCookieDetected) {
    return {
      ok: true,
      zhihuCookieDetected: true,
      zhihuApiReadable: false,
      warning: result.status
        ? `知乎网页登录态存在，但接口暂时不可读：HTTP ${result.status}`
        : result.error || "知乎网页登录态存在，但接口暂时不可读",
    };
  }

  if (result.status === 401 || result.status === 403) {
    return {
      ok: false,
      zhihuLoggedOut: true,
      error: "知乎登录态已失效，请打开知乎重新登录",
    };
  }

  return {
    ok: false,
    error: result.status
      ? `知乎登录态检查失败：HTTP ${result.status}`
      : result.error || "知乎登录态检查失败",
  };
}

async function loadAnswers(memberSlug) {
  const contentListUrl =
    `${CREATOR_ANSWER_LIST_URL}?` +
    new URLSearchParams({
      type: "answer",
      offset: "0",
      limit: String(DASHBOARD_LIST_LIMIT),
    }).toString();

  const primaryResult = await fetchZhihuJson(contentListUrl);
  if (primaryResult.ok) {
    const source = toArray(primaryResult.data);
    if (source.length > 0) {
      return sanitizeAnswers(source);
    }
  }

  if (!memberSlug) {
    return [];
  }

  const fallbackUrl =
    `https://www.zhihu.com/api/v4/members/${encodeURIComponent(memberSlug)}/answers?` +
    new URLSearchParams({
      limit: String(DASHBOARD_LIST_LIMIT),
      offset: "0",
      include: "content,excerpt,question,updated_time,url"
    }).toString();

  const fallbackResult = await fetchZhihuJson(fallbackUrl);
  if (!fallbackResult.ok || !fallbackResult.data) {
    return [];
  }

  return sanitizeAnswers(toArray(fallbackResult.data));
}

export async function reportDashboardSnapshot() {
  const state = await getState();
  if (!state.browserToken) {
    return {
      ok: false,
      error: "未登录，请先登录插件",
    };
  }

  const { start, end } = getDashboardDateRange();

  const [
    meResult,
    homepageResult,
    dailyResult,
    aggrResult,
    recommendResult,
    momentsResult,
    defaultNotificationsResult,
  ] =
    await Promise.all([
      fetchZhihuJson(PROFILE_URL).catch(() => ({ ok: false })),
      fetchZhihuJson(CREATOR_HOME_URL).catch(() => ({ ok: false })),
      fetchZhihuJson(`${CREATOR_DAILY_URL}&start=${start}&end=${end}`).catch(() => ({ ok: false })),
      fetchZhihuJson(`${CREATOR_AGGR_URL}&start=${start}&end=${end}`).catch(() => ({ ok: false })),
      fetchZhihuJson(
        `${CREATOR_RECOMMEND_URL}?` +
          new URLSearchParams({
            limit: String(DASHBOARD_LIST_LIMIT),
            offset: "0",
            page_source: "web_author_recommend",
            recom_domain_score_ab: "1"
          }).toString()
      ).catch(() => ({ ok: false })),
      fetchZhihuJson(
        `${MOMENTS_URL}?` +
          new URLSearchParams({
            limit: String(DASHBOARD_MOMENTS_LIMIT),
            desktop: "true"
          }).toString()
      ).catch(() => ({ ok: false })),
      fetchDefaultNotificationSummary(),
    ]);

  if (!meResult.ok || !hasValidZhihuProfile(meResult.data)) {
    return {
      ok: false,
      error: await zhihuProfileUnavailableError(
        "读取知乎数据失败，请确认已登录知乎"
      ),
    };
  }

  const meData = meResult.data;
  const homepageData = homepageResult.ok ? homepageResult.data : null;
  const dailyData = dailyResult.ok ? dailyResult.data : null;
  const aggrData = aggrResult.ok ? aggrResult.data : null;
  const todaySource = { homepageData, dailyData, aggrData };
  const noticeMetrics = calcNoticeMetrics(meData, defaultNotificationsResult);
  const dataRefreshedAt = new Date().toISOString();
  const answers = await loadAnswers(pickMemberSlug(meData)).catch(() => []);

  const payload = {
    source: DASHBOARD_PUSH_SOURCE,
    captured_at: dataRefreshedAt,
    profile: {
      name: pickName(meData),
      avatar_url: pickAvatar(meData),
      ...meData,
      data_refreshed_at: dataRefreshedAt,
    },
    today: {
      read: findTodayMetric(todaySource, "read"),
      read_time: "今天",
      agree: noticeMetrics.vote,
      agree_time: "刚刚",
      comment: findTodayMetric(todaySource, "comment"),
      comment_time: "今天",
      message: noticeMetrics.unread,
      message_time: "刚刚",
    },
    notifications: {
      unread: noticeMetrics.unread,
      unread_time: "刚刚",
      follow: noticeMetrics.follow,
      follow_time: "刚刚",
      vote: noticeMetrics.vote,
      vote_time: "刚刚",
      comment: noticeMetrics.comment,
      comment_time: "刚刚",
      comment_source: defaultNotificationsResult?.ok
        ? "notifications_v2_default"
        : "profile_include",
      comment_items: defaultNotificationsResult?.unreadCommentItems || [],
      total: noticeMetrics.total,
      total_time: "刚刚",
    },
    recommendations: sanitizeRecommendationList(
      pickRecommendList(recommendResult?.data || [])
    ),
    recommended_answers: sanitizeRecommendedAnswers(toArray(momentsResult?.data || [])),
    answers,
  };

  const pushResult = await pushDashboardPayload(state, payload);
  if (pushResult.ok) {
    await saveState({
      dashboardOverview: {
        captured_at: dataRefreshedAt,
        today: payload.today,
        notifications: payload.notifications,
      },
      zhihuDataRefreshedAt: dataRefreshedAt,
      lastDashboardReportedAt: dataRefreshedAt,
    });
    return {
      ok: true,
      capturedAt: dataRefreshedAt,
    };
  }

  return pushResult;
}

async function zhihuProfileUnavailableError(fallback) {
  if (await hasZhihuAuthCookie()) {
    return "知乎网页登录态存在，但接口暂时不可读，请稍后再试或刷新知乎页面";
  }
  return fallback;
}

export async function refreshLocalMessageStats(options = {}) {
  if (localMessageStatsPromise) {
    return localMessageStatsPromise;
  }

  localMessageStatsPromise = refreshLocalMessageStatsOnce(options).finally(() => {
    localMessageStatsPromise = null;
  });
  return localMessageStatsPromise;
}

async function refreshLocalMessageStatsOnce({ force = false } = {}) {
  const state = await getState();
  if (!state.browserToken) {
    return {
      ok: false,
      skipped: true,
      error: "未登录，请先登录插件",
    };
  }

  const cached = await chrome.storage.local.get({
    dashboardOverview: null,
    lastMessageStatsRefreshedAt: "",
  });
  if (!force) {
    const lastRefreshedAt = Date.parse(cached.lastMessageStatsRefreshedAt || "");
    if (
      Number.isFinite(lastRefreshedAt) &&
      Date.now() - lastRefreshedAt < MESSAGE_STATS_REFRESH_MIN_INTERVAL_MS
    ) {
      return { ok: true, skipped: true };
    }
  }

  const [meResult, defaultNotificationsResult] = await Promise.all([
    fetchZhihuJson(PROFILE_URL).catch(() => ({ ok: false })),
    fetchDefaultNotificationSummary(),
  ]);
  if (!meResult.ok || !hasValidZhihuProfile(meResult.data)) {
    return {
      ok: false,
      error: await zhihuProfileUnavailableError(
        "读取知乎消息统计失败，请确认已登录知乎"
      ),
    };
  }

  const dataRefreshedAt = new Date().toISOString();
  const meData = meResult.data;
  const noticeMetrics = calcNoticeMetrics(meData, defaultNotificationsResult);
  const noticeTime = latestNoticeTime(meData);
  const overview = buildLocalMessageOverview(
    cached.dashboardOverview,
    noticeMetrics,
    noticeTime,
    dataRefreshedAt
  );

  await saveState({
    dashboardOverview: overview,
    zhihuDataRefreshedAt: dataRefreshedAt,
    lastMessageStatsRefreshedAt: dataRefreshedAt,
  });
  return {
    ok: true,
    capturedAt: dataRefreshedAt,
    messageCount: noticeMetrics.unread,
  };
}
