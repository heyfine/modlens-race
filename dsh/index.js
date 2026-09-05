// dsh-vision-picker Host: a settings card to pick a vision model from the
// user's DSH providers and wire it into modlens (~/.modlens/config.json,
// openai engine). Native HTML card on the client side keeps it free of the
// dsh-client-ui-primitives dependency that keeps modlens's own card from
// loading on partial profiles.
//
// Race half: manages ~/.modlens/race.json — a roster of vision models that
// read every image IN PARALLEL (first success wins, losers killed) via
// ~/.modlens/race.mjs. Racers either share the modlens config or carry their
// own OpenAI-compatible baseUrl+key (isolated HOME per racer). Also registers
// the vision_race model tool so the agent reads images through the race.
//
// Full node access (bundled plugin): os/fs/path + process.env are available.
import { homedir, tmpdir } from 'node:os'
import { readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import zlib from 'node:zlib'

const SETTINGS_PATH = join(homedir(), '.dsh', 'settings.yaml')
const CRED_PATH = join(homedir(), '.dsh', '.credentials.yaml')
const MODLENS_PATH = join(homedir(), '.modlens', 'config.json')
// Per-model proxy overrides: "provider|model" -> proxy url. Kept in its own
// file so we never pollute modlens's own config schema with unknown fields.
const PROXY_MAP_PATH = join(homedir(), '.modlens', 'vision-picker-proxies.json')
// Race roster + runner.
const RACE_PATH = join(homedir(), '.modlens', 'race.json')
const RACE_SCRIPT = join(homedir(), '.modlens', 'race.mjs')
const RACE_TEST_IMAGE = join(tmpdir(), 'vision_test.png')
// modlens_read_image kill-switch, toggled from the card; the modlens plugin
// re-reads this file on every tool call, so flips apply without a restart.
const READ_TOOL_PATH = join(homedir(), '.modlens', 'read-tool.json')

/** Line-state parser for the llm-pi-ai.providers block of settings.yaml. */
function parseProviders() {
  let text
  try {
    text = readFileSync(SETTINGS_PATH, 'utf8')
  } catch {
    return []
  }
  const lines = text.split(/\r?\n/)
  const providers = []
  let state = 'top' // top | llm | providers
  let cur = null
  let inModels = false
  const strip = (v) =>
    String(v)
      .trim()
      .replace(/^["']|["']$/g, '')
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')
    if (line === '' || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    if (state === 'top') {
      if (trimmed === 'llm-pi-ai:') {
        state = 'llm'
      }
      continue
    }
    if (state === 'llm') {
      if (indent === 0) {
        state = 'top'
        continue
      }
      if (indent === 2 && trimmed === 'providers:') {
        state = 'providers'
      }
      continue
    }
    // state === 'providers'
    if (indent <= 1) {
      // left the providers block entirely
      if (cur && cur.baseURL && cur.apiKeyEnv) providers.push(cur)
      cur = null
      state = indent === 0 ? 'top' : 'llm'
      continue
    }
    if (indent === 4 && /^[\w./-]+:$/.test(trimmed)) {
      // new provider id
      if (cur && cur.baseURL && cur.apiKeyEnv) providers.push(cur)
      cur = { id: trimmed.slice(0, -1), baseURL: '', apiKeyEnv: '', models: [] }
      inModels = false
      continue
    }
    if (!cur) continue
    if (indent === 6 && trimmed.startsWith('baseURL:')) {
      cur.baseURL = strip(trimmed.slice(8))
      inModels = false
      continue
    }
    if (indent === 6 && trimmed.startsWith('apiKeyEnv:')) {
      cur.apiKeyEnv = strip(trimmed.slice(10))
      inModels = false
      continue
    }
    if (indent === 6 && trimmed === 'models:') {
      inModels = true
      continue
    }
    if (inModels && indent >= 8) {
      const m = trimmed.match(/^-\s*id:\s*(\S+)/)
      if (m) cur.models.push(strip(m[1]))
      continue
    }
    if (indent < 6) inModels = false
  }
  if (cur && cur.baseURL && cur.apiKeyEnv) providers.push(cur)
  return providers
}

/** Parse the { NAME: value, } credentials file into a plain map. */
function parseCredentials() {
  let text
  try {
    text = readFileSync(CRED_PATH, 'utf8')
  } catch {
    return {}
  }
  const creds = {}
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(\S[^\s,]*)/)
    if (m && m[2] !== '{') creds[m[1]] = m[2]
  }
  return creds
}

/** Read the per-model proxy map from disk; {} when absent. */
function readProxyMap() {
  try {
    const parsed = JSON.parse(readFileSync(PROXY_MAP_PATH, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Persist the per-model proxy map (no BOM; plain JSON). */
function writeProxyMap(map) {
  mkdirSync(dirname(PROXY_MAP_PATH), { recursive: true })
  writeFileSync(PROXY_MAP_PATH, JSON.stringify(map, null, 2) + '\n')
}

/** Stable key for one model entry. */
function proxyKey(providerId, model) {
  return providerId + '|' + model
}

/** Build the pickable model list with resolved baseUrl, key presence, and proxy. */
function listModels() {
  const providers = parseProviders()
  const creds = parseCredentials()
  const proxies = readProxyMap()
  const out = []
  for (const p of providers) {
    const apiKey = creds[p.apiKeyEnv] || ''
    for (const model of p.models) {
      out.push({
        provider: p.id,
        model,
        baseUrl: p.baseURL,
        hasKey: apiKey !== '',
        keyLen: apiKey.length,
        proxy: proxies[proxyKey(p.id, model)] || '',
      })
    }
  }
  return out
}

/** Read the currently-active modlens config (openai engine entry). */
function readActive() {
  try {
    const cfg = JSON.parse(readFileSync(MODLENS_PATH, 'utf8'))
    const o = (cfg.providers && cfg.providers.openai) || {}
    return {
      provider: 'openai',
      baseUrl: o.baseUrl || '',
      model: o.model || '',
      hasKey: !!o.apiKey,
    }
  } catch {
    return { provider: '', baseUrl: '', model: '', hasKey: false }
  }
}

/** Apply a pick: resolve baseUrl+key, write ~/.modlens/config.json (openai engine, preserve gemini-api). */
function applyPick(providerId, model) {
  const providers = parseProviders()
  const creds = parseCredentials()
  const p = providers.find((x) => x.id === providerId)
  if (!p) throw new Error('provider not found: ' + providerId)
  if (!p.models.includes(model)) throw new Error('model not found under ' + providerId + ': ' + model)
  const apiKey = creds[p.apiKeyEnv] || ''
  if (!apiKey) throw new Error('no api key found for ' + p.apiKeyEnv + ' in .credentials.yaml')
  const proxies = readProxyMap()
  const proxy = proxies[proxyKey(providerId, model)] || ''
  let cfg = {}
  try {
    cfg = JSON.parse(readFileSync(MODLENS_PATH, 'utf8'))
  } catch {
    cfg = {}
  }
  const prevOpenai = cfg.providers && typeof cfg.providers.openai === 'object' ? cfg.providers.openai : {}
  cfg.provider = 'openai'
  cfg.providers = cfg.providers || {}
  cfg.providers.openai = { baseUrl: p.baseURL, model, apiKey }
  // carry structuredOutput forward (set earlier so minimax returns JSON)
  if (prevOpenai.structuredOutput === true) cfg.providers.openai.structuredOutput = true
  // apply this model's proxy override (set it, or clear so a direct model stays direct)
  if (proxy) cfg.providers.openai.proxy = proxy
  else delete cfg.providers.openai.proxy
  // keep a gemini-api entry around for users who later fix their proxy
  if (!cfg.providers['gemini-api']) cfg.providers['gemini-api'] = {}
  // refuse to write through a symlink (modlens's own guard)
  try {
    if (lstatSync(MODLENS_PATH).isSymbolicLink()) throw new Error(MODLENS_PATH + ' is a symlink')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  mkdirSync(dirname(MODLENS_PATH), { recursive: true })
  writeFileSync(MODLENS_PATH, JSON.stringify(cfg, null, 2) + '\n')
  return { ok: true, provider: providerId, model, baseUrl: p.baseURL, apiKeyEnv: p.apiKeyEnv }
}

// ---------------------------------------------------------------------------
// Race roster (~/.modlens/race.json)
// ---------------------------------------------------------------------------

function defaultRaceConfig() {
  return { timeoutMs: 90000, staggerMs: 0, racers: [] }
}

/** modlens_read_image kill-switch state; absent/corrupt file means enabled. */
function readToolEnabled() {
  try {
    const flag = JSON.parse(readFileSync(READ_TOOL_PATH, 'utf8'))
    return !(flag && flag.enabled === false)
  } catch {
    return true
  }
}

/** Persist the kill-switch; the modlens plugin honors it on every tool call. */
function writeReadToolEnabled(enabled) {
  mkdirSync(dirname(READ_TOOL_PATH), { recursive: true })
  writeFileSync(READ_TOOL_PATH, JSON.stringify({ enabled: !!enabled }, null, 2) + '\n')
}

function readRace() {
  try {
    const parsed = JSON.parse(readFileSync(RACE_PATH, 'utf8').replace(/^\uFEFF/, ''))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultRaceConfig()
    return {
      timeoutMs: Number(parsed.timeoutMs) > 0 ? Number(parsed.timeoutMs) : 90000,
      staggerMs: Number(parsed.staggerMs) >= 0 ? Number(parsed.staggerMs) : 0,
      racers: Array.isArray(parsed.racers) ? parsed.racers.filter((r) => r && typeof r.provider === 'string') : [],
    }
  } catch {
    return defaultRaceConfig()
  }
}

function writeRace(cfg) {
  mkdirSync(dirname(RACE_PATH), { recursive: true })
  try {
    if (lstatSync(RACE_PATH).isSymbolicLink()) throw new Error(RACE_PATH + ' is a symlink')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  writeFileSync(RACE_PATH, JSON.stringify(cfg, null, 2) + '\n')
}

function clamp(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/** Browser-safe view: never returns apiKey values. */
function raceView(cfg) {
  return {
    timeoutMs: cfg.timeoutMs,
    staggerMs: cfg.staggerMs,
    racers: cfg.racers.map((r) => ({
      name: r.name || '',
      provider: r.provider,
      model: r.model || '',
      baseUrl: r.baseUrl || '',
      proxy: r.proxy || '',
      hasKey: r.provider === 'openai' ? !!r.apiKey : true,
    })),
  }
}

function racerLabel(r) {
  return r.name || r.provider + '/' + (r.model || '(default)')
}

function sameRacer(a, b) {
  return a.provider === b.provider && (a.model || '') === (b.model || '') && (a.baseUrl || '') === (b.baseUrl || '')
}

/** Resolve a scanned DSH model into a self-contained racer entry. */
function resolveScannedRacer(providerId, model) {
  const providers = parseProviders()
  const creds = parseCredentials()
  const p = providers.find((x) => x.id === providerId)
  if (!p) throw new Error('provider not found: ' + providerId)
  if (!p.models.includes(model)) throw new Error('model not found under ' + providerId + ': ' + model)
  const apiKey = creds[p.apiKeyEnv] || ''
  if (!apiKey) throw new Error('no api key found for ' + p.apiKeyEnv + ' in .credentials.yaml')
  const proxies = readProxyMap()
  const racer = {
    name: providerId + ' · ' + model,
    provider: 'openai',
    model,
    baseUrl: p.baseURL,
    apiKey,
  }
  const proxy = proxies[proxyKey(providerId, model)]
  if (proxy) racer.proxy = proxy
  // inherit structuredOutput from the active modlens openai entry (it worked there)
  try {
    const cfg = JSON.parse(readFileSync(MODLENS_PATH, 'utf8'))
    if (cfg.providers && cfg.providers.openai && cfg.providers.openai.structuredOutput === true) {
      racer.structuredOutput = true
    }
  } catch {}
  return racer
}

/** Ensure the shared race test image exists (text banner via System.Drawing fallback: color bars in pure JS). */
function ensureRaceTestImage() {
  if (existsSync(RACE_TEST_IMAGE)) return RACE_TEST_IMAGE
  writeFileSync(RACE_TEST_IMAGE, makeColorBarsPng())
  return RACE_TEST_IMAGE
}

function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0
  if (!crc32.table) {
    crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crc32.table[n] = c
    }
  }
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crc32.table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** 400x200 RGB PNG: top = red/green/blue bands, bottom = black/white stripes. */
function makeColorBarsPng() {
  const w = 400
  const h = 200
  const raw = Buffer.alloc((w * 3 + 1) * h)
  let o = 0
  for (let y = 0; y < h; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      let r
      let g
      let b
      if (y < h / 2) {
        if (x < w / 3) {
          r = 220
          g = 40
          b = 40
        } else if (x < (2 * w) / 3) {
          r = 40
          g = 170
          b = 60
        } else {
          r = 40
          g = 70
          b = 220
        }
      } else {
        const dark = Math.floor(x / 25) % 2 === 0
        r = g = b = dark ? 20 : 235
      }
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Spawn the race runner and return its parsed JSON report. */
/** Spawn the race runner and return its parsed JSON report.
 * whenRacer: optional sameRacer predicate — match exactly one roster entry and
 * race only that one (single-model test). Implemented with a temp race file so
 * the shared roster is untouched. */
function runRaceScript(image, timeoutMs, prompt, signal, whenRacer) {
  return new Promise((resolve, reject) => {
    if (!existsSync(RACE_SCRIPT)) {
      reject(new Error('race runner missing: ' + RACE_SCRIPT))
      return
    }
    let configPath = RACE_PATH
    let tempCfg = null
    if (typeof whenRacer === 'function') {
      const cfg = readRace()
      const racers = cfg.racers.filter((r) => {
        try {
          return whenRacer(r)
        } catch {
          return false
        }
      })
      if (racers.length === 0) {
        reject(new Error('racer not found in roster'))
        return
      }
      tempCfg = {
        timeoutMs,
        staggerMs: 0,
        racers,
      }
      configPath = join(tmpdir(), 'modlens-single-test-' + Date.now() + '.json')
      writeFileSync(configPath, JSON.stringify(tempCfg, null, 2) + '\n')
    }
    const args = [RACE_SCRIPT, image, '--timeout', String(timeoutMs), '--config', configPath]
    if (prompt) args.push('--prompt', String(prompt))
    const cleanup = () => {
      if (tempCfg) {
        try {
          rmSync(configPath, { force: true })
        } catch {}
      }
    }
    const child = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    const timer = setTimeout(() => {
      try {
        child.kill('kill')
      } catch {}
    }, timeoutMs + 30000)
    child.on('error', (err) => {
      clearTimeout(timer)
      cleanup()
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      cleanup()
      if (code !== 0) {
        reject(new Error((stderr || stdout).trim().slice(0, 400) || 'race exit ' + code))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error('race output not JSON: ' + stdout.trim().slice(0, 200)))
      }
    })
    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          try {
            child.kill('kill')
          } catch {}
        },
        { once: true },
      )
    }
  })
}

// ---------------------------------------------------------------------------
// vision_race model tool
// ---------------------------------------------------------------------------

function renderRaceEvidence(parsed) {
  const r = parsed && parsed.result ? parsed.result : {}
  const race = parsed && parsed.race ? parsed.race : {}
  const lines = []
  lines.push('[vision_race] winner: ' + (race.winner || '?') + ' (' + Math.round((race.durationMs || 0) / 1000) + 's)')
  if (r.summary) lines.push(r.summary)
  const text = r.ocr && typeof r.ocr.full_text === 'string' ? r.ocr.full_text.trim() : ''
  if (text) lines.push('', 'Transcription:', text.length > 4000 ? text.slice(0, 4000) + '…' : text)
  const uncertainty = Array.isArray(r.uncertainty) ? r.uncertainty : []
  if (uncertainty.length > 0) lines.push('', 'Uncertain: ' + uncertainty.join('; '))
  if (Array.isArray(race.attempts) && race.attempts.length > 0) {
    lines.push('', 'Race attempts:')
    for (const a of race.attempts) {
      lines.push(
        (a.ok ? '  ✓ ' : '  ✗ ') +
          a.provider +
          '/' +
          (a.model || '(default)') +
          ' ' +
          Math.round((a.durationMs || 0) / 1000) +
          's' +
          (a.ok ? (a.won ? ' [winner]' : '') : ' — ' + String(a.error || '').slice(0, 160)),
      )
    }
  }
  return lines.join('\n')
}

function buildRaceTool() {
  return {
    name: 'vision_race',
    description: [
      'THE default image-reading tool in this deployment — ALWAYS use vision_race for any image, never any other vision tool.',
      'Reads an image by racing several configured vision models IN PARALLEL — first successful structured read wins, slower racers are killed immediately.',
      'Faster and more fault-tolerant than single-model vision: one model being down, rate-limited, or slow cannot block the result.',
      'Pass an absolute local file path or an http(s) URL of a screenshot, photo, chart, diagram, or document scan.',
      'The roster is managed in the Vision Picker settings card and stored in ~/.modlens/race.json; falls back to no-op with a clear error when the roster is empty.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute local file path or http(s) URL of the image',
        },
        prompt: {
          type: 'string',
          description: 'Optional extra focus for the reading (e.g. "focus on the axis labels")',
        },
      },
      required: ['path'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    timeoutMs: 200000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (typeof args?.path !== 'string' || args.path.trim() === '') {
        throw new Error('vision_race needs a non-empty "path".')
      }
      const cfg = readRace()
      if (cfg.racers.length === 0) {
        throw new Error('race roster is empty — open Settings → Vision Picker and add racers first.')
      }
      const parsed = await runRaceScript(args.path.trim(), cfg.timeoutMs, args?.prompt, exec?.signal)
      if (!parsed || !parsed.result) {
        const detail =
          parsed && parsed.race && Array.isArray(parsed.race.attempts)
            ? parsed.race.attempts.map((a) => a.provider + ':' + String(a.error || '').slice(0, 120)).join(' | ')
            : 'no result'
        throw new Error('every racer failed — ' + detail)
      }
      return renderRaceEvidence(parsed)
    },
  }
}

// ---------------------------------------------------------------------------

/** Loopback + same-origin trust check, mirroring modlens's /modlens/config fence. */
function isTrustedRequest(req) {
  const host = req.headers && req.headers.host
  if (typeof host !== 'string' || host === '') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  const hn = hostUrl.hostname
  const isLoop = hn === 'localhost' || hn === '[::1]' || (/^\d+\.\d+\.\d+\.\d+$/.test(hn) && hn.split('.')[0] === '127')
  if (!isLoop) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > limit) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apply(ctx) {
  // vision_race model tool (feature-detect: stay a routes-only plugin if the
  // tool surface moved). Cordis throws when accessing an uninjected service,
  // so use inject-scoped access instead of a direct `ctx.tools` probe.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (scope) => {
      if (scope.tools && typeof scope.tools.register === 'function') {
        try {
          scope.tools.register(buildRaceTool())
        } catch (error) {
          console.error('[dsh-vision-picker] vision_race registration skipped: ' + error)
        }
      }
    })
  }

  // webServer exists only under the web profile; ride a scoped inject so the
  // closure runs where the service exists and never where it does not.
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['webServer'], (scope) => {
    const send = (res, status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    const trusted = (req, res, method) => {
      if (!isTrustedRequest(req)) {
        send(res, 403, { error: 'loopback same-origin only' })
        return false
      }
      if (req.method !== method) {
        send(res, 405, { error: method + ' only' })
        return false
      }
      return true
    }
    const postBody = async (req, res) => {
      try {
        return JSON.parse(await readBody(req))
      } catch (error) {
        send(res, 400, { error: String(error && error.message ? error.message : error) })
        return undefined
      }
    }

    // GET /vp/list -> { models, active }
    scope.webServer.register({
      name: 'vp-list',
      kind: 'exact',
      path: '/vp/list',
      handler: async (req, res) => {
        if (!trusted(req, res, 'GET')) return
        try {
          send(res, 200, { models: listModels(), active: readActive() })
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/apply { provider, model } -> write modlens config
    scope.webServer.register({
      name: 'vp-apply',
      kind: 'exact',
      path: '/vp/apply',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          if (!body || typeof body.provider !== 'string' || typeof body.model !== 'string') {
            return send(res, 400, { error: 'needs { provider, model }' })
          }
          send(res, 200, applyPick(body.provider, body.model))
        } catch (error) {
          send(res, 400, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/setproxy { provider, model, proxy } -> save/clear that model's proxy override
    scope.webServer.register({
      name: 'vp-setproxy',
      kind: 'exact',
      path: '/vp/setproxy',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          if (
            !body ||
            typeof body.provider !== 'string' ||
            typeof body.model !== 'string' ||
            typeof body.proxy !== 'string'
          ) {
            return send(res, 400, { error: 'needs { provider, model, proxy }' })
          }
          const map = readProxyMap()
          const key = proxyKey(body.provider, body.model)
          const value = body.proxy.trim()
          if (value === '') {
            delete map[key]
          } else {
            map[key] = value
          }
          writeProxyMap(map)
          send(res, 200, { ok: true, provider: body.provider, model: body.model, proxy: value })
        } catch (error) {
          send(res, 400, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // GET /vp/race -> roster view (keys masked)
    scope.webServer.register({
      name: 'vp-race-list',
      kind: 'exact',
      path: '/vp/race',
      handler: async (req, res) => {
        if (!trusted(req, res, 'GET')) return
        try {
          send(res, 200, raceView(readRace()))
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/race/add { provider, model } (scanned DSH model, key resolved
    // server-side) or { custom: { baseUrl, model, apiKey, proxy? } }
    scope.webServer.register({
      name: 'vp-race-add',
      kind: 'exact',
      path: '/vp/race/add',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          const cfg = readRace()
          let racer
          if (body && body.custom && typeof body.custom === 'object') {
            const c = body.custom
            const baseUrl = String(c.baseUrl || '').trim()
            const model = String(c.model || '').trim()
            const apiKey = String(c.apiKey || '').trim()
            const proxy = String(c.proxy || '').trim()
            if (!baseUrl || !model || !apiKey) {
              return send(res, 400, { error: 'custom racer needs baseUrl + model + apiKey' })
            }
            racer = { name: 'custom · ' + model, provider: 'openai', model, baseUrl, apiKey }
            if (proxy) racer.proxy = proxy
          } else if (body && typeof body.provider === 'string' && typeof body.model === 'string') {
            racer = resolveScannedRacer(body.provider, body.model)
          } else {
            return send(res, 400, { error: 'needs { provider, model } or { custom: {...} }' })
          }
          if (cfg.racers.some((r) => sameRacer(r, racer))) {
            return send(res, 400, { error: 'already in the roster: ' + racerLabel(racer) })
          }
          cfg.racers.push(racer)
          writeRace(cfg)
          send(res, 200, raceView(cfg))
        } catch (error) {
          send(res, 400, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/race/remove { index }
    scope.webServer.register({
      name: 'vp-race-remove',
      kind: 'exact',
      path: '/vp/race/remove',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          const cfg = readRace()
          const index = Number(body && body.index)
          if (!Number.isInteger(index) || index < 0 || index >= cfg.racers.length) {
            return send(res, 400, { error: 'bad index' })
          }
          cfg.racers.splice(index, 1)
          writeRace(cfg)
          send(res, 200, raceView(cfg))
        } catch (error) {
          send(res, 400, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/race/settings { timeoutMs, staggerMs }
    scope.webServer.register({
      name: 'vp-race-settings',
      kind: 'exact',
      path: '/vp/race/settings',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          const cfg = readRace()
          cfg.timeoutMs = clamp(body && body.timeoutMs, 5000, 300000, 90000)
          cfg.staggerMs = clamp(body && body.staggerMs, 0, 120000, 0)
          writeRace(cfg)
          send(res, 200, raceView(cfg))
        } catch (error) {
          send(res, 400, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/race/test -> run the race on the shared test image, return the report
    scope.webServer.register({
      name: 'vp-race-test',
      kind: 'exact',
      path: '/vp/race/test',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        try {
          const cfg = readRace()
          if (cfg.racers.length === 0) return send(res, 400, { error: 'roster empty — add racers first' })
          if (!existsSync(RACE_SCRIPT)) return send(res, 500, { error: 'race runner missing: ' + RACE_SCRIPT })
          const image = ensureRaceTestImage()
          const parsed = await runRaceScript(image, cfg.timeoutMs, '', undefined)
          send(res, 200, {
            ok: !!parsed.result,
            race: parsed.race || null,
            summary: parsed.result ? parsed.result.summary : '',
          })
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/race/test-one { index } -> race ONLY that roster entry against
    // the shared test image; returns a compact per-model verdict (ok / error).
    scope.webServer.register({
      name: 'vp-race-test-one',
      kind: 'exact',
      path: '/vp/race/test-one',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          const cfg = readRace()
          const index = Number(body && body.index)
          if (!Number.isInteger(index) || index < 0 || index >= cfg.racers.length) {
            return send(res, 400, { error: 'bad index' })
          }
          if (!existsSync(RACE_SCRIPT)) return send(res, 500, { error: 'race runner missing: ' + RACE_SCRIPT })
          const racer = cfg.racers[index]
          const image = ensureRaceTestImage()
          const started = Date.now()
          let parsed
          try {
            parsed = await runRaceScript(image, cfg.timeoutMs, '', undefined, (r) => sameRacer(r, racer))
          } catch (raceError) {
            // race.mjs exits 1 when every racer failed; pull the structured
            // error out of its stdout JSON when possible.
            const raw = String(raceError && raceError.message ? raceError.message : raceError)
            let errText = raw
            const jsonStart = raw.indexOf('{')
            if (jsonStart >= 0) {
              try {
                const j = JSON.parse(raw.slice(jsonStart))
                const a = j && j.race && Array.isArray(j.race.attempts) ? j.race.attempts[0] : null
                if (a && a.error) errText = a.error
              } catch {}
            }
            return send(res, 200, {
              ok: false,
              durationMs: Date.now() - started,
              label: racerLabel(racer),
              error: String(errText).slice(0, 400),
            })
          }
          const a = parsed && parsed.race && Array.isArray(parsed.race.attempts) ? parsed.race.attempts[0] : null
          if (!parsed || !parsed.result) {
            return send(res, 200, {
              ok: false,
              durationMs: a ? a.durationMs : Date.now() - started,
              label: racerLabel(racer),
              error: a && a.error ? String(a.error).slice(0, 400) : 'no result returned',
            })
          }
          send(res, 200, {
            ok: true,
            durationMs: a ? a.durationMs : Date.now() - started,
            label: racerLabel(racer),
            summary: parsed.result.summary || '',
          })
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // GET /vp/readtool -> { enabled } — modlens_read_image kill-switch state.
    scope.webServer.register({
      name: 'vp-readtool-get',
      kind: 'exact',
      path: '/vp/readtool',
      handler: async (req, res) => {
        if (!trusted(req, res, 'GET')) return
        try {
          send(res, 200, { enabled: readToolEnabled() })
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
    // POST /vp/readtool/set { enabled: boolean } — flip the kill-switch.
    // Applies immediately: the modlens plugin re-reads the flag on every call.
    scope.webServer.register({
      name: 'vp-readtool-set',
      kind: 'exact',
      path: '/vp/readtool/set',
      handler: async (req, res) => {
        if (!trusted(req, res, 'POST')) return
        const body = await postBody(req, res)
        if (body === undefined) return
        try {
          if (!body || typeof body.enabled !== 'boolean') {
            return send(res, 400, { error: 'needs { enabled: boolean }' })
          }
          writeReadToolEnabled(body.enabled)
          send(res, 200, { enabled: body.enabled })
        } catch (error) {
          send(res, 500, { error: String(error && error.message ? error.message : error) })
        }
      },
    })
  })
}

export const name = 'dsh-vision-picker'
