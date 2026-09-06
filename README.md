# modles-race（vision_race）

多模型竞速看图：**同一张图同时发给多个视觉模型，谁先成功返回用谁的结果，其余立刻杀掉**。解决单个视觉模型「看不了 / 限流 / 超时」拖慢整体的问题——一个模型挂了，竞速里总有别的能顶上。

> 📖 **详细使用指南**（项目概况 / 安装 / 配置 / 全部用法）：[docs/GUIDE.md](docs/GUIDE.md)

最初是 DSH（DeepSeek Harness）环境里的自用插件与脚本（多模型竞速执行器 + Vision Picker 设置卡片），现已整理为独立项目，可：

- 独立命令行使用（`pnpm race <图片> ...`）
- 安装回 DSH 作为 `vision_race` 模型工具 + 「视觉模型挑选」设置卡片（`pnpm run install:dsh`）
- 作为依赖/库调用竞速编排逻辑（`src/runner.ts`）

## 工作原理

```
图片 ──→ 并行 spawn 多个视觉模型（modlens CLI）
          ├── 模型 A 先成功 ──→ 🏆 胜出，输家立刻 kill
          ├── 模型 B 限流/失败 → 忽略（不阻塞）
          └── 模型 C 超时      → 超时硬杀
```

- **先成功者胜**：总耗时 ≈ 最快成功模型的耗时，慢模型永远拖不垮整体
- **输家立刻杀掉**：不浪费配额，不等待
- **梯队模式（staggerMs）**：先让最快的跑，超时前再补下一个，省配额
- **独立端点**：每个 racer 可配自己的 baseUrl+key（临时隔离 HOME 运行，互不干扰）；也可共享本机 modlens 配置

## 快速开始

前置：Node.js >= 24、pnpm、一个 modlens CLI（默认读 DSH 安装位置的 `@liustack/modlens`）。

```bash
pnpm install

# 1. 准备阵容配置（真实 key 放本地，不要提交）
cp config/race.example.json race.json   # 编辑成你自己的模型+key
# 或使用默认路径 ~/.modlens/race.json

# 2. 跑一场竞速
pnpm race path/to/image.png --config race.json
# 或直接
node src/cli.ts path/to/image.png --config race.json
```

输出为竞速战报 JSON：`ok` / `race.winner` / `race.attempts`（每个模型的成功/失败/耗时）+ 胜者的结构化识别结果（summary / ocr / layout）。

### 常用命令

```bash
pnpm install          # 安装依赖
pnpm race <图片>      # 跑竞速（同 node src/cli.ts）
pnpm test             # 运行测试（vitest）
pnpm typecheck        # 类型检查（tsc --noEmit）
pnpm build            # 构建（vite）
pnpm run format       # 格式化（biome）
pnpm run install:dsh  # 安装插件/脚本回 DSH 环境
```

## 配置：阵容（race.json）

```jsonc
{
  "timeoutMs": 120000,      // 单个模型超时（毫秒）
  "staggerMs": 0,           // 梯队间隔（0 = 全员同时起跑）
  "racers": [
    // 独立端点：带 baseUrl + apiKey，隔离 HOME 运行
    { "name": "my glm", "provider": "openai", "model": "glm-5.3",
      "baseUrl": "https://api.example.com/v1", "apiKey": "sk-..." },
    // 共享模式：用本机 ~/.modlens/config.json 的 provider 配置
    { "provider": "gemini-api" }
  ]
}
```

- **安全**：`race.json` 含真实 API key，已被 `.gitignore` 忽略，**不要提交**。提交请用 `config/race.example.json`（key 占位）。
- 配置项完整说明见 [docs/GUIDE.md](docs/GUIDE.md)。

## DSH 集成

安装到 DSH 环境后（`pnpm run install:dsh` + 重启 DSH Desktop）：

- `vision_race` 模型工具注册：AI 看图自动走竞速
- 「视觉模型挑选」设置卡片：扫描 DSH 里的 provider 模型一键加入竞速阵容、单测、测试竞速、调超时/梯队、开关 `modlens_read_image`
- 依赖 modlens CLI：`~/.modlens/race.mjs`（竞速执行器）+ `~/.modlens/race.json`（阵容）

## 目录结构

```
src/                   TS 源码
  cli.ts               命令行入口
  runner.ts            竞速编排（先成功者胜 / 杀输家 / 战报）
  modlens.ts           modlens CLI 定位 + 隔离 HOME + 单 racer 执行
  config.ts            阵容配置读取/校验/去重
  render.ts            战报文本渲染
  png.ts               测试图生成（纯 JS，无依赖）
  types.ts             类型定义
dsh/                   DSH 插件集成（vision-picker 卡片 + race.mjs）
config/
  race.example.json    示例阵容（key 占位）
scripts/
  install-to-dsh.mjs   安装插件/脚本回 DSH
test/
  config.test.ts       配置测试
  runner.test.ts       竞速逻辑测试（用假 modlens CLI）
  fixtures/            测试用假 modlens CLI
docs/                  项目文档
```

## 更新规则

- 项目名 / 简介 / 常用命令 / 目录结构 / 环境变量 / 部署地址发生变化时 → 同步更新本文件
- 使用说明有增补 → 同步更新 [docs/GUIDE.md](docs/GUIDE.md)
