#!/usr/bin/env node
/**
 * modlens-race — 多个视觉模型同时看一张图，谁先成功用谁，输家立刻杀掉。
 *
 * 阵容配置 ~/.modlens/race.json：
 * {
 *   "timeoutMs": 90000,
 *   "staggerMs": 0,
 *   "racers": [
 *     { "name": "myapi glm-5.3", "provider": "openai", "model": "bankofai/glm-5.3-flash",
 *       "baseUrl": "https://myapi.mmcc.cc.cd/v1", "apiKey": "sk-..." },
 *     { "provider": "gemini-api" }
 *   ]
 * }
 *
 * racer 两种模式：
 * - 带 baseUrl+apiKey → 独立端点：临时造一个隔离 HOME 写入专属
 *   ~/.modlens/config.json，子进程在该 HOME 下运行，互不干扰。
 * - 不带 → 共享模式：直接用本机 ~/.modlens/config.json（--model 可覆盖）。
 *
 * 用法：
 *   node race.mjs <图片路径|https地址> [--prompt "重点关注"] [--timeout ms]
 *                [--stagger ms] [--config 路径]
 *
 * staggerMs > 0 = 梯队模式（第 1 个先跑，每 stagger ms 补一个下一名，省配额）；
 * 0 = 全员同时起跑（最快，最费配额）。
 */

import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const MODLENS_CLI =
  process.env.MODLENS_CLI ||
  join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@liustack', 'modlens', 'dist', 'main.js')
const DEFAULT_CONFIG = join(homedir(), '.modlens', 'race.json')

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--prompt') args.prompt = argv[++i]
    else if (a === '--timeout') args.timeout = Number(argv[++i])
    else if (a === '--stagger') args.stagger = Number(argv[++i])
    else if (a === '--config') args.config = argv[++i]
    else if (!a.startsWith('--')) args._.push(a)
  }
  return args
}

const live = new Set()
let cancelled = false

/** Build an isolated HOME with a private modlens config for one racer. */
function makeIsolatedHome(racer) {
  const home = mkdtempSync(join(tmpdir(), 'modlens-race-'))
  const settings = {}
  if (racer.baseUrl) settings.baseUrl = racer.baseUrl
  if (racer.model) settings.model = racer.model
  if (racer.apiKey) settings.apiKey = racer.apiKey
  if (racer.proxy) settings.proxy = racer.proxy
  if (racer.structuredOutput === true) settings.structuredOutput = true
  const cfg = { provider: racer.provider, providers: { [racer.provider]: settings } }
  mkdirSync(join(home, '.modlens'), { recursive: true })
  writeFileSync(join(home, '.modlens', 'config.json'), JSON.stringify(cfg, null, 2) + '\n')
  return home
}

function runRacer(racer, image, opts) {
  return new Promise((resolve) => {
    const started = Date.now()
    const done = (result) => resolve(result)
    if (cancelled) {
      done({ racer, ok: false, error: 'race already won (skipped)', durationMs: 0 })
      return
    }
    let home = null
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    // 独立端点 racer：把 USERPROFILE/HOME 指到隔离目录，modlens 读它自己的 config
    if (racer.baseUrl || racer.apiKey) {
      try {
        home = makeIsolatedHome(racer)
        env.USERPROFILE = home
        env.HOME = home
        env.XDG_CONFIG_HOME = join(home, '.config')
      } catch (err) {
        done({ racer, ok: false, error: 'isolated home failed: ' + String(err?.message ?? err), durationMs: 0 })
        return
      }
    }
    const cliArgs = [MODLENS_CLI, '-i', image, '--timeout', String(opts.timeoutMs), '--provider', racer.provider]
    if (racer.model) cliArgs.push('--model', racer.model)
    if (opts.prompt) cliArgs.push('--prompt', opts.prompt)
    if (racer.extraBody) cliArgs.push('--extra-body', JSON.stringify(racer.extraBody))

    const child = spawn(process.execPath, cliArgs, { stdio: ['ignore', 'pipe', 'pipe'], env })
    live.add(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })

    const finish = (result) => {
      clearTimeout(timer)
      live.delete(child)
      if (home) {
        try {
          rmSync(home, { recursive: true, force: true })
        } catch {}
      }
      resolve(result)
    }
    // modlens 自带 --timeout；再加 20 秒宽限硬杀，防卡死不退
    const timer = setTimeout(() => {
      try {
        child.kill('kill')
      } catch {}
    }, opts.timeoutMs + 20_000)

    child.on('error', (err) => {
      finish({ racer, ok: false, error: String(err?.message ?? err), durationMs: Date.now() - started })
    })
    child.on('close', (code) => {
      const durationMs = Date.now() - started
      if (cancelled && code !== 0) {
        finish({ racer, ok: false, error: 'race already won (killed)', durationMs })
        return
      }
      if (code !== 0) {
        finish({ racer, ok: false, error: (stderr || stdout).trim().slice(0, 300) || `exit code ${code}`, durationMs })
        return
      }
      try {
        finish({ racer, ok: true, parsed: JSON.parse(stdout), durationMs })
      } catch {
        finish({ racer, ok: false, error: `unparseable output: ${stdout.trim().slice(0, 200)}`, durationMs })
      }
    })
  })
}

