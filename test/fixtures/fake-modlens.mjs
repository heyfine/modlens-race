#!/usr/bin/env node
/**
 * 测试用假 modlens CLI —— 不真的调 API，按模型名模拟成功/失败/延迟。
 *
 * 约定：
 *   -i <image> --timeout <ms> --provider <provider> [--model <model>]
 *
 * 行为：
 *   - 模型名以 fail: 开头 → 立即失败（stdout 无 JSON，exit 1）
 *   - 模型名以 slow:NNNms: 开头 → 延迟 NNNms 后成功
 *   - 其他 → 立即成功，返回结构化的假结果（summary/ocr）
 */
import { setTimeout as sleep } from 'node:timers/promises'

function parseArgs(argv) {
  const args = { image: '', timeoutMs: 180000, provider: '', model: '' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '-i') args.image = argv[++i]
    else if (arg === '--timeout') args.timeoutMs = Number(argv[++i])
    else if (arg === '--provider') args.provider = argv[++i]
    else if (arg === '--model') args.model = argv[++i]
  }
  return args
}

function fakeResult(model, image) {
  return {
    summary: `fake read of ${model}`,
    ocr: { full_text: `MODEL=${model}\nIMAGE=${image}` },
    layout: { regions: [] },
    semantics: { scene: 'test fixture', intent: 'simulate a successful vision read' },
    uncertainty: [],
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.model.startsWith('fail:')) {
    process.stderr.write(`fake failure for ${args.model}\n`)
    process.exit(1)
  }

  const slowMatch = args.model.match(/^slow:(\d+)ms:/)
  if (slowMatch) {
    const delay = Number(slowMatch[1])
    await sleep(delay)
    const realModel = args.model.replace(/^slow:\d+ms:/, '')
    process.stdout.write(JSON.stringify(fakeResult(realModel, args.image), null, 2) + '\n')
    process.exit(0)
  }

  process.stdout.write(JSON.stringify(fakeResult(args.model, args.image), null, 2) + '\n')
  process.exit(0)
}

main().catch((error) => {
  process.stderr.write(String(error) + '\n')
  process.exit(2)
})
