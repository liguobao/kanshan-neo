const PROFILE_INCLUDE_FIELDS = [
  "is_realname",
  "ad_type",
  "available_message_types",
  "default_notifications_count",
  "follow_notifications_count",
  "vote_thank_notifications_count",
  "comment_notification_count",
  "messages_count",
];
const PROFILE_URL =
  `https://www.zhihu.com/api/v4/me?include=${PROFILE_INCLUDE_FIELDS.join(",")}`;
const CREATOR_DAILY_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/member/daily?tab=all";
const CREATOR_HOME_URL = "https://www.zhihu.com/api/v4/creators/homepage";
const CREATOR_AGGR_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/member/aggr?tab=all";
const CREATOR_RECOMMEND_URL =
  "https://www.zhihu.com/api/v4/creators/question_route/author_related/recommend";
const CREATOR_ANSWER_LIST_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/content/list";
const MOMENTS_URL = "https://www.zhihu.com/api/v3/moments";
const BROWSER_DASHBOARD_PUSH_URL = "/api/browser/dashboard";
const DASHBOARD_REPORT_INTERVAL_MS = 10 * 60 * 1000;
const DASHBOARD_PUSH_SOURCE = "browser_extension";
const DASHBOARD_LOOKBACK_DAYS = 7;
const DASHBOARD_LIST_LIMIT = 40;
const DASHBOARD_MOMENTS_LIMIT = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DEFAULT_SERVER_BASE_URL = "https://kanshan.r2049.cn";

const dashboardStatusEl = document.getElementById("dashboard-status");
const refreshDashboardEl = document.getElementById("refresh-dashboard");
const pushDashboardEl = document.getElementById("push-dashboard");
const openPopupEl = document.getElementById("open-popup");

const profileAvatarEl = document.getElementById("profile-avatar");
const profileNameEl = document.getElementById("profile-name");
const profileAuthEl = document.getElementById("profile-auth");
const profileAuthTimeEl = document.getElementById("profile-auth-time");

const todayReadEl = document.getElementById("today-read");
const todayAgreeEl = document.getElementById("today-agree");
const todayCommentEl = document.getElementById("today-comment");
const todayMessageEl = document.getElementById("today-message");
const todayReadTimeEl = document.getElementById("today-read-time");
const todayAgreeTimeEl = document.getElementById("today-agree-time");
const todayCommentTimeEl = document.getElementById("today-comment-time");
const todayMessageTimeEl = document.getElementById("today-message-time");

const recommendListEl = document.getElementById("recommend-list");
const answersBodyEl = document.getElementById("answers-body");

const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");

const DEFAULT_AUTHORIZED_FALLBACK = "未授权";
let latestDashboardPayload = null;
let dashboardPushTimer = null;
let isPushingDashboard = false;
let isLoadingDashboard = false;

const NOTICE_COUNT_FIELDS = {
  unread: ["default_notifications_count", "messages_count"],
  follow: ["follow_notifications_count"],
  vote: ["vote_thank_notifications_count"],
  comment: ["comment_notification_count"],
};

const HOMEPAGE_TODAY_METRIC_FIELDS = {
  read: ["today_read_count"],
  agree: ["today_upvoted_count", "today_incr_upvoted_count"],
  comment: ["today_comment_count", "today_comment_num", "today_comments_count"],
};

const CREATOR_ANALYSIS_METRIC_FIELDS = {
  read: ["read_count", "reads", "view_count", "views_count", "pv", "pv_count"],
  agree: ["voteup_count", "agree_count", "like_count", "upvote_count", "vote_count"],
  comment: ["comment_count", "comments_count", "comment_num"],
};

const DASHBOARD_ITEM_TIME_FIELDS = [
  "updated_time",
  "created_time",
  "updated_at",
  "created_at",
  "created",
  "time",
];

