import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runRace } from '../src/runner.ts'
import type { RaceConfig } from '../src/types.ts'

/** fake modlens CLI 的绝对路径（用当前文件目录定位 fixtures）。 */
const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-modlens.mjs')

function configWith(racers: RaceConfig['racers'], overrides: Partial<RaceConfig> = {}): RaceConfig {
  return { timeoutMs: 20000, staggerMs: 0, racers, ...overrides }
}

describe('runRace', () => {
  it('先成功者胜出，输家被标记 not ok', async () => {
    const report = await runRace(
      configWith([
        { provider: 'openai', model: 'fail:model-a' },
        { provider: 'openai', model: 'winner-model' },
        { provider: 'openai', model: 'slow:5000ms:slowpoke' },
      ]),
      { image: 'x.png', modlensCli: FAKE_CLI },
    )

    expect(report.ok).toBe(true)
    expect(report.race.winner).toBe('openai/winner-model')
    expect(report.race.attempts).toHaveLength(3)
    // 胜者 won
    expect(report.race.attempts.find((a) => a.ok && a.won)?.model).toBe('winner-model')
    // 失败者带 error
    const failed = report.race.attempts.find((a) => a.model === 'fail:model-a')
    expect(failed?.ok).toBe(false)
    expect(failed?.error).toBeTruthy()
  })

  it('stagger 梯队：延迟 racer 被跳过/杀掉，不影响胜者', async () => {
    const report = await runRace(
      configWith(
        [
          { provider: 'openai', model: 'winner-model' },
          { provider: 'openai', model: 'slow:5000ms:slowpoke' },
        ],
        {
          staggerMs: 50,
        },
      ),
      { image: 'x.png', modlensCli: FAKE_CLI },
    )

    expect(report.ok).toBe(true)
    expect(report.race.winner).toBe('openai/winner-model')
  })

  it('全部失败时 ok=false，战报仍覆盖全部 racer', async () => {
    const report = await runRace(
      configWith([
        { provider: 'openai', model: 'fail:a' },
        { provider: 'openai', model: 'fail:b' },
      ]),
      { image: 'x.png', modlensCli: FAKE_CLI },
    )

    expect(report.ok).toBe(false)
    expect(report.race.attempts).toHaveLength(2)
    for (const attempt of report.race.attempts) {
      expect(attempt.ok).toBe(false)
      expect(attempt.error).toBeTruthy()
    }
  })

  it('胜者的结构化 result 随战报返回', async () => {
    const report = await runRace(configWith([{ provider: 'openai', model: 'winner-model' }]), {
      image: 'x.png',
      modlensCli: FAKE_CLI,
    })

    expect(report.ok).toBe(true)
    const result = report.result as { ocr?: { full_text?: string } }
    expect(result?.ocr?.full_text).toContain('MODEL=winner-model')
  })

  it('独立端点 racer（带 baseUrl/apiKey）走隔离 HOME 也能跑通', async () => {
    const report = await runRace(
      configWith([
        {
          provider: 'openai',
          model: 'isolated-model',
          baseUrl: 'https://fake.example/v1',
          apiKey: 'sk-test',
        },
      ]),
      { image: 'x.png', modlensCli: FAKE_CLI },
    )

    expect(report.ok).toBe(true)
    expect(report.race.winner).toBe('openai/isolated-model')
  })
})
