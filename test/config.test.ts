import { describe, expect, it } from 'vitest'
import { defaultRaceConfig, isSameRacer, loadRaceConfig, parseRaceConfig, racerLabel } from '../src/config.ts'
import type { Racer } from '../src/types.ts'

describe('parseRaceConfig', () => {
  it('解析合法阵容', () => {
    const config = parseRaceConfig(
      JSON.stringify({
        timeoutMs: 60000,
        staggerMs: 2000,
        racers: [{ provider: 'openai', model: 'glm-5.2' }, { provider: 'gemini-api' }],
      }),
    )
    expect(config.timeoutMs).toBe(60000)
    expect(config.staggerMs).toBe(2000)
    expect(config.racers).toHaveLength(2)
  })

  it('容忍 BOM 前缀', () => {
    const config = parseRaceConfig(`\uFEFF${JSON.stringify({ racers: [{ provider: 'openai', model: 'm1' }] })}`)
    expect(config.racers).toHaveLength(1)
  })

  it('非法 JSON 抛错', () => {
    expect(() => parseRaceConfig('not-json')).toThrow()
  })

  it('racers 里过滤掉缺 provider 的项', () => {
    const config = parseRaceConfig(
      JSON.stringify({ racers: [{ provider: 'openai', model: 'ok' }, { model: 'no-provider' }, 'junk'] }),
    )
    expect(config.racers).toHaveLength(1)
    expect(config.racers[0]?.model).toBe('ok')
  })

  it('缺失字段回退默认值', () => {
    const config = parseRaceConfig('{}')
    expect(config.timeoutMs).toBe(120000)
    expect(config.staggerMs).toBe(0)
    expect(config.racers).toHaveLength(0)
  })
})

describe('loadRaceConfig', () => {
  it('文件不存在时报错且带路径提示', () => {
    expect(() => loadRaceConfig('C:/no/such/race.json')).toThrow(/阵容配置/)
  })
})

describe('isSameRacer', () => {
  it('相同 provider+model+baseUrl 判定为同一参赛项', () => {
    const a: Racer = { provider: 'openai', model: 'm1', baseUrl: 'https://a/v1' }
    const b: Racer = { provider: 'openai', model: 'm1', baseUrl: 'https://a/v1' }
    expect(isSameRacer(a, b)).toBe(true)
  })

  it('模型不同不算同一项', () => {
    const a: Racer = { provider: 'openai', model: 'm1', baseUrl: 'https://a/v1' }
    const b: Racer = { provider: 'openai', model: 'm2', baseUrl: 'https://a/v1' }
    expect(isSameRacer(a, b)).toBe(false)
  })
})

describe('racerLabel', () => {
  it('优先用 name', () => {
    expect(racerLabel({ provider: 'openai', name: '我的模型' })).toBe('我的模型')
  })

  it('无 name 时用 provider/model', () => {
    expect(racerLabel({ provider: 'openai', model: 'm1' })).toBe('openai/m1')
    expect(racerLabel({ provider: 'gemini-api' })).toBe('gemini-api/(default)')
  })
})

describe('defaultRaceConfig', () => {
  it('返回安全默认值', () => {
    expect(defaultRaceConfig()).toEqual({ timeoutMs: 120000, staggerMs: 0, racers: [] })
  })
})
