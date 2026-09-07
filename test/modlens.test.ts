import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveModlensCli } from '../src/modlens.ts'

describe('resolveModlensCli', () => {
  it('环境变量 MODLENS_CLI 优先', () => {
    expect(resolveModlensCli({ MODLENS_CLI: 'C:/custom/modlens/main.js' })).toBe('C:/custom/modlens/main.js')
  })

  it('默认探测返回本项目 node_modules 中真实存在的 modlens CLI', () => {
    const cli = resolveModlensCli({} as NodeJS.ProcessEnv)
    // 本项目声明 @liustack/modlens 为依赖，pnpm install 后应位于 projects 根下的 node_modules
    expect(cli).toMatch(/node_modules[\\/]@liustack[\\/]modlens[\\/]dist[\\/]main\.js$/)
    expect(existsSync(cli)).toBe(true)
  })
})