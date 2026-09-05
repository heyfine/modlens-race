# 测试指南

## 如何运行测试

```bash
pnpm test             # 跑全部测试（vitest）
pnpm test -- --watch  # 监听模式
pnpm test <文件名>    # 只跑某个文件
```

## 覆盖率要求

- 核心逻辑（runner 竞速编排 / config 校验 / modlens 隔离 HOME）目标 80%+
- 跑覆盖率：`pnpm test -- --coverage`
- 覆盖率不足时，至少保证关键路径有测试

## 测试类型

| 类型 | 说明 | 位置 |
| --- | --- | --- |
| 单元测试 | config 校验、去重、标签、默认值、BOM 容忍 | `test/config.test.ts` |
| 集成测试 | 竞速编排（假 modlens CLI spawn 真实子进程） | `test/runner.test.ts` |

## 写测试的约定

- 竞速测试用 `test/fixtures/fake-modlens.mjs` 假 CLI：模型名带 `fail:` 立即失败、`slow:NNNms:` 延迟成功、普通名立即成功——不真调视觉 API，速度快且稳定。
- 数据/解析测试避免真实文件系统副作用；`loadRaceConfig` 的不存在路径用例只验证报错。
- 修 bug 必加回归测试：先写能复现的用例，修复后用例通过。

## 常用技巧

- runner 测试直接传 `modlensCli: <fake 路径>`（用 `fileURLToPath(import.meta.url)` 定位 fixtures），不走环境变量查找。
- 隔离 HOME 测试：带 baseUrl+apiKey 的 racer 会 mkdtemp 后清理，测试通过后可检查临时目录已删除（行为级断言即可，不依赖具体路径）。

## 更新规则

- 测试命令 / 覆盖率要求 / 测试约定变化 → 同步更新本文件