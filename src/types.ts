/** 单个参赛模型（racer）的配置。 */
export interface Racer {
  /** 展示名，如 "myapi glm-5.3" */
  name?: string
  /** modlens provider 名：openai | gemini-api | anthropic | claude-cli | antigravity-cli | kimi-cli */
  provider: string
  /** 模型名；缺省时用 modlens 配置里的默认模型 */
  model?: string
  /** 独立端点 baseUrl（带 baseUrl/apiKey 的 racer 走隔离 HOME，互不干扰） */
  baseUrl?: string
  /** 独立端点 API key */
  apiKey?: string
  /** 代理，如 http://127.0.0.1:10808 */
  proxy?: string
  /** 请求体合并项，如 { "thinking": { "type": "disabled" } } */
  extraBody?: Record<string, unknown>
  /** 是否要求模型按 structuredOutput 返回 JSON */
  structuredOutput?: boolean
}

/** 竞速阵容配置文件（race.json）结构。 */
export interface RaceConfig {
  /** 单个 racer 超时（毫秒） */
  timeoutMs: number
  /** 梯队间隔（毫秒）；0 = 全员同时起跑 */
  staggerMs: number
  /** 参赛模型列表 */
  racers: Racer[]
}

/** 单个 racer 的竞速结果。 */
export interface AttemptResult {
  provider: string
  model: string
  won: boolean
  ok: boolean
  durationMs: number
  /** 失败原因（仅 ok=false 时） */
  error?: string
}

/** 竞速战报（整个 race 的输出）。 */
export interface RaceReport {
  /** 是否有 racer 成功 */
  ok: boolean
  race: {
    /** 胜者标签，如 "openai/bankofai/glm-5.3-flash" */
    winner?: string
    /** 总耗时（毫秒，= 胜者耗时） */
    durationMs?: number
    timeoutMs: number
    staggerMs: number
    /** 全部 racer 的逐项结果（覆盖所有 racer，输家标注 killed/skipped） */
    attempts: AttemptResult[]
  }
  /** 胜者的 modlens 结构化结果（ok 时为胜者的 parsed） */
  result?: unknown
}
