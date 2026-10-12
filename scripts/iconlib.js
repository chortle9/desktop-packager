'use strict';
/**
 * iconlib —— 零依赖图标处理库（纯 Node.js，无任何第三方包）
 * 能力：
 *  - 解析 ICO 文件内部所有帧，提取尺寸最大的帧
 *  - 解码 PNG（位深 8，颜色类型 0/2/3/4/6，含调色板与透明通道）
 *  - 解码 ICO 内嵌 DIB/BMP 位图（32/24/8/4/1 位，含 AND 透明掩码）
 *  - 双线性缩放 + 居中裁剪，输出 512x512 正方形 PNG
 * 用途：把任意格式、任意大小的图标统一处理成 Windows 打包所需图标
 */

const zlib = require('zlib');

/* ---------------- CRC32（PNG 用） ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------------- PNG 解码 ---------------- */

/**
 * 解码 PNG → { width, height, data: RGBA Buffer }
 * 仅支持 bitDepth=8；不支持隔行扫描
 */
function decodePNG(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null;      // RGB 调色板
  let trns = null;         // 透明信息

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    off += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(data));
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      trns = Buffer.from(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;

  const channels = [1, null, 3, 1, 2, null, 4][colorType];
  if (channels === null) return null;
  if (colorType === 3 && !palette) return null;

  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }

  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const row = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const lineStart = y * (stride + 1) + 1;
    const prevRow = y > 0 ? row : null;
    for (let x = 0; x < stride; x++) {
      const v = raw[lineStart + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prevRow ? prevRow[x] : 0;
      const upLeft = prevRow && x >= channels ? prevRow[x - channels] : 0;
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + left; break;
        case 2: val = v + up; break;
        case 3: val = v + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          val = v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default: return null;
      }
      row[x] = val & 0xff;
    }

    for (let x = 0; x < width; x++) {
      const si = x * channels, di = (y * width + x) * 4;
      switch (colorType) {
        case 0: { // 灰度
          const g = row[si];
          out[di] = out[di + 1] = out[di + 2] = g;
          out[di + 3] = trns && row[si] === trns.readUInt16BE(0) ? 0 : 255;
          break;
        }
        case 2: { // RGB
          out[di] = row[si]; out[di + 1] = row[si + 1]; out[di + 2] = row[si + 2];
          out[di + 3] = trns && row[si] === trns[0] && row[si + 1] === trns[1] && row[si + 2] === trns[2] ? 0 : 255;
          break;
        }
        case 3: { // 调色板
          const idx = row[si];
          out[di] = palette[idx * 3]; out[di + 1] = palette[idx * 3 + 1]; out[di + 2] = palette[idx * 3 + 2];
          out[di + 3] = trns && idx < trns.length ? trns[idx] : 255;
          break;
        }
        case 4: { // 灰度 + alpha
          const g = row[si];
          out[di] = out[di + 1] = out[di + 2] = g;
          out[di + 3] = row[si + 1];
          break;
        }
        case 6: { // RGBA
          out[di] = row[si]; out[di + 1] = row[si + 1]; out[di + 2] = row[si + 2]; out[di + 3] = row[si + 3];
          break;
        }
      }
    }
  }
  return { width, height, data: out };
}

/* ---------------- PNG 编码 ---------------- */

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA Buffer → PNG Buffer */
function encodePNG(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // bitDepth=8, colorType=6 (RGBA)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- ICO 解析 ---------------- */

/** 返回 ICO 帧列表 [{w,h,offset,size}]（w/h 为 0 时表示 256） */
function icoEntries(buf) {
  if (buf.length < 6) return [];
  const type = buf.readUInt16LE(2);
  if (type !== 1) return [];
  const count = buf.readUInt16LE(4);
  const out = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    if (e + 16 > buf.length) break;
    let w = buf[e], h = buf[e + 1];
    if (w === 0) w = 256;
    if (h === 0) h = 256;
    out.push({ w, h, size: buf.readUInt32LE(e + 8), offset: buf.readUInt32LE(e + 12) });
  }
  return out;
}

/** 读取 ICO 中最大的一帧 → RGBA */
function decodeICO(buf) {
  const entries = icoEntries(buf).filter((e) => e.offset + e.size <= buf.length);
  if (!entries.length) return null;
  entries.sort((a, b) => b.w * b.h - a.w * a.h);
  const best = entries[0];
  const data = buf.subarray(best.offset, best.offset + best.size);
  // 帧数据可能是 PNG
  if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47) {
    const png = decodePNG(data);
    if (png) return png;
  }
  // 否则按 DIB/BMP 解析
  return decodeDIB(data);
}

