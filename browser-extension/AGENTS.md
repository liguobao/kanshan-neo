# AGENTS.md — 浏览器插件

本目录是 Chrome / Edge Manifest V3 插件，对外展示名为 `赛博刘看山`。插件负责
用 Web 登录态或账号密码注册到服务端，并在后台接收设备推送、打开对应知乎页面、定时上报
知乎创作者数据。

## 核心文件

- `manifest.json`：权限、后台 service worker、图标和 popup 入口。
- `background.js`：Manifest V3 module service worker 入口，只负责注册生命周期、alarm 和 runtime message 事件。
- `background/`：按领域拆分后台逻辑，包括配置、登录会话、设备消息 WebSocket/兜底轮询、状态徽标、知乎数据读取和 dashboard 上报。
- `popup.html` / `popup.js` / `popup.css`：登录、断开、手动检查和手动上报入口。
- `dashboard.html` / `dashboard.js` / `dashboard.css`：插件内数据看板。

## 核心逻辑约束

1. 插件优先使用 Web 控制台登录态调用 `/api/browser/register`，失败时保留
   `/api/browser/login` 账号密码登录；成功后保存 `browserToken`，后续请求用
   `Authorization: Bearer <token>`。
2. 保持消息消费语义不变：WebSocket 和 `/api/browser/messages?after_id=...` 兜底轮询
   都只处理新增消息，`lastMessageId` 成功推进后再保存。
3. 保持 action 兜底页面可用：`open_creator`、`open_answer`、`open_question`、
   `open_messages` 没有有效 `url` 时仍能打开默认知乎页面。
4. 保持知乎数据读取和 `/api/browser/dashboard` 上报解耦；新增字段时兼容旧响应，
   不让单个知乎接口失败阻断整个插件。
5. 修改 `host_permissions` 或默认服务端地址时，同步检查 `README.md` 和后端下载包。

## 本地检查

插件没有构建步骤。修改后至少用 Chrome / Edge 开发者模式加载
`browser-extension/`，检查 popup、dashboard、手动上报和设备消息打开页面流程。
如需生成下载包，使用仓库脚本：

```sh
python kanshan-server/scripts/package_browser_extension.py
```