function normalizeServerBaseUrl(baseUrl) {
  const normalized = String(baseUrl || DEFAULT_SERVER_BASE_URL).trim().replace(/\/+$/, "");

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

function fmtNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "-";
  }
  return String(Math.max(0, Math.floor(num)));
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatDateOnly(value) {
  if (!value) {
    return "-";
  }
  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function relativeTime(value) {
  if (!value) {
    return "刚刚";
  }

  const date = parseDateValue(value);
  if (!date) {
    return "-";
  }

  const diff = Date.now() - date.getTime();
  if (diff <= 0) {
    return "刚刚";
  }
  if (diff < 60_000) {
    return "刚刚";
  }
  if (diff < 60 * 60_000) {
    return `${Math.floor(diff / 60_000)} 分钟前`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.floor(diff / (60 * 60_000))} 小时前`;
  }
  return formatDateTime(date);
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
  return parsed === null ? 0 : parsed;
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

function calcNoticeMetrics(meData) {
  const unreadCount = sumNoticeCounts(meData, NOTICE_COUNT_FIELDS.unread);
  const followCount = extractNoticeCount(meData, NOTICE_COUNT_FIELDS.follow);
  const voteCount = extractNoticeCount(meData, NOTICE_COUNT_FIELDS.vote);
  const commentCount = extractNoticeCount(meData, NOTICE_COUNT_FIELDS.comment);
  return {
    unread: unreadCount,
    follow: followCount,
    vote: voteCount,
    comment: commentCount,
    total: unreadCount + followCount + voteCount,
  };
}

function normalizeKey(value) {
  return String(value || "").trim().toLowerCase();
}

function findByKeys(payload, candidates, predicate) {
  const targetKeys = new Set(candidates.map(normalizeKey));
  let best;

  const visit = (node, depth = 0) => {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node !== "object") {
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, depth + 1);
      }
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      const lowerKey = normalizeKey(key);
      if (targetKeys.has(lowerKey)) {
        if (!predicate || predicate(value)) {
          best = value;
          return;
        }
      }
      if (best !== undefined) {
        return;
      }
      visit(value, depth + 1);
      if (best !== undefined) {
        return;
      }
    }
  };

  visit(payload);
  return best;
}

function latestTime(payload, candidates) {
  const target = findByKeys(payload, candidates, (value) => parseDateValue(value) !== null);
  if (!target) {
    return "";
  }
  return relativeTime(target);
}

function trimText(value, maxLen = 80) {
  const text = String(value || "");
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen)}…`;
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

function stripHtmlText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeZhihuUrl(value) {
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

function buildQuestionUrl(value) {
  const text = String(value || "").trim();
  return /^\d+$/.test(text) ? `https://www.zhihu.com/question/${text}` : "";
}

function buildAnswerUrl(questionId, answerId) {
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

function normalizeZhihuContentUrl(value, { questionId = "", answerId = "" } = {}) {
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

function buildDashboardSnapshotPayload({
  meData,
  avatarUrl,
  dataRefreshedAt,
  todayMetrics,
  noticeMetrics,
  recommendations,
  recommendedAnswers,
  answers,
}) {
  const capturedAt = dataRefreshedAt || new Date().toISOString();
  return {
    source: DASHBOARD_PUSH_SOURCE,
    captured_at: capturedAt,
    profile: {
      name: pickName(meData),
      avatar_url: avatarUrl || "liukanshan-avatar.jpg",
      ...meData,
      data_refreshed_at: capturedAt,
    },
    today: todayMetrics,
    notifications: noticeMetrics,
    recommendations: recommendations,
    recommended_answers: recommendedAnswers || [],
    answers: answers,
  };
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

  const pickText = (candidates, fallback = "") =>
    firstPresentText(candidates.map((item) => stripHtmlText(item)).filter(Boolean)) || fallback;

  const findCandidate = (item, keys) => {
    const candidates = Array.isArray(keys) ? keys : [keys];
    for (const key of candidates) {
      if (item?.[key] !== undefined && item?.[key] !== null) {
        return item?.[key];
      }
      if (item?.question?.[key] !== undefined && item?.question?.[key] !== null) {
        return item?.question?.[key];
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
      reason: pickText([
        item?.reason,
        item?.recommend_reason,
        item?.recommend_reason_text,
        item?.reason_text,
        item?.action?.reason,
      ]),
      action: pickText([
        item?.action_text,
        item?.action?.text,
        item?.action?.name,
        item?.operation_text,
        item?.operation,
        item?.operation_title,
        item?.button_text,
      ]),
      write_hint: pickText([
        item?.write_action_text,
        item?.write_answer_text,
        item?.write_text,
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
      created_time:
        item?.created_time || item?.created || item?.question?.created_time || item?.question?.created || "",
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
        question_title:
          firstPresentText([
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
        updated_at: answer?.updated_time || item?.updated_time || item?.updated_at || "",
        created_at: createdAt,
        read_count: toNumber(item?.pv || item?.view || item?.views || item?.show || 0),
        upvote_count: voteupCount,
        comment_count: commentCount,
        like_count: toNumber(item?.like || item?.like_count || 0),
        collect_count: toNumber(item?.collect || item?.favorite_count || item?.favorites_count || 0),
        share_count: toNumber(item?.share || item?.share_count || 0),
      };
    });
}

function pickAvatar(profile) {
  if (!profile || typeof profile !== "object") {
    return "liukanshan-avatar.jpg";
  }
  if (typeof profile.avatar_url === "string" && profile.avatar_url) {
    return profile.avatar_url;
  }
  if (typeof profile.image_url === "string" && profile.image_url) {
    return profile.image_url;
  }
  if (profile?.avatar && typeof profile.avatar === "string") {
    return profile.avatar;
  }
  return "liukanshan-avatar.jpg";
}

function pickName(profile) {
  if (!profile || typeof profile !== "object") {
    return "未登录";
  }
  return (
    profile.name ||
    profile.username ||
    profile.account ||
    profile.url_token ||
    "未登录"
  );
}

function pickMemberSlug(meData) {
  if (!meData || typeof meData !== "object") {
    return "";
  }
  return String(meData.url_token || meData.member?.url_token || meData.slug || "");
}

function findMetricValue(payload, aliases) {
  if (!payload) {
    return null;
  }
  const aliasSet = aliases.map((alias) => normalizeKey(alias));
  for (const alias of aliasSet) {
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
    return {
      ok: false,
      status: response.status,
      message:
        response.status === 401 || response.status === 403
          ? "未检测到知乎登录态，请先在知乎页面登录。"
          : `知乎接口异常（HTTP ${response.status}）`
    };
  }

  try {
    const data = await response.json();
    return {
      ok: true,
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: response.status,
      message: `响应解析失败：${error?.message || "请稍后重试"}`
    };
  }
}

function buildRecommendNode(item) {
  const title = firstPresentText([
    item?.title,
    item?.question?.title,
    item?.target?.title,
    item?.question_title,
    item?.name,
  ]);
  const content = firstPresentText([
    item?.content,
    item?.excerpt,
    item?.description,
    item?.summary,
  ]);
  const url = resolveRecommendationUrl(item);
  const time = relativeTime(
    item?.updated_time || item?.created_time || item?.created || item?.created_at
  );
  const readCount = toNumber(item?.read_count);
  const answerCount = toNumber(item?.answer_count);
  const followerCount = toNumber(item?.follower_count);
  const commentCount = toNumber(item?.comment_count);
  const reason = firstPresentText([item?.reason, item?.recommend_reason]);
  const action = firstPresentText([
    item?.action,
    item?.action_text,
    item?.operation,
    item?.operation_text
  ]);
  const writeHint = firstPresentText([item?.write_hint, item?.write_action_text, item?.write_answer_text]);
  const actionUrl =
    normalizeZhihuUrl(item?.action_url) ||
    normalizeZhihuUrl(item?.write_answer_url) ||
    "";

  if (!title) {
    return null;
  }

  const node = document.createElement("li");
  const titleEl = document.createElement("h4");
  const bodyEl = document.createElement("p");
  const metaEl = document.createElement("p");
  const reasonTitleEl = document.createElement("p");
  const reasonTextEl = document.createElement("p");
  const actionTitleEl = document.createElement("p");
  const actionTextEl = document.createElement("div");

  if (content) {
    bodyEl.textContent = trimText(content, 160);
    bodyEl.className = "recommend-content";
  }

  const metricParts = [];
  if (readCount) {
    metricParts.push(`${fmtNumber(readCount)} 浏览`);
  }
  if (answerCount) {
    metricParts.push(`${fmtNumber(answerCount)} 回答`);
  }
  if (followerCount) {
    metricParts.push(`${fmtNumber(followerCount)} 关注`);
  }
  if (commentCount) {
    metricParts.push(`${fmtNumber(commentCount)} 评论`);
  }
  metaEl.className = "recommend-meta";
  const metricText = metricParts.join(" · ");
  metaEl.textContent = metricText ? `${metricText} · ${time}` : time;

  if (reason) {
    reasonTitleEl.className = "recommend-label";
    reasonTitleEl.textContent = "推荐理由";
    reasonTextEl.className = "recommend-reason";
    reasonTextEl.textContent = reason;
  }

  if (action || writeHint) {
    actionTitleEl.className = "recommend-label";
    actionTitleEl.textContent = "操作";

    if (action) {
      const actionBadge = document.createElement("span");
      actionBadge.className = "recommend-action-text";
      actionBadge.textContent = action;
      actionTextEl.appendChild(actionBadge);
    }
    if (writeHint) {
      const writeHintEl = document.createElement("span");
      writeHintEl.className = "recommend-action-text";
      writeHintEl.textContent = writeHint;
      actionTextEl.appendChild(writeHintEl);
    }
    if (actionUrl && (action || writeHint)) {
      const actionBtn = document.createElement("a");
      actionBtn.href = actionUrl;
      actionBtn.target = "_blank";
      actionBtn.rel = "noreferrer";
      actionBtn.className = "recommend-action-btn";
      actionBtn.textContent = "写回答";
      actionTextEl.appendChild(actionBtn);
    }
  }
  if (url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = title;
    titleEl.appendChild(a);
  } else {
    titleEl.textContent = title;
  }

  node.appendChild(titleEl);
  if (content) {
    node.appendChild(bodyEl);
  }
  node.appendChild(metaEl);
  if (reason) {
    node.appendChild(reasonTitleEl);
    node.appendChild(reasonTextEl);
  }
  if (action || writeHint) {
    node.appendChild(actionTitleEl);
    node.appendChild(actionTextEl);
  }
  return node;
}

function renderRecommendations(items) {
  recommendListEl.textContent = "";
  if (!Array.isArray(items) || items.length === 0) {
    const item = document.createElement("li");
    item.className = "empty-cell";
    item.textContent = "暂无推荐回答。";
    recommendListEl.appendChild(item);
    return;
  }

  for (const one of items) {
    if (!one || typeof one !== "object") {
      continue;
    }
    const node = buildRecommendNode(one);
    if (node) {
      recommendListEl.appendChild(node);
    }
  }
}

function renderAnswers(items) {
  answersBodyEl.textContent = "";

  if (!Array.isArray(items) || items.length === 0) {
    const row = document.createElement("tr");
    const empty = document.createElement("td");
    empty.colSpan = 4;
    empty.className = "empty-cell";
    empty.textContent = "暂未查询到我的回答（接口暂无或登录态受限）。";
    row.appendChild(empty);
    answersBodyEl.appendChild(row);
    return;
  }

  for (const item of items.slice(0, DASHBOARD_LIST_LIMIT)) {
    const tr = document.createElement("tr");

    const title = document.createElement("td");
    const dateCell = document.createElement("td");
    const readCell = document.createElement("td");
    const statCell = document.createElement("td");

    const question = item.question || {};
    const titleText = firstPresentText([
      item?.question_title,
      question.title,
      item?.title
    ]);
    if (!titleText) {
      continue;
    }
    const createdText = formatDateOnly(item?.created_at || item?.updated_at || item?.updated_time || item?.created_time);
    const answerLink = item?.answer_url || item?.question_url || item?.url || question?.url || "";
    const readCount = toNumber(item?.read_count);
    const voteupCount = firstNumberValue([
      item?.voteup_count,
      item?.upvote_count,
      item?.agree_count,
      item?.upvote,
      item?.vote,
    ]);
    const statText = [
      `${fmtNumber(voteupCount)} 赞同`,
      `${fmtNumber(item?.comment_count)} 评论`,
      `${fmtNumber(item?.like_count)} 喜欢`,
      `${fmtNumber(item?.collect_count)} 收藏`,
      `${fmtNumber(item?.share_count)} 分享`
    ].join(" · ");

    if (answerLink) {
      const a = document.createElement("a");
      a.href = answerLink;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = titleText;
      title.appendChild(a);
    } else {
      title.textContent = titleText;
    }

    dateCell.textContent = createdText;
    readCell.textContent = fmtNumber(readCount);
    statCell.textContent = statText;

    tr.appendChild(title);
    tr.appendChild(dateCell);
    tr.appendChild(readCell);
    tr.appendChild(statCell);
    answersBodyEl.appendChild(tr);
  }
}

function clearPanelPlaceholders() {
  renderRecommendations([]);
  renderAnswers([]);
}

function setTodayMetric(name, value, timeEl, keyTime) {
  name.textContent = fmtNumber(value);
  if (keyTime) {
    timeEl.textContent = keyTime;
  }
}

async function pushDashboardSnapshot(payload, options = {}) {
  const { showStatus = false, auto = false } = options;

  if (!payload || isPushingDashboard) {
    return;
  }

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    if (showStatus) {
      dashboardStatusEl.textContent = "上报失败：未检测到扩展存储环境";
    }
    return;
  }

  const state = await chrome.storage.local.get({
    serverBaseUrl: DEFAULT_SERVER_BASE_URL,
    browserToken: "",
  });
  if (!state.browserToken) {
    if (showStatus && !auto) {
      dashboardStatusEl.textContent = "上报失败：未登录，请先登录插件";
    }
    return;
  }

  isPushingDashboard = true;
  if (pushDashboardEl) {
    pushDashboardEl.disabled = true;
  }
  const url = `${normalizeServerBaseUrl(state.serverBaseUrl)}${BROWSER_DASHBOARD_PUSH_URL}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.browserToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const msg = auto
        ? ""
        : `上报失败：HTTP ${response.status}`;
      if (!auto && showStatus) {
        dashboardStatusEl.textContent = msg || "上报失败";
      }
      return;
    }
    await response.json().catch(() => null);
    await chrome.storage.local.set({
      lastDashboardReportedAt: payload.captured_at || new Date().toISOString(),
    });
    if (!auto && showStatus) {
      dashboardStatusEl.textContent = "上报成功：已推送到服务端";
    }
  } catch (error) {
    if (!auto && showStatus) {
      dashboardStatusEl.textContent = `上报失败：${error?.message || "请稍后重试"}`;
    }
  } finally {
    isPushingDashboard = false;
    if (pushDashboardEl && !refreshDashboardEl.disabled) {
      pushDashboardEl.disabled = false;
    }
  }
}

function startAutoDashboardPush() {
  if (dashboardPushTimer) {
    clearInterval(dashboardPushTimer);
  }
  dashboardPushTimer = setInterval(() => {
    if (isLoadingDashboard || isPushingDashboard) {
      return;
    }
    loadDashboardData({ silent: true })
      .then(() => {
        if (!latestDashboardPayload) {
          return;
        }
        return pushDashboardSnapshot(latestDashboardPayload, {
          showStatus: false,
          auto: true
        });
      })
      .catch(() => {});
  }, DASHBOARD_REPORT_INTERVAL_MS);
}

async function loadAnswers(memberSlug) {
  const contentListUrl =
    `${CREATOR_ANSWER_LIST_URL}?` +
    new URLSearchParams({
      type: "answer",
      offset: "0",
      limit: String(DASHBOARD_LIST_LIMIT),
    }).toString();

  let primaryLoaded = false;
  const primaryResult = await fetchZhihuJson(contentListUrl);
  if (primaryResult.ok) {
    primaryLoaded = true;
    const source = toArray(primaryResult.data);
    if (source.length > 0) {
      return {
        ok: true,
        items: sanitizeAnswers(source)
      };
    }
  }

  if (!memberSlug) {
    return {
      ok: primaryLoaded,
      items: []
    };
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
    return {
      ok: primaryLoaded,
      items: []
    };
  }

  const source = toArray(fallbackResult.data);
  if (!Array.isArray(source)) {
    return {
      ok: true,
      items: []
    };
  }

  return {
    ok: true,
    items: sanitizeAnswers(source)
  };
}

async function loadDashboardData(options = {}) {
  const silent = !!(options && typeof options === "object" && options.silent);
  const reportAfterLoad = !!(
    options &&
    typeof options === "object" &&
    options.reportAfterLoad
  );
  if (isLoadingDashboard) {
    return;
  }

  let shouldReportAfterLoad = false;
  isLoadingDashboard = true;
  if (!silent) {
    dashboardStatusEl.textContent = "刷新中…";
    refreshDashboardEl.disabled = true;
    clearPanelPlaceholders();
  }

  try {
    const { start, end } = getDashboardDateRange();

    const [meResult, homepageResult, dailyResult, aggrResult, recommendResult, momentsResult] =
      await Promise.all([
        fetchZhihuJson(PROFILE_URL).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        })),
        fetchZhihuJson(CREATOR_HOME_URL).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        })),
        fetchZhihuJson(`${CREATOR_DAILY_URL}&start=${start}&end=${end}`).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        })),
        fetchZhihuJson(CREATOR_AGGR_URL + `&start=${start}&end=${end}`).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        })),
        fetchZhihuJson(
          `${CREATOR_RECOMMEND_URL}?` +
            new URLSearchParams({
              limit: String(DASHBOARD_LIST_LIMIT),
              offset: "0",
              page_source: "web_author_recommend",
              recom_domain_score_ab: "1"
            }).toString()
        ).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        })),
        fetchZhihuJson(
          `${MOMENTS_URL}?` +
            new URLSearchParams({
              limit: String(DASHBOARD_MOMENTS_LIMIT),
              desktop: "true"
            }).toString()
        ).catch((error) => ({
          ok: false,
          message: `网络异常：${error?.message || "请稍后重试"}`
        }))
      ]);

    if (!meResult.ok) {
      profileAuthEl.textContent = DEFAULT_AUTHORIZED_FALLBACK;
      if (!silent) {
        dashboardStatusEl.textContent = meResult.message || "未检测到知乎登录态";
      }
      profileNameEl.textContent = "未登录";
      setTodayMetric(todayReadEl, 0, todayReadTimeEl, "-");
      setTodayMetric(todayAgreeEl, 0, todayAgreeTimeEl, "-");
      setTodayMetric(todayCommentEl, 0, todayCommentTimeEl, "-");
      setTodayMetric(todayMessageEl, 0, todayMessageTimeEl, "-");
      renderRecommendations(pickRecommendList(recommendResult?.data || []));
      renderAnswers([]);
      latestDashboardPayload = null;
      return;
    }

    const meData = meResult.data;
    const profileName = pickName(meData);
    const avatarUrl = pickAvatar(meData);
    const dataRefreshedAt = new Date().toISOString();

    profileAvatarEl.src = avatarUrl;
    profileNameEl.textContent = profileName;
    profileAuthEl.textContent = "已授权";
    profileAuthTimeEl.textContent = formatDateTime(dataRefreshedAt);

    try {
      await chrome.storage.local.set({ zhihuDataRefreshedAt: dataRefreshedAt });
    } catch {
      // ignore
    }

    const noticeMetricsData = calcNoticeMetrics(meData);
    const unread = noticeMetricsData.unread;
    const followCount = noticeMetricsData.follow;
    const voteCount = noticeMetricsData.vote;
    const commentCount = noticeMetricsData.comment;
    const totalNoticeCount = noticeMetricsData.total;
    const noticeTime = latestTime(meData, ["message_updated_time", "updated_time", "notifications_updated_time"]);

    const homepageData = homepageResult.ok ? homepageResult.data : null;
    const dailyData = dailyResult.ok ? dailyResult.data : null;
    const aggrData = aggrResult.ok ? aggrResult.data : null;
    const todaySource = { homepageData, dailyData, aggrData };

    const readCount = findTodayMetric(todaySource, "read");
    const agreeCount = voteCount;
    const agreeTime = noticeTime || "刚刚";
    const commentToday = findTodayMetric(todaySource, "comment");

    setTodayMetric(todayReadEl, readCount, todayReadTimeEl, "今天");
    setTodayMetric(todayAgreeEl, agreeCount, todayAgreeTimeEl, agreeTime);
    setTodayMetric(todayCommentEl, commentToday, todayCommentTimeEl, "今天");
    setTodayMetric(todayMessageEl, unread, todayMessageTimeEl, noticeTime || "刚刚");

    const recommendations = sanitizeRecommendationList(pickRecommendList(recommendResult?.data || []));
    renderRecommendations(recommendations);
    const recommendedAnswers = sanitizeRecommendedAnswers(toArray(momentsResult?.data || []));

    const memberSlug = pickMemberSlug(meData);
    const answersResult = await loadAnswers(memberSlug);
    const answers = answersResult.items || [];
    renderAnswers(answers);

    const todayMetrics = {
      read: readCount,
      read_time: "今天",
      agree: agreeCount,
      agree_time: agreeTime,
      comment: commentToday,
      comment_time: "今天",
      message: unread,
      message_time: noticeTime || "刚刚"
    };
    const noticeMetrics = {
      unread: unread,
      unread_time: noticeTime,
      follow: followCount,
      follow_time: noticeTime,
      vote: voteCount,
      vote_time: noticeTime,
      comment: commentCount,
      comment_time: noticeTime,
      total: totalNoticeCount,
      total_time: noticeTime
    };
    try {
      await chrome.storage.local.set({
        dashboardOverview: {
          captured_at: dataRefreshedAt,
          today: todayMetrics,
          notifications: noticeMetrics,
        },
      });
    } catch {
      // ignore
    }

    latestDashboardPayload = buildDashboardSnapshotPayload({
      meData,
      avatarUrl,
      dataRefreshedAt,
      todayMetrics,
      noticeMetrics,
      recommendations,
      recommendedAnswers,
      answers,
    });

    shouldReportAfterLoad =
      reportAfterLoad &&
      (homepageResult.ok || dailyResult.ok || aggrResult.ok);

    const homeCount = homepageResult?.ok ? Math.max(1, 1) : 0;
    if (homeCount > 0) {
      if (!silent) {
        dashboardStatusEl.textContent =
          "刷新成功：已更新最近 3 天的个人信息、概览、推荐回答与我的回答。";
      }
    } else {
      if (!silent) {
        dashboardStatusEl.textContent =
          "刷新完成：部分接口返回异常，请确认知乎主页登录态是否稳定。";
      }
    }

    if (homepageResult && !homepageResult.ok) {
      const msg = homepageResult.message || "";
      if (msg) {
        if (!silent) {
          dashboardStatusEl.textContent = `${dashboardStatusEl.textContent} (${msg})`;
        }
      }
    }
    if (dailyResult && !dailyResult.ok) {
      const msg = dailyResult.message || "";
      if (msg) {
        if (!silent) {
          dashboardStatusEl.textContent = `${dashboardStatusEl.textContent} (${msg})`;
        }
      }
    }
    if (!recommendResult.ok) {
      const msg = recommendResult.message || "";
      if (msg) {
        if (!silent) {
          dashboardStatusEl.textContent = `${dashboardStatusEl.textContent} (推荐数据：${msg})`;
        }
      }
    }
  } catch (error) {
    console.error("loadDashboardData failed:", error);
    if (!silent) {
      dashboardStatusEl.textContent = `刷新失败：${error?.message || "请稍后重试"}`;
    }
    profileAuthEl.textContent = DEFAULT_AUTHORIZED_FALLBACK;
    profileNameEl.textContent = "未登录";
    profileAvatarEl.src = "liukanshan-avatar.jpg";
    profileAuthTimeEl.textContent = "-";
    setTodayMetric(todayReadEl, 0, todayReadTimeEl, "-");
    setTodayMetric(todayAgreeEl, 0, todayAgreeTimeEl, "-");
    setTodayMetric(todayCommentEl, 0, todayCommentTimeEl, "-");
    setTodayMetric(todayMessageEl, 0, todayMessageTimeEl, "-");
    renderRecommendations([]);
    renderAnswers([]);
    latestDashboardPayload = null;
  } finally {
    isLoadingDashboard = false;
    if (!silent) {
      refreshDashboardEl.disabled = false;
    }
    if (shouldReportAfterLoad && latestDashboardPayload) {
      pushDashboardSnapshot(latestDashboardPayload, { auto: true }).catch(() => {});
    }
  }
}

async function syncAndPushDashboard({
  forceReload = false,
  auto = false,
  showStatus = false,
} = {}) {
  if (forceReload) {
    await loadDashboardData({ silent: auto });
  }

  if (!latestDashboardPayload) {
    return;
  }

  await pushDashboardSnapshot(latestDashboardPayload, {
    showStatus,
    auto,
  });
}

function initTabs() {
  for (const button of tabButtons) {
    button.addEventListener("click", () => {
      const target = button.dataset.target;
      if (!target) {
        return;
      }

      for (const one of tabButtons) {
        one.classList.toggle("active", one === button);
      }
      for (const panel of tabPanels) {
        panel.classList.toggle("active", panel.id === target);
      }
    });
  }
}

refreshDashboardEl.addEventListener("click", () => {
  loadDashboardData();
});
pushDashboardEl.addEventListener("click", async () => {
  if (!latestDashboardPayload) {
    dashboardStatusEl.textContent = "尚未有可上报数据，先刷新后上报…";
  }
  await syncAndPushDashboard({
    forceReload: !latestDashboardPayload,
    showStatus: true,
    auto: false
  });
});
openPopupEl.addEventListener("click", () => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("popup.html")
  });
});

initTabs();
startAutoDashboardPush();
loadDashboardData({ reportAfterLoad: true });
