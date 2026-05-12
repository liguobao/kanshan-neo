export const DEFAULT_ACTION_URLS = {
  open_creator: "https://www.zhihu.com/creator",
  open_answer: "https://www.zhihu.com/question/waiting",
  open_question: "https://www.zhihu.com/question/ask",
  open_messages: "https://www.zhihu.com/notifications"
};

export const POLL_ALARM = "zhihu-assistant-poll";
export const DASHBOARD_REPORT_ALARM = "zhihu-assistant-dashboard-report";
export const DASHBOARD_REPORT_PERIOD_MINUTES = 10;
export const MESSAGE_STATS_REFRESH_MIN_INTERVAL_MS = 30_000;
export const DASHBOARD_LOOKBACK_DAYS = 7;
export const DASHBOARD_LIST_LIMIT = 40;
export const DASHBOARD_MOMENTS_LIMIT = 60;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_SERVER_BASE_URL = "https://kanshan.r2049.cn";
export const FALLBACK_SERVER_BASE_URLS = ["https://zh.r2049.cn"];
export const WEB_AUTH_COOKIE_NAME = "kanshan-server-token";
export const BROWSER_SESSION_REGISTER_URL = "/api/browser/register";
export const BROWSER_MESSAGE_BATCH_LIMIT = 2;
export const BROWSER_MESSAGE_WS_PATH = "/api/browser/messages/ws";
export const BROWSER_MESSAGE_WS_TOKEN_PROTOCOL = "kanshan-browser-token";
export const BROWSER_MESSAGE_WS_PING_MS = 20_000;
export const BROWSER_MESSAGE_WS_RECONNECT_MS = 5_000;
export const BROWSER_DASHBOARD_PUSH_URL = "/api/browser/dashboard";
export const DASHBOARD_PUSH_SOURCE = "browser_extension";
export const BROWSER_ID_PREFIX = "browser-";
export const BROWSER_ID_CODE_LENGTH = 10;
export const MESSAGE_BADGE_BACKGROUND_COLOR = "#d93025";
export const MESSAGE_BADGE_MAX_COUNT = 99;

export const PROFILE_INCLUDE_FIELDS = [
  "is_realname",
  "ad_type",
  "available_message_types",
  "default_notifications_count",
  "follow_notifications_count",
  "vote_thank_notifications_count",
  "comment_notification_count",
  "messages_count",
];

export const PROFILE_URL =
  `https://www.zhihu.com/api/v4/me?include=${PROFILE_INCLUDE_FIELDS.join(",")}`;
export const CREATOR_DAILY_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/member/daily?tab=all";
export const CREATOR_HOME_URL = "https://www.zhihu.com/api/v4/creators/homepage";
export const CREATOR_AGGR_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/member/aggr?tab=all";
export const CREATOR_RECOMMEND_URL =
  "https://www.zhihu.com/api/v4/creators/question_route/author_related/recommend";
export const CREATOR_ANSWER_LIST_URL =
  "https://www.zhihu.com/api/v4/creators/analysis/realtime/content/list";
export const MOMENTS_URL = "https://www.zhihu.com/api/v3/moments";

export const NOTICE_COUNT_FIELDS = {
  unread: ["default_notifications_count", "messages_count"],
  follow: ["follow_notifications_count"],
  vote: ["vote_thank_notifications_count"],
  comment: ["comment_notification_count"],
};

export const HOMEPAGE_TODAY_METRIC_FIELDS = {
  read: ["today_read_count"],
  agree: ["today_upvoted_count", "today_incr_upvoted_count"],
  comment: ["today_comment_count", "today_comment_num", "today_comments_count"],
};

export const CREATOR_ANALYSIS_METRIC_FIELDS = {
  read: ["read_count", "reads", "view_count", "views_count", "pv", "pv_count"],
  agree: ["voteup_count", "agree_count", "like_count", "upvote_count", "vote_count"],
  comment: ["comment_count", "comments_count", "comment_num"],
};

export const DASHBOARD_ITEM_TIME_FIELDS = [
  "updated_time",
  "created_time",
  "updated_at",
  "created_at",
  "created",
  "time",
];
