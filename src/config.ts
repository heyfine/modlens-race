/** 竞速配置文件（race.json）读取与校验。 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { RaceConfig, Racer } from './types.ts'

/** 默认配置文件路径：~/.modlens/race.json（可用 --config 覆盖） */
export function defaultConfigPath(): string {
  return join(homedir(), '.modlens', 'race.json')
}

/** 空阵容默认配置。 */
export function defaultRaceConfig(): RaceConfig {
  return { timeoutMs: 120_000, staggerMs: 0, racers: [] }
}

/** 从 JSON 文本解析阵容，容忍 BOM（Windows 下常见）。 */
export function parseRaceConfig(text: string): RaceConfig {
  const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaultRaceConfig()
  }
  const obj = parsed as Record<string, unknown>
  const racers = Array.isArray(obj.racers)
    ? (obj.racers as unknown[]).filter((r): r is Racer => {
        if (r === null || typeof r !== 'object') return false
        const candidate = r as Record<string, unknown>
        return typeof candidate.provider === 'string'
      })
    : []
  return {
    timeoutMs: typeof obj.timeoutMs === 'number' && obj.timeoutMs > 0 ? obj.timeoutMs : 120_000,
    staggerMs: typeof obj.staggerMs === 'number' && obj.staggerMs >= 0 ? obj.staggerMs : 0,
    racers,
  }
}

/** 读取并解析阵容文件；文件缺失/损坏时抛出带上下文的错误。 */
export function loadRaceConfig(path: string): RaceConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      throw new Error(`阵容配置文件不存在: ${path} —— 请先创建（可参考 config/race.example.json 复制为 .env 指定路径）`)
    }
    throw new Error(`无法读取阵容配置 ${path}: ${String((error as Error).message ?? error)}`)
  }
  try {
    return parseRaceConfig(text)
  } catch (error) {
    throw new Error(`阵容配置 ${path} 不是合法 JSON: ${String((error as Error).message ?? error)}`)
  }
}

/** 两个 racer 是否视为同一参赛项（去重依据：provider + model + baseUrl）。 */
export function isSameRacer(a: Racer, b: Racer): boolean {
  return a.provider === b.provider && (a.model ?? '') === (b.model ?? '') && (a.baseUrl ?? '') === (b.baseUrl ?? '')
}

/** racer 的展示标签。 */
export function racerLabel(racer: Racer): string {
  return racer.name ?? `${racer.provider}/${racer.model ?? '(default)'}`
}
