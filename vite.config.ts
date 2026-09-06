import { defineConfig } from 'vite'

/**
 * CLI 库构建：把 src/cli.ts 打进 dist/（library mode，Node 目标）。
 * 产物 dist/modlens-race.mjs 可直接 `node dist/modlens-race.mjs <图片>` 运行。
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/cli.ts',
      formats: ['es'],
      fileName: () => 'modlens-race.mjs',
    },
    rollupOptions: {
      external: [
        'node:child_process',
        'node:fs',
        'node:os',
        'node:path',
        'node:url',
        'node:zlib',
        'node:timers/promises',
      ],
    },
    target: 'node24',
    minify: false,
  },
})