function stopAll() {
  cancelled = true
  for (const child of live) {
    try {
      child.kill('kill')
    } catch {}
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const image = args._[0]
  if (!image) {
    console.error('usage: node race.mjs <imagePath|url> [--prompt text] [--timeout ms] [--stagger ms] [--config path]')
    process.exit(2)
  }
  let cfg
  try {
    cfg = JSON.parse(readFileSync(args.config || DEFAULT_CONFIG, 'utf8').replace(/^\uFEFF/, ''))
  } catch (err) {
    console.error(`cannot read race config: ${err?.message ?? err}`)
    process.exit(2)
  }
  const racers = Array.isArray(cfg.racers) ? cfg.racers : []
  if (racers.length === 0) {
    console.error(`no racers in ${args.config || DEFAULT_CONFIG}`)
    process.exit(2)
  }
  const timeoutMs = args.timeout || cfg.timeoutMs || 120_000
  const staggerMs = args.stagger ?? cfg.staggerMs ?? 0
  const opts = { timeoutMs, prompt: args.prompt }

  const attempts = racers.map((racer, idx) =>
    (async () => {
      if (idx > 0 && staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs * idx))
      if (cancelled) return { racer, ok: false, error: 'race already won (skipped)', durationMs: 0 }
      return runRacer(racer, image, opts)
    })(),
  )

  const results = new Array(racers.length).fill(null)
  let pending = racers.length
  const winner = await new Promise((resolve) => {
    attempts.forEach((p, idx) => {
      p.then((res) => {
        results[idx] = res
        pending -= 1
        if (res?.ok) resolve(res)
        else if (pending === 0) resolve(null)
      })
    })
  })

  stopAll()
  // 给被杀的输家一点时间收尾，让战报尽量完整（最多等 3 秒）
  await Promise.race([Promise.allSettled(attempts), new Promise((r) => setTimeout(r, 3000))])

  // 战报必须覆盖全部 racer：被杀的输家若死亡回执没在收尸窗口内赶回，
  // 用占位条目补齐，而不是从战报里消失。
  const report = results.map((r, idx) => {
    const racer = racers[idx]
    if (!r) {
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
      provider: r.racer.provider,
      model: r.racer.model ?? '(default)',
      won: r === winner,
      ok: r.ok === true,
      durationMs: r.durationMs,
      ...(r.ok ? {} : { error: String(r.error ?? '').slice(0, 300) }),
    }
  })

  if (!winner) {
    console.log(JSON.stringify({ ok: false, race: { timeoutMs, staggerMs, attempts: report } }, null, 2))
    process.exit(1)
  }
  const winnerLabel = `${winner.racer.provider}${winner.racer.model ? '/' + winner.racer.model : ''}`
  console.log(
    JSON.stringify(
      {
        ...winner.parsed,
        race: { winner: winnerLabel, durationMs: winner.durationMs, timeoutMs, staggerMs, attempts: report },
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(String(err?.stack ?? err))
  process.exit(2)
})
