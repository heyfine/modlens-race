// 同步脚本：把当前分支同时推送到公开仓库（origin）和私有全量仓库（private）。
//
// 公开仓库不含内部文档；私有仓库会在临时分支上把这些文档补回后再推送。
// 内部文档清单以 .gitignore 中「内部开发文档」区块为准，避免多处维护。
//
// 用法：先在本地正常提交，然后 `pnpm run sync`。
// 要求：remote `origin`（公开）与 `private`（私有）已配置。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SNAPSHOT_BRANCH = 'full-snapshot';
const INTERNAL_SECTION = '# 内部开发文档';

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
}

function gitAllowFail(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function readInternalDocs() {
  const lines = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(INTERNAL_SECTION));
  if (start === -1) {
    throw new Error(`.gitignore 中找不到「${INTERNAL_SECTION}」区块，无法确定内部文档清单`);
  }
  const docs = lines
    .slice(start + 1)
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  if (docs.length === 0) {
    throw new Error('.gitignore「内部开发文档」区块为空');
  }
  return docs;
}

function main() {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') {
    throw new Error('当前处于 detached HEAD，请在正常分支上执行');
  }

  const status = git('status', '--porcelain');
  if (status !== '') {
    throw new Error('工作区有未提交的改动，请先 commit 再同步');
  }

  console.log(`[1/4] 推送 ${branch} → origin（公开仓库）`);
  git('push', 'origin', branch);

  console.log('[2/4] 建立临时快照分支，补回内部文档');
  if (gitAllowFail('rev-parse', '--verify', '--quiet', `refs/heads/${SNAPSHOT_BRANCH}`)) {
    throw new Error(`分支 ${SNAPSHOT_BRANCH} 已存在，请先删除：git branch -D ${SNAPSHOT_BRANCH}`);
  }
  try {
    git('switch', '-c', SNAPSHOT_BRANCH);
    const docs = readInternalDocs();
    execFileSync('git', ['add', '--force', ...docs], { stdio: 'inherit' });
    const staged = git('diff', '--cached', '--name-only');
    if (staged !== '') {
      git('commit', '-m', `同步内部文档快照 ${new Date().toISOString().slice(0, 10)}`);
    }
    console.log('[3/4] 推送 → private（私有仓库）');
    // 私有仓库是全量备份镜像：每次快照都基于公开 main 重建，与上次快照必然分叉，故用 --force
    git('push', '--force', 'private', `${SNAPSHOT_BRANCH}:${branch}`);
  } finally {
    git('switch', branch);
    gitAllowFail('branch', '-D', SNAPSHOT_BRANCH);
  }

  console.log('[4/4] 完成：公开与私有仓库均已同步');
}

try {
  main();
} catch (error) {
  console.error(`同步失败：${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
