#!/usr/bin/env node
/**
 * install-to-dsh — 把本项目的 vision_race 插件/脚本安装到当前 DSH 环境。
 *
 * 会写入：
 *   1. ~/.modlens/race.mjs                    竞速执行器（被 vision_race 工具调用）
 *   2. ~/.dsh/profiles/web/node_modules/dsh-vision-picker/
 *      （index.js + client.js + package.json + cordis.patch.yml）Vision Picker 设置卡片
 *
 * 运行前建议先退出 DSH Desktop（插件 Host 改动需重启生效）。
 * 用法：node scripts/install-to-dsh.mjs
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const dshHome = homedir()

function copyFile(source, target) {
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log(`  ✔ ${target}`)
}

function copyDirContents(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(sourceDir)) {
    const source = join(sourceDir, entry)
    const target = join(targetDir, entry)
    copyFile(source, target)
  }
}

function main() {
  const modlensHome = join(dshHome, '.modlens')
  const pickerDir = join(dshHome, '.dsh', 'profiles', 'web', 'node_modules', 'dsh-vision-picker')

  console.log('[1/2] 竞速执行器 → ~/.modlens/race.mjs')
  const raceScript = join(projectRoot, 'dsh', 'race.mjs')
  if (!existsSync(raceScript)) {
    console.error('缺少 dsh/race.mjs，请确认源码完整')
    process.exit(1)
  }
  mkdirSync(modlensHome, { recursive: true })
  copyFile(raceScript, join(modlensHome, 'race.mjs'))

  console.log('[2/2] Vision Picker 插件 → profiles/web/node_modules/dsh-vision-picker/')
  copyDirContents(join(projectRoot, 'dsh'), pickerDir)

  console.log('\n完成。请重启 DSH Desktop 生效。')
  console.log('校验：设置里出现「视觉模型挑选」卡片；发图给 AI 应走 vision_race 竞速。')
}

main()
