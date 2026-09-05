/** 竞速战报的文本渲染（给模型/人看的可读摘要）。 */
import type { RaceReport } from './types.ts'

interface EvidenceLike {
  summary?: string
  ocr?: { full_text?: string }
  uncertainty?: string[]
}

/** 把战报渲染成易读的文本（含摘要、OCR、不确定项、逐 racer 结果）。 */
export function renderRaceEvidence(report: RaceReport): string {
  const result = (report.result ?? {}) as EvidenceLike
  const race = report.race
  const lines: string[] = []

  if (report.ok && race.winner !== undefined) {
    lines.push(`[vision_race] winner: ${race.winner} (${Math.round((race.durationMs ?? 0) / 1000)}s)`)
  } else {
    lines.push('[vision_race] every racer failed')
  }

  if (result.summary) lines.push(result.summary)
  const transcription = result.ocr?.full_text?.trim()
  if (transcription) {
    lines.push('', 'Transcription:', transcription.length > 4000 ? `${transcription.slice(0, 4000)}…` : transcription)
  }
  if (Array.isArray(result.uncertainty) && result.uncertainty.length > 0) {
    lines.push('', `Uncertain: ${result.uncertainty.join('; ')}`)
  }

  if (race.attempts.length > 0) {
    lines.push('', 'Race attempts:')
    for (const attempt of race.attempts) {
      const mark = attempt.ok ? '✓' : '✗'
      const suffix = attempt.ok ? (attempt.won ? ' [winner]' : '') : ` — ${String(attempt.error ?? '').slice(0, 160)}`
      lines.push(
        `  ${mark} ${attempt.provider}/${attempt.model} ${Math.round((attempt.durationMs ?? 0) / 1000)}s${suffix}`,
      )
    }
  }

  return lines.join('\n')
}

/** 把竞速错误的细节压成一行（供异常信息使用）。 */
export function raceFailureDetail(report: RaceReport): string {
  if (report.race.attempts.length === 0) return 'no result'
  return report.race.attempts
    .map((attempt) => `${attempt.provider}:${String(attempt.error ?? 'no report').slice(0, 120)}`)
    .join(' | ')
}
