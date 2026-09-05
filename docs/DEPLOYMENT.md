# 部署指南

本项目是**本机 CLI + DSH 插件**，无远程服务部署。

## 部署目标

- 平台：本机（Windows）CLI + DSH Desktop 插件
- 仓库：`github.com/heyfine/modles-race`（main）
- 环境：Node.js >= 24，pnpm

## 环境变量

复制 `.env.example` 为 `.env` 填写（源码不自动读 .env，仅作文档；如需要 .env 加载见 TODO）：

| 变量 | 说明 |
| --- | --- |
| `MODLENS_CLI` | modlens CLI 路径（不设则自动探测项目/DSH 安装位置） |
| `VISION_RACE_CONFIG` | 阵容文件路径（默认 `~/.modlens/race.json`） |
| `VISION_RACE_TIMEOUT_MS` | 默认超时毫秒 |
| `VISION_RACE_STAGGER_MS` | 默认梯队间隔毫秒 |

## 部署流程

1. `pnpm install`
2. 本地使用：`node src/cli.ts <图片> [--config race.json]`，或 `pnpm race <图片>`
3. 安装回 DSH：`pnpm run install:dsh` → 重启 DSH Desktop → 设置里出现「视觉模型挑选」卡片
4. 推 GitHub：`git push origin main`（网络失败走代理 `http://127.0.0.1:10808`）

## 回滚

- DSH 环境：用 `~/.modlens/race.mjs` 与 `~/.dsh/profiles/web/node_modules/dsh-vision-picker/` 的旧副本覆盖即可（本项目 dsh/ 目录就是当前稳定版）。

## 运维

- 无远程服务、无监控。
- 关键数据：`~/.modlens/race.json`（阵容，含 key，注意备份与保管）与 `~/.modlens/config.json`。

## 上线检查清单

- [ ] `pnpm test` 全绿
- [ ] `pnpm typecheck` 无错误
- [ ] `pnpm build` 成功
- [ ] 本地 `node src/cli.ts <测试图>` 出竞速战报
- [ ] （若装回 DSH）重启后 Vision Picker 卡片出现、发图走 vision_race

## 更新规则

- 部署流程 / 环境变量 / 平台配置 / 回滚方式发生变化时 → 同步更新本文件