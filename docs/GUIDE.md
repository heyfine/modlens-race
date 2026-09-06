# vision_race 使用指南

> 多模型竞速看图：同一张图同时发给多个视觉模型，**谁先成功用谁，输家立刻杀掉**。

本文面向使用者，覆盖项目概况、技术栈、安装、配置与全部使用方式。开发与架构细节见仓库内其他文档。

---

## 1. 这是什么

vision_race 解决的是 AI 工作流里一个常见的痛点：**视觉模型不可靠**。

单个视觉模型看图时，随时可能遇到：

- 模型不支持某类图片，直接识别失败
- API 限流（429），高峰期反复被拒
- 响应极慢，一个请求拖住整条流程几十秒

vision_race 的做法是**竞速**：把同一张图同时发给多个视觉模型，任何一个先成功返回，立刻采用它的结果并杀掉其余所有还在跑的请求。

```
图片 ──→ 并行 spawn 多个视觉模型（modlens CLI）
          ├── 模型 A 先成功 ──→ 🏆 胜出，输家立刻 kill
          ├── 模型 B 限流/失败 → 忽略（不阻塞）
          └── 模型 C 超时      → 超时硬杀
```

带来的直接效果：

- **总耗时 ≈ 最快成功模型的耗时**，慢模型永远拖不垮整体
- **不浪费配额**：输家在胜出瞬间即被 kill，不会跑完整个请求
- **天然容错**：一个模型挂了，竞速里总有别的能顶上

## 2. 基于什么开发

| 层面 | 技术 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 24 | 直接运行 TypeScript 源码，无需编译步骤 |
| 语言 | TypeScript（strict 模式） | 全量类型标注，无 `any` |
| 竞速引擎 | modlens CLI（`@liustack/modlens`） | 视觉识别执行器，vision_race 以子进程方式并行调用它 |
| 包管理 | pnpm | monorepo workspace |
| 构建 | vite | |
| 测试 | vitest | 含假 modlens CLI 的端到端竞速测试 |
| 代码规范 | biome | format + lint |
| 集成目标 | DSH（可选） | 可安装为 DSH 插件，AI 看图自动走竞速 |

**纯本机运行**：无远程服务、无数据库、无云端依赖。模型 API key 只存在你本机的 `race.json` 里，不会上传到任何地方。

## 3. 核心特性

- **先成功者胜**：多个模型并行起跑，第一个成功的结果立即生效
- **输家立刻杀掉**：胜出瞬间 kill 其余子进程，省时间省配额
- **梯队模式（stagger）**：可设置间隔，先让最快的模型跑，临近超时再补下一个——平时只花一个模型的配额，出问题自动兜底
- **独立端点隔离**：每个参赛模型可配自己的 `baseUrl` + `apiKey`，以临时隔离 HOME 方式运行，各 racer 配置互不干扰
- **共享模式**：不带端点配置的 racer 直接复用本机 modlens 配置（`~/.modlens/config.json`）
- **结构化识别**：胜者结果包含 summary / ocr / layout 等结构化字段，可直接喂给下游程序
- **完整战报**：输出 JSON 战报，含每个模型的成败、耗时、失败原因
- **双形态**：既是独立 CLI，也可安装回 DSH 作为插件；编排逻辑（`src/runner.ts`）还能作为库调用

## 4. 安装

### 4.1 环境要求

- Node.js ≥ 24
- pnpm
- 一个可用的 modlens CLI。两种来源任选：
  - 已安装 DSH：默认自动探测 DSH 安装位置的 `@liustack/modlens`
  - 独立安装：通过环境变量 `MODLENS_CLI` 指定 CLI 路径

### 4.2 安装步骤

```bash
# 克隆仓库
git clone https://github.com/heyfine/modlens-race.git
cd modlens-race

# 安装依赖
pnpm install

# 准备阵容配置（真实 key 放本地，已被 gitignore，不会提交）
cp config/race.example.json race.json
# 编辑 race.json，填入你自己的模型与 key

# 跑第一场竞速
pnpm race path/to/image.png --config race.json
```

图片参数支持**本地路径**和 **http(s) 网络地址**。

## 5. 配置：阵容文件（race.json）

默认读取 `~/.modlens/race.json`，也可用 `--config` 或环境变量 `VISION_RACE_CONFIG` 指定其他路径。

```jsonc
{
  "timeoutMs": 120000,      // 单个模型超时（毫秒）
  "staggerMs": 0,           // 梯队间隔毫秒；0 = 全员同时起跑
  "racers": [
    // 模式一：独立端点 —— 带 baseUrl + apiKey，隔离 HOME 运行
    {
      "name": "my glm",                       // 展示名（可选）
      "provider": "openai",                   // modlens provider
      "model": "glm-5.3",                     // 模型名
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "sk-...",
      "proxy": "http://127.0.0.1:10808",      // 可选：单独走代理
      "extraBody": { "thinking": { "type": "disabled" } }  // 可选：请求体合并项
    },
    // 模式二：共享模式 —— 不带 baseUrl/apiKey，用本机 modlens 配置
    { "provider": "gemini-api" }
  ]
}
```

### racer 字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `provider` | ✅ | modlens provider 名：`openai` / `gemini-api` / `anthropic` / `claude-cli` / `antigravity-cli` / `kimi-cli` |
| `model` | — | 模型名，缺省用 modlens 配置的默认模型 |
| `name` | — | 展示名（战报里显示），缺省用 `provider/model` |
| `baseUrl` + `apiKey` | — | 两者成对出现时走独立端点模式 |
| `proxy` | — | 该 racer 单独使用的代理地址 |
| `extraBody` | — | 合并进请求体的额外字段 |
| `structuredOutput` | — | 要求模型按结构化 JSON 返回 |

