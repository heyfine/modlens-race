/** modlens CLI 的定位与单 racer 执行（隔离 HOME / 共享模式）。 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Racer } from './types.ts'

/** 候选的 modlens CLI 路径（按优先级，取第一个真实存在的）：
 *  1. 环境变量 MODLENS_CLI
 *  2. 本项目 node_modules 下的 @liustack/modlens/dist/main.js
 *  3. DSH 安装位置的 @liustack/modlens/dist/main.js
 */
export function resolveModlensCli(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MODLENS_CLI) return env.MODLENS_CLI
  // import.meta.url 指向 src/ 或 dist/（构建产物），上跳一级即项目根
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '..', 'node_modules', '@liustack', 'modlens', 'dist', 'main.js'),
    // DSH 安装位置
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@liustack', 'modlens', 'dist', 'main.js'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

/**
 * 独立端点 racer：在临时目录造一个隔离 HOME，写入专属 ~/.modlens/config.json，
 * 让 modlens CLI 读这份配置（baseUrl/apiKey/model/proxy），与共享配置互不干扰。
 */
export function makeIsolatedHome(racer: Racer): string {
  const home = mkdtempSync(join(tmpdir(), 'modlens-race-'))
  const settings: Record<string, unknown> = {}
  if (racer.baseUrl) settings.baseUrl = racer.baseUrl
  if (racer.model) settings.model = racer.model
  if (racer.apiKey) settings.apiKey = racer.apiKey
  if (racer.proxy) settings.proxy = racer.proxy
  if (racer.structuredOutput === true) settings.structuredOutput = true
  const cfg = { provider: racer.provider, providers: { [racer.provider]: settings } }
  mkdirSync(join(home, '.modlens'), { recursive: true })
  writeFileSync(join(home, '.modlens', 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`)
  return home
}

/** 构造 modlens CLI 的 argv。 */
export function buildCliArgs(
  modlensCli: string,
  image: string,
  racer: Racer,
  timeoutMs: number,
  prompt?: string,
): string[] {
  const args = [modlensCli, '-i', image, '--timeout', String(timeoutMs), '--provider', racer.provider]
  if (racer.model) args.push('--model', racer.model)
  if (prompt) args.push('--prompt', prompt)
  if (racer.extraBody) args.push('--extra-body', JSON.stringify(racer.extraBody))
  return args
}

/** 单个 racer 的执行结果。 */
export interface RacerExecution {
  ok: boolean
  /** 成功时为 modlens 的 parsed JSON */
  parsed?: unknown
  /** 失败原因（ok=false） */
  error?: string
  durationMs: number
}

/**
 * 运行单个 racer：spawn modlens CLI，超时宽限硬杀，收 stdout JSON。
 * 独立端点 racer（带 baseUrl/apiKey）会临时创建隔离 HOME 并在结束后清理。
 */
export function runRacer(
  modlensCli: string,
  image: string,
  racer: Racer,
  timeoutMs: number,
  prompt?: string,
  signal?: AbortSignal,
): Promise<RacerExecution> {
  return new Promise((resolve) => {
    const started = Date.now()
    const finish = (result: RacerExecution) => {
      clearTimeout(timer)
      live.delete(child)
      if (home) {
        try {
          rmSync(home, { recursive: true, force: true })
        } catch {}
      }
      resolve(result)
    }

    let home: string | null = null
    const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    if (racer.baseUrl || racer.apiKey) {
      try {
        home = makeIsolatedHome(racer)
        env.USERPROFILE = home
        env.HOME = home
        env.XDG_CONFIG_HOME = join(home, '.config')
      } catch (error) {
        resolve({
          ok: false,
          error: `isolated home failed: ${String((error as Error).message ?? error)}`,
          durationMs: 0,
        })
        return
      }
    }

    const args = buildCliArgs(modlensCli, image, racer, timeoutMs, prompt)
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env })
    live.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    // modlens 自带 --timeout；这里再加 20 秒宽限硬杀，防卡死不退
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
    }, timeoutMs + 20_000)

    child.on('error', (error) => {
      finish({ ok: false, error: String((error as Error).message ?? error), durationMs: Date.now() - started })
    })
    child.on('close', (code) => {
      const durationMs = Date.now() - started
      if (code !== 0) {
        finish({ ok: false, error: (stderr || stdout).trim().slice(0, 300) || `exit code ${code}`, durationMs })
        return
      }
      try {
        finish({ ok: true, parsed: JSON.parse(stdout), durationMs })
      } catch {
        finish({ ok: false, error: `unparseable output: ${stdout.trim().slice(0, 200)}`, durationMs })
      }
    })

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          try {
            child.kill('SIGKILL')
          } catch {}
        },
        { once: true },
      )
    }
  })
}

/** 追踪存活子进程的集合（供 stopAll 使用）。 */
const live = new Set<ReturnType<typeof spawn>>()

/** 杀掉所有仍在运行的子进程（竞速已有胜者时调用）。 */
export function stopAll(): void {
  for (const child of live) {
    try {
      child.kill('SIGKILL')
    } catch {}
  }
}
