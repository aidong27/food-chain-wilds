# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

《食物链 · 荒野生存博弈》是一款中文网页策略游戏：8 种隐藏身份的动物、6 个地区、7 个回合。

- **前端：** Preact 10 + TypeScript + Vite，部署在 GitHub Pages。
- **联机后端：** Cloudflare Worker + `GameRoom` Durable Object。
- **单人练习：** 完全在浏览器里运行，不需要后端。

`README.md` 是面向玩家与维护者的完整说明（规则、数值、部署），每次发版都在顶部加一节。

## 常用命令

```sh
npm test                                     # 全部单元测试（tsx --test tests/*.test.ts）
npx tsx --test tests/engine.test.ts          # 单个文件
npx tsx --test --test-name-pattern="voice" tests/engine.test.ts   # 按测试名筛选
npx tsc --noEmit && npx tsc -p tsconfig.server.json --noEmit      # 客户端与服务端类型检查
npm run format:check                         # Prettier；npm run format 自动修复
npm run build                                # 类型检查 + 构建 dist/（Worker 托管的版本）
npm run build:pages                          # 构建 dist-pages/（GitHub Pages，基路径 /food-chain-wilds/）
npm run simulate -- 2000                     # 平衡模拟：电脑对局，输出各身份存活率
npm run dev                                  # Vite 开发服务器，/api 与 WebSocket 转发到 127.0.0.1:8787
npm run preview:worker                       # wrangler dev：用 dist/ 运行完整游戏（含联机），端口 8787
npm run test:network                         # 对运行中的 Worker 做三客户端联机端到端检查
```

- **单独运行 `npm run dev`：** 单人练习可用，但 `/api/health` 会返回 502；要联机还得另开 `npm run preview:worker`。
- **跑网络测试时：** 不要重建前端或修改后端，Wrangler 热重载会断开测试连接。

## 架构

### 规则引擎 `src/game/`

纯 TypeScript 状态机，不依赖 DOM，浏览器、Worker 与测试共用同一份。

- **`engine.ts`：** 对局生命周期。
  - 先 `createGame(code, mode, seed)`，再 `startGame`。
  - `applyCommand(g, playerId, cmd, now)` 处理玩家指令，`advance`/`tick` 按截止时间推进阶段。
  - 随机性全部来自 `seed`（`rng.ts`），测试用固定种子复现对局。
- **`data.ts`：** 地图、动物、阶段（`PHASES`）与全部可调数值（`RULES`）。调平衡只改这里，再用 `npm run simulate` 检查。
- **`rules.ts` 与 `commands.ts`：** 前者实现单条规则，后者校验不可信的玩家输入。
- **`view.ts`：** `playerView` 把完整的 `Game` 过滤成某位玩家能看到的 `GameView`。
  - 这是服务器发出的唯一数据，也是电脑玩家唯一能读的数据，所以电脑不会作弊。
  - 新增状态时，要决定它在视图里对谁可见。
- **`bots/`：** 电脑玩家由引擎在各阶段调用（`botsDrop`、`botsAct`、`botsChat` 等）。
  - `knowledge.ts` 从视图推断身份，`brain.ts` 做决策。
  - `talk.ts`/`language.ts` 生成并解析中文台词。`tests/bots.test.ts` 要求每句台词都能被解析器按本意读懂，新增台词要照 `language.ts` 里的写法。
- **`tutorial.ts`：** 新手教程那一局的固定身份与电脑剧本（`Game.script`）。界面一侧的步骤在 `src/ui/Tutorial.tsx`。

每夜依次为：交流与投放 `drop` → 行动 `action`（两次行动用完自动结束）→ 私下通话 `call`（仅联机）→ 获取食物 `food` → 结算 `settle`，共 7 夜。

### 客户端 `src/client/`

