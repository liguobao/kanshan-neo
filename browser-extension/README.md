# 赛博刘看山浏览器插件

这是 ESP32 知乎助手的浏览器桥接插件（对外展示名：`赛博刘看山`），用于直接登录赛博刘看山账号，并接收同账号设备双击推送的动作消息。

## 安装

1. 打开 Chrome / Edge 的扩展管理页面。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择本目录 `browser-extension/`。安装完成后会打开插件登录页。

## 使用

1. 确保已在服务端注册账号，并让 ESP32 使用同一个账号完成授权登录。
2. 如果当前浏览器已经登录 Kanshan Web，打开插件弹窗后点击“使用 Web 授权登录”。
3. 也可以打开插件弹窗，输入邮箱账号和密码后点击“登录”。
4. 点击“立即上报数据”可在弹窗中直接读取当前知乎数据并推送到服务端。
5. 已登录时弹窗会隐藏登录表单，可点击“退出登录”清除本地登录态。
6. 设备侧双击第二个按钮后，插件会通过 WebSocket 接收消息，并按消息 action 打开对应页面；如果连接暂时断开，会退回到定时检查。

新增能力（参照 `zhihu-copilot`）：
- 数据看板会把今日数据与消息提醒合并为“阅读、赞同、评论、消息”四项。
- 新增“创作数据”入口，可带当前登录态请求以下知乎创作者接口；插件固定只请求最近 7 个自然日：
  - `https://www.zhihu.com/api/v4/creators/homepage`
  - `https://www.zhihu.com/api/v4/creators/analysis/realtime/member/daily?tab=all&start=...&end=...`
  - `https://www.zhihu.com/api/v4/creators/analysis/realtime/member/aggr?tab=all&start=...&end=...`
- 推荐回答和我的回答只取首批小批量数据；带时间戳的数据会限制在 7 天内，没有可靠时间戳的候选内容会保留给服务端继续筛选。
- 关注动态推荐回答会额外读取
  `https://www.zhihu.com/api/v3/moments?limit=...&desktop=true`，提取其中的回答卡片并随看板快照上传给服务端。
- 插件会在已登录且知乎登录态可用时，每 10 分钟自动上报一次最新数据。
- 设备 action 消息优先走 `/api/browser/messages/ws` WebSocket 通道，插件每 20 秒发送一次轻量 ping 保持后台连接；`/api/browser/messages` 仍保留给手动检查和兜底轮询。
- 后台 service worker 使用 ES module，入口 `background.js` 只注册事件，具体逻辑按领域放在 `background/` 目录。
- “消息中心 / 创作中心 / 推荐待答”三入口按钮仍保留，仅做页面入口跳转。
- 新增“知乎账号信息”与“推荐回答（author_related）”区块，支持直接读取并显示 `/api/v4/me?include=email,is_active,is_bind_phone` 和
  `/api/v4/creators/question_route/author_related/recommend?limit=...&offset=...` 的数据（推荐列表会提取标题/摘要/链接进行可读展示，并保留原始 JSON 折叠详情）。

支持的 action：

- `open_creator`：打开创作中心。
- `open_answer`：打开回答页。
- `open_question`：打开提问页。
- `open_messages`：打开消息中心。

如果设备推送消息里包含有效 `url`，插件优先打开该 URL；否则再按
`question_id` 或 action 默认入口兜底。

消息里包含有效 `url` 时会优先打开该链接，`action` 仅用于没有具体链接时的兜底页面。