function decodeDIB(dib) {
  if (dib.length < 40) return null;
  const headerSize = dib.readUInt32LE(0);
  if (headerSize < 40) return null;
  const width = dib.readInt32LE(4);
  const heightAll = dib.readInt32LE(8);
  if (width <= 0 || heightAll === 0) return null;
  // ICO 中高度包含 AND 掩码，实际图像高度为一半
  const height = heightAll > 0 ? heightAll / 2 : -heightAll;
  const bpp = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  if (compression !== 0) return null; // 仅支持未压缩

  let off = headerSize;
  let palette = null;
  if (bpp <= 8) {
    const colors = dib.readUInt32LE(32) || (1 << bpp);
    palette = dib.subarray(off, off + colors * 4);
    off += colors * 4;
  }

  const bytesPP = Math.ceil(bpp / 8);
  const rowStride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(Math.ceil(width / 8) / 4) * 4;
  const pixelBytes = rowStride * height;
  const maskOffset = off + pixelBytes;

  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    // DIB 自底向上：数据行 y 对应图像行 (height-1-y)
    const srcRow = off + (height - 1 - y) * rowStride;
    const maskRow = maskOffset + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 255;
      const maskByte = dib[maskRow + (x >> 3)];
      const maskBit = (maskByte >> (7 - (x & 7))) & 1;
      if (bpp === 32) {
        const p = srcRow + x * 4;
        b = dib[p]; g = dib[p + 1]; r = dib[p + 2]; a = dib[p + 3];
        if (maskBit) a = 0;
      } else if (bpp === 24) {
        const p = srcRow + x * 3;
        b = dib[p]; g = dib[p + 1]; r = dib[p + 2];
        a = maskBit ? 0 : 255;
      } else {
        const p = srcRow + (x * bpp >> 3);
        let idx = 0;
        if (bpp === 8) idx = dib[p];
        else if (bpp === 4) idx = (x & 1) ? dib[p] & 0x0f : (dib[p] >> 4) & 0x0f;
        else idx = (dib[p] >> (7 - (x & 7))) & 1;
        if (palette) {
          const q = idx * 4;
          r = palette[q + 2]; g = palette[q + 1]; b = palette[q];
        }
        a = maskBit ? 0 : 255;
      }
      out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a;
    }
  }
  return { width, height, data: out };
}

/* ---------------- 缩放 ---------------- */

/** 双线性缩放 + 居中裁剪，输出 dstW×dstH（cover 模式，保持比例填满并裁剪） */
function resizeCover(src, sw, sh, dstW, dstH) {
  const scale = Math.max(dstW / sw, dstH / sh);
  const nw = Math.max(1, Math.round(sw * scale));
  const nh = Math.max(1, Math.round(sh * scale));
  const ox = (nw - dstW) / 2;
  const oy = (nh - dstH) / 2;
  const out = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + oy + 0.5) * sh / nh) - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = sy - y0;
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + ox + 0.5) * sw / nw) - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = sx - x0;
      const di = (y * dstW + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = src[(y0 * sw + x0) * 4 + c];
        const v10 = src[(y0 * sw + x1) * 4 + c];
        const v01 = src[(y1 * sw + x0) * 4 + c];
        const v11 = src[(y1 * sw + x1) * 4 + c];
        const top = v00 * (1 - fx) + v10 * fx;
        const bot = v01 * (1 - fx) + v11 * fx;
        out[di + c] = Math.round(top * (1 - fy) + bot * fy);
      }
    }
  }
  return out;
}

/* ---------------- 对外统一入口 ---------------- */

/**
 * 把 PNG 或 ICO 图标统一处理为 512x512 正方形 PNG。
 * 成功返回 PNG Buffer；不支持/损坏返回 null。
 */
function toSquarePng512(buf, ext) {
  let img = null;
  if (ext === '.png') img = decodePNG(buf);
  else if (ext === '.ico') img = decodeICO(buf);
  if (!img || img.width <= 0 || img.height <= 0) return null;
  const size = 512;
  const rgba = resizeCover(img.data, img.width, img.height, size, size);
  return encodePNG(size, size, rgba);
}

/** 读取 ICO 中最大帧尺寸（无则返回 null） */
function icoMaxSize(buf) {
  const entries = icoEntries(buf);
  if (!entries.length) return null;
  let best = null;
  for (const e of entries) if (!best || e.w * e.h > best.w * best.h) best = e;
  return best ? { w: best.w, h: best.h } : null;
}

module.exports = { decodePNG, encodePNG, decodeICO, toSquarePng512, icoMaxSize, resizeCover };