### 安全须知

- `race.json` 含真实 API key，**已被 .gitignore 忽略，永远不要提交**
- 仓库里的 `config/race.example.json` 是占位示例，可以放心参考和提交
- key 也可以全部配在 `~/.modlens/config.json` 里，race.json 的共享模式 racer 只写 provider 名

## 6. 命令行使用

```bash
node src/cli.ts <图片路径|URL> [选项]
# 或
pnpm race <图片路径|URL> [选项]
```

### 选项

| 选项 | 说明 | 默认 |
| --- | --- | --- |
| `--prompt "文字"` | 给模型的识别提示，如 `--prompt "重点看表格数字"` | 无 |
| `--timeout ms` | 覆盖单个模型超时 | 配置文件的 `timeoutMs` |
| `--stagger ms` | 覆盖梯队间隔 | 配置文件的 `staggerMs` |
| `--config path` | 指定阵容文件 | `~/.modlens/race.json` |

### 输出：竞速战报 JSON

```jsonc
{
  "ok": true,                    // 是否有 racer 成功
  "race": {
    "winner": "openai/glm-5.3",  // 胜者标签
    "durationMs": 8420,          // 总耗时（= 胜者耗时）
    "timeoutMs": 120000,
    "staggerMs": 0,
    "attempts": [                // 每个 racer 的逐项结果
      { "provider": "openai", "model": "glm-5.3", "won": true,
        "ok": true, "durationMs": 8420 },
      { "provider": "gemini-api", "model": "...", "won": false,
        "ok": false, "durationMs": 8390, "error": "killed (winner decided)" }
    ]
  },
  "result": { /* 胜者的结构化识别结果：summary / ocr / layout */ }
}
```

**退出码**：`0` = 有胜者；`1` = 全员失败；`2` = 用法/配置错误。

## 7. 环境变量

| 变量 | 说明 |
| --- | --- |
| `MODLENS_CLI` | modlens CLI 路径（不设则自动探测 DSH 安装位置） |
| `VISION_RACE_CONFIG` | 阵容文件路径（默认 `~/.modlens/race.json`） |
| `VISION_RACE_TIMEOUT_MS` | 默认超时毫秒 |
| `VISION_RACE_STAGGER_MS` | 默认梯队间隔毫秒 |

## 8. DSH 集成（可选）

如果你在用 DSH Desktop，可以把 vision_race 装回去，让 AI 看图全自动走竞速：

```bash
pnpm run install:dsh
# 然后重启 DSH Desktop
```

安装后获得：

- **`vision_race` 模型工具**：AI 遇到看图任务自动走竞速，无需手动干预
- **「视觉模型挑选」设置卡片**：
  - 扫描 DSH 里的 provider 模型，一键加入竞速阵容
  - 单个模型测试、整场测试竞速
  - 调整超时 / 梯队间隔
  - 开关 `modlens_read_image`（控制 AI 原生读图与竞速的优先级）

组件落在 `~/.modlens/race.mjs`（竞速执行器）+ `~/.modlens/race.json`（阵容）+ DSH 插件目录。

## 9. 作为库使用

竞速编排逻辑是独立模块，可在自己的 TypeScript 项目里直接调用：

```ts
import { loadRaceConfig } from './config.ts'
import { resolveModlensCli } from './modlens.ts'
import { runRace } from './runner.ts'

const config = loadRaceConfig('~/.modlens/race.json')
const report = await runRace(config, {
  image: 'path/to/image.png',
  prompt: '重点看数字',
  modlensCli: resolveModlensCli(),
})
```

完整类型见 `src/types.ts`：`Racer` / `RaceConfig` / `AttemptResult` / `RaceReport`。

## 10. 常用命令速查

```bash
pnpm install          # 安装依赖
pnpm race <图片>      # 跑竞速
pnpm test             # 运行测试（vitest）
pnpm typecheck        # 类型检查
pnpm build            # 构建（vite）
pnpm run format       # 格式化（biome）
pnpm run install:dsh  # 安装插件/脚本回 DSH
```

## 11. 常见问题

**Q：只有一个模型，值得用吗？**
竞速的价值来自多个模型。单模型场景下它就是普通调用，建议至少配 2 个（比如一个主力 + 一个便宜的兜底，用梯队模式省配额）。

**Q：所有模型都失败会怎样？**
战报 `ok: false`，`attempts` 里能看到每个模型的具体失败原因（限流/超时/识别失败），退出码为 1。

**Q：会泄漏我的 API key 吗？**
不会。key 只存在你本机的 `race.json`（或 `~/.modlens/config.json`），进程在本机运行，项目本身没有任何上报逻辑。

**Q：独立端点和共享模式怎么选？**
key 都集中在 `~/.modlens/config.json` → 共享模式（配置最简）。某个 racer 想用别的服务商/别的 key/单独代理 → 独立端点模式。

**Q：梯队间隔怎么设？**
比如 `staggerMs: 15000`：最快的模型先跑 15 秒，没出结果再放第二个进场，依此类推。正常情况下只有第一个模型在消耗配额，它失灵时后面的自动补上。

---

*项目仓库：[github.com/heyfine/modlens-race](https://github.com/heyfine/modlens-race) · 问题与建议欢迎提 issue*
