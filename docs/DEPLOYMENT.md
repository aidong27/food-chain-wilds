# 公开发布与 Pages 部署记录

日期：2026-10-14。

## 来源核验

本次恢复的是原生产地址 `https://food-chain-wilds.food-chain-game.workers.dev/` 对应的游戏，而非后来独立部署的 preview 重构版。恢复来源提交为 `49cdac3108b33b63f05bdc77d4b723e4fca0fd6f`。本仓库使用新建的干净 Git 历史，未导入旧项目历史。

恢复后的原版在锁定依赖下重新构建，以下三个文件均与在线原站逐字节一致：

| 文件 | SHA-256 |
| --- | --- |
| `index.html` | `32b0b1e9815b0ab852a699a25a4a28df4633a372c5cd946215e14c86531d0b5a` |
| `assets/index-DiKTl_DH.js` | `b1d6a5f9d159e186591acd54c69097c7e441f641ceeb8d3fc863ebb6019cc984` |
| `assets/index-DjitWN8W.css` | `414f92299d01ada42018347ace753fc41cb83e8f2d8c6326cd64f475a267b41e` |

修改前 Cloudflare 生产部署版本为 `2cf591c9-4ec4-404a-9c7e-d0dd5b9d0a77`。

## 发布范围

- 包含本游戏前端、后端、规则、测试、两张 WebP 插画、锁定依赖与部署配置。
- 不含旧项目 Git 历史、旧测试房间记录、对话、截图归档、原始设计文档、账号配置、环境密钥、依赖目录或运行时数据库。
- 插画均只有图像数据块，没有 EXIF/XMP 元数据。没有新增开源许可证。
- `src/data.ts`、`src/engine.ts`、`src/style.css`、`src/webmcp.ts`、两张插画、锁文件及整个 `GameRoom` 类与已核验原版一致。
- 后端只新增精确 Pages 来源校验、预检处理及 JSON CORS 响应头；无存储迁移，无新服务或付费依赖。
- Pages 前端使用独立 `/food-chain-wilds/` 基路径，邀请链接、首页与插画路径随基路径生成。

## 部署前验证

- `npm test`：22 项通过，包含 200 局固定种子模拟及 Pages 路径/CORS 测试。
- `npm run build`、`npm run build:pages`：TypeScript 与 Vite 构建通过。
- `wrangler deploy --dry-run`：Worker 打包与绑定检查通过。
- 本地 Worker 执行 `GAME_ORIGIN=https://aidong27.github.io npm run test:network`：15 项通过。
- 网络验证覆盖三客户端联机、房主权限/转移、身份与私信隔离、语音信令权限、秘密投放、移动判定、通话额度、食物结算、断线恢复、无效席位凭证、跨域拒绝和完整七回合。
- Pages HTML/CSS 所引用的脚本、样式、图标与两张插画均在构建产物中存在。
- Gitleaks 8.30.1 扫描 Pages 构建产物与待发布的干净 Git 历史：无泄漏。

## 线上发布结果

- [公开仓库](https://github.com/aidong27/food-chain-wilds)已创建，默认分支为 `main`，没有附加许可证。
- [GitHub Pages](https://aidong27.github.io/food-chain-wilds/)已启用 HTTPS，首次[构建与部署工作流](https://github.com/aidong27/food-chain-wilds/actions/runs/38494492652)成功。
- Cloudflare 兼容层部署版本：`f3c44479-9961-4261-8112-5197c996187b`。本次使用恢复的原版静态产物，上传结果为“没有更新的静态文件”；原站继续提供原前端。
- 线上后端执行 `GAME_BASE_URL=https://food-chain-wilds.food-chain-game.workers.dev GAME_ORIGIN=https://aidong27.github.io npm run test:network`，15 项全部通过，含三个独立 WebSocket 客户端连接和完整七回合结算。测试创建了独立房间，没有进入用户原邀请房间或重置已有存档。
- 匿名访问 Pages HTML、脚本、样式、图标与两张插画均返回 200，内容与本地构建逐字节一致；带 `room` 查询参数的邀请链接返回同一应用。原站的对应六个文件与发布前逐字节一致。
- 精确允许的新增 Origin 为 `https://aidong27.github.io`；预检允许 GET/POST，允许请求头仅 Content-Type，没有 `Access-Control-Allow-Credentials`，没有新增账号权限或持久凭据。WebSocket 升级仍受相同 Origin 白名单与原有席位令牌验证约束；不受信任来源实际返回 403。
- 浏览器操作未完成：Mac 处于锁定状态，可用的 Chrome 浏览器连接为空，尝试打开 Safari 返回无法解锁。页面与资源通过匿名 HTTP 请求验证，未把这些检查称为浏览器渲染、真实麦克风或实体设备实测。

## 持续限制

GitHub Pages 只承载静态内容。原 Cloudflare 服务需要继续运行，单人电脑练习同样需要后端连接。席位凭证保存在当前标签页的 `sessionStorage`，房间约 24 小时过期；跨站或跨设备不会自动恢复同一席位。

语音使用 WebRTC 与公开 STUN，没有 TURN 中继。信令通道测试通过不等于真实麦克风或跨运营商音频已验证；严格 NAT、防火墙环境可能无法建立音频，文字消息可继续使用。
