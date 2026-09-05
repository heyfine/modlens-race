#!/usr/bin/env node
/**
 * vision_race — 多个视觉模型同时看一张图，谁先成功用谁，输家立刻杀掉。
 *
 * 用法：
 *   node src/cli.ts <图片路径|http(s)地址> [--prompt "重点关注"] [--timeout ms]
 *                 [--stagger ms] [--config 阵容json路径]
 *
 * 阵容配置（默认 ~/.modlens/race.json，或 --config 指定）：
 * {
 *   "timeoutMs": 120000,
 *   "staggerMs": 0,
 *   "racers": [
 *     { "name": "myapi glm-5.3", "provider": "openai", "model": "bankofai/glm-5.3-flash",
 *       "baseUrl": "https://myapi.example.com/v1", "apiKey": "sk-..." },
 *     { "provider": "gemini-api" }
 *   ]
 * }
 *
 * racer 两种模式：
 * - 带 baseUrl+apiKey → 独立端点：临时隔离 HOME 写入专属 modlens 配置，互不干扰。
 * - 不带 → 共享模式：直接用本机 ~/.modlens/config.json（--model 可覆盖）。
 *
 * 输出：竞速战报 JSON（ok/race/attempts + 胜者的 modlens 结构化 result）。
 */
import { defaultConfigPath, loadRaceConfig } from './config.ts'
import { resolveModlensCli } from './modlens.ts'
import { runRace } from './runner.ts'
import type { RaceConfig, RaceReport } from './types.ts'

interface CliArgs {
  positions: string[]
  prompt?: string
  timeout?: number
  stagger?: number
  config?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { positions: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--prompt') args.prompt = argv[++i]
    else if (arg === '--timeout') args.timeout = Number(argv[++i])
    else if (arg === '--stagger') args.stagger = Number(argv[++i])
    else if (arg === '--config') args.config = argv[++i]
    else if (!arg.startsWith('--')) args.positions.push(arg)
  }
  return args
}

function resolveTimeout(cliValue: number | undefined, configTimeout: number): number {
  return cliValue && Number.isFinite(cliValue) ? cliValue : configTimeout
}

function resolveStagger(cliValue: number | undefined, configStagger: number): number {
  return cliValue !== undefined && Number.isFinite(cliValue) ? cliValue : configStagger
}

function writeReport(report: RaceReport): void {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const image = args.positions[0]
  if (!image) {
    process.stderr.write(
      'usage: node src/cli.ts <imagePath|url> [--prompt text] [--timeout ms] [--stagger ms] [--config path]\n',
    )
    process.exit(2)
  }

  const configPath = args.config ?? process.env.VISION_RACE_CONFIG ?? defaultConfigPath()
  let config: RaceConfig
  try {
    config = loadRaceConfig(configPath)
  } catch (error) {
    process.stderr.write(`cannot read race config: ${String((error as Error).message ?? error)}\n`)
    process.exit(2)
  }

  if (config.racers.length === 0) {
    process.stderr.write(`no racers in ${configPath}\n`)
    process.exit(2)
  }

  const timeoutMs = resolveTimeout(args.timeout, config.timeoutMs)
  const staggerMs = resolveStagger(args.stagger, config.staggerMs)
  const modlensCli = resolveModlensCli()

  const report = await runRace({ ...config, timeoutMs, staggerMs }, { image, prompt: args.prompt, modlensCli })

  writeReport(report)
  process.exit(report.ok ? 0 : 1)
}

main().catch((error: unknown) => {
  process.stderr.write(`${String((error as Error).stack ?? error)}\n`)
  process.exit(2)
})
