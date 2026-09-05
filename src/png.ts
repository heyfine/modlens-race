/** 纯 JS 生成竞速测试图（无外部依赖）。 */
import { deflateSync } from 'node:zlib'

/** CRC32（Node 22+ 的 zlib.crc32 不存在时的手写回退）。 */
function crc32(buf: Buffer): number {
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
declare namespace crc32 {
  let table: Int32Array | undefined
}

/** PNG chunk 构造。 */
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/**
 * 生成 400x200 RGB 测试 PNG：上半红/绿/蓝三色带，下半黑白条纹。
 * 用于竞速的「测试竞速 / 单测」按钮，视觉模型可描述颜色区分。
 */
export function makeColorBarsPng(): Buffer {
  const width = 400
  const height = 200
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < width; x++) {
      let red: number
      let green: number
      let blue: number
      if (y < height / 2) {
        if (x < width / 3) {
          red = 220
          green = 40
          blue = 40
        } else if (x < (2 * width) / 3) {
          red = 40
          green = 170
          blue = 60
        } else {
          red = 40
          green = 70
          blue = 220
        }
      } else {
        const dark = Math.floor(x / 25) % 2 === 0
        red = green = blue = dark ? 20 : 235
      }
      raw[offset++] = red
      raw[offset++] = green
      raw[offset++] = blue
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** 把测试图写入磁盘（幂等：文件已存在则跳过），返回路径。 */
export function ensureTestImage(
  outputPath: string,
  exists: (p: string) => boolean,
  write: (p: string, b: Buffer) => void,
): string {
  if (exists(outputPath)) return outputPath
  write(outputPath, makeColorBarsPng())
  return outputPath
}
