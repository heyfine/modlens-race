import { runRacer, stopAll } from './modlens.ts'
/** 竞速编排：并行起跑全部 racer，先成功者胜出，输家立刻杀掉，输出完整战报。 */
import type { AttemptResult, RaceConfig, RaceReport, Racer } from './types.ts'

/** 单次竞速的输入。 */
export interface RaceOptions {
  image: string
  prompt?: string
  modlensCli: string
  signal?: AbortSignal
}

/** 竞速结束后的收尸等待（毫秒）：让被杀子进程退出、战报尽量完整。 */
const GRAVEYARD_GRACE_MS = 3_000

/** 运行一场竞速：返回完整战报（含全部 racer 的逐项结果与胜者的结构化结果）。 */
export async function runRace(config: RaceConfig, options: RaceOptions): Promise<RaceReport> {
  const { racers, timeoutMs, staggerMs } = config
  const { image, prompt, modlensCli, signal } = options

  // 每个 racer 独立执行；这里把 parsed（成功时的 modlens JSON）单独留存，
  // 不塞进 AttemptResult（战报条目保持精简）。
  const parsedByIndex = new Array<unknown>(racers.length).fill(undefined)

  const attempts: Promise<AttemptResult>[] = racers.map((racer, index) =>
    (async (): Promise<AttemptResult> => {
      if (index > 0 && staggerMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, staggerMs * index))
      }
      const execution = await runRacer(modlensCli, image, racer, timeoutMs, prompt, signal)
      if (execution.ok && execution.parsed !== undefined) {
        parsedByIndex[index] = execution.parsed
      }
      return {
        provider: racer.provider,
        model: racer.model ?? '(default)',
        won: false,
        ok: execution.ok,
        durationMs: execution.durationMs,
        ...(execution.ok ? {} : { error: String(execution.error ?? '').slice(0, 300) }),
      }
    })(),
  )

  const results = new Array<AttemptResult | null>(racers.length).fill(null)
  let pending = racers.length
  const winner = await new Promise<{ index: number } | null>((resolve) => {
    attempts.forEach((promise, index) => {
      promise
        .then((result) => {
          results[index] = result
          pending -= 1
          if (result.ok) resolve({ index })
          else if (pending === 0) resolve(null)
        })
        .catch(() => {
          pending -= 1
          if (pending === 0) resolve(null)
        })
    })
  })

  // 已有胜者：杀掉所有还在跑的，并给一点时间收尸
  stopAll()
  await Promise.race([Promise.allSettled(attempts), new Promise((resolve) => setTimeout(resolve, GRAVEYARD_GRACE_MS))])

  // 战报必须覆盖全部 racer：被杀/被跳过的输家补占位条目，不从战报消失
  const reportAttempts: AttemptResult[] = results.map((entry, index) => {
    const racer: Racer = racers[index]
    if (entry === null) {
      return {
        provider: racer.provider,
        model: racer.model ?? '(default)',
        won: false,
        ok: false,
        durationMs: 0,
        error: 'no report — killed after the winner (process terminated)',
      }
    }
    return {
      ...entry,
      won: winner !== null && winner.index === index,
    }
  })

  if (winner === null) {
    return {
      ok: false,
      race: { timeoutMs, staggerMs, attempts: reportAttempts },
    }
  }

  const winnerRacer = racers[winner.index]
  const winnerLabel = `${winnerRacer.provider}${winnerRacer.model ? `/${winnerRacer.model}` : ''}`
  return {
    ok: true,
    race: {
      winner: winnerLabel,
      durationMs: results[winner.index]?.durationMs ?? 0,
      timeoutMs,
      staggerMs,
      attempts: reportAttempts,
    },
    result: parsedByIndex[winner.index],
  }
}