- **`links.ts`：** `LocalLink` 在浏览器里直接运行引擎（单人），`OnlineLink` 通过 WebSocket 连接 Worker（联机）。界面只依赖 `Link` 接口。
- **`store.ts`：** 应用状态（`useApp()`）与各种动作。
- **`storage.ts`：** 本地存储键。单人存档 `foodchain-solo` 支持刷新后继续。
- **`webmcp.ts`：** 通过 `document.modelContext` 注册 `inspect_food_chain_game` 等工具。浏览器自动化测试可以借它读取当前视图。

### 界面 `src/ui/`

Preact 组件，按视口分为 `narrow`（手机）、`medium`、`wide` 三种布局（见 `common.tsx`）。样式在 `styles/`，界面文字全部是中文。

### 服务端 `server/`

- **`worker.ts`：** 处理 `/api/*`，其余路径由 `ASSETS`（`dist/`）托管。
- **`room.ts`：** 每个房间是一个 `GameRoom`，在服务器上运行同一个引擎，只给每位玩家发送他的 `playerView`。
- **跨域：** 只精确允许 `https://aidong27.github.io`（`wrangler.jsonc` 里的 `PAGES_ORIGIN`，逻辑在 `cors.ts`），不要改成通配符。

## 版本与兼容

- **`PROTOCOL_VERSION`（`src/game/view.ts`）：** 前端和后端只靠它判断能否互通。
  - 改动会影响联机双方的规则或阶段时，要升级它。
  - Pages 上的新前端遇到旧后端，会暂停联机入口，直到维护者重新部署 Worker。
- **`STATE_VERSION`（`src/game/engine.ts`）：** `Game` 存档结构的版本。
  - 结构变了就升级它。
  - 同时在 `links.ts` 的 `savedSolo` 里把旧单人存档升级上来，新手教程的步骤序号也要换算（参考 `tutorialStepFrom2`）。
- **发版版本号：** 写在 `package.json`、`package-lock.json`（两处）和 `server/worker.ts` 的 `/api/health` 里。

## 资源

- **插画：** 放在 `public/art/`。
  - CSS 里写 `url('/art/...')`，Pages 构建时 Vite 会自动加上基路径；TSX 里要用 `import.meta.env.BASE_URL` 拼路径。
- **标题书法字体：** `src/assets/fonts/wilds-brush.woff2` 只是子集。
  - 用 `var(--brush)` 的标题里出现新字时，按 `scripts/brush-glyphs.ts` 注释里的步骤重新生成字体，否则缺字会退回系统楷体。
- **CSP：** `index.html` 的 CSP 很严格，`connect-src` 写死了 Worker 地址。换后端域名时，要同时改 CSP 和 `vite.config.ts`。

## 部署

- **GitHub Pages：** 推送到 `main` 后，`.github/workflows/pages.yml` 运行 `npm test` 和 `npm run build:pages` 并发布。
  - PR 上没有 CI，提交前自己跑测试、类型检查和格式检查。
- **Cloudflare Worker：** `npm run deploy`，只能由拥有 Cloudflare 账号的维护者执行。
  - 云端会话里没有凭据，不要在对话里索要令牌。

## 与维护者协作

- **语言：** 用中文交流；提交信息和 PR 描述也用中文，参照现有提交的写法。
- **不要自动跟进 PR：**
  - 创建 PR 后不要订阅 PR 动态，也不要设置定时回访或其他会自动唤醒会话的后台任务。
  - 平台在创建 PR 时会自动订阅，创建后立即取消订阅。
- **合并：** 只有维护者明确说「合并上线」时才合并。
  - 用 squash 合并，标题形如「食物链 X.Y：…… (#N)」。
  - 合并后确认 Pages 部署完成：线上 `index.html` 引用的 bundle 应与本地 `npm run build:pages` 的一致。
- **Codex：** 维护者可以把提示词转发给 Codex，它能生成图片、提交 PR。
  - 需要美术或独立任务时，写好提示词交给维护者转发。
  - Codex 的 PR 交回来后，先检查再决定是否合并。
